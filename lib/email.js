'use strict';

const url = require('url');
const emailjs = require('emailjs');
const db = require('./db');
const Property = require('./property');
const Token = require('./token');

/**
 * Email utilities.
 * @type {Email}
 */
module.exports = class Email {

	/**
	 * Retrieves an email.
	 * @param {string} name Name of the email
	 * @returns {Promise}
	 */
	static getEmail (name) {
		return new Promise((resolve, reject) => {
			db.collection('emails').findOne({
				'name': name
			}, (error, email) => {
				if (error) {
					return reject(error);
				}

				resolve(email);
			});
		});
	}

	/**
	 * Sends an email.
	 * @param {object} email Email to send.
	 * @returns {Promise}
	 */
	static send (email) {
		return new Promise((resolve) => {
			if (this.smtpServer) {
				return this.smtpServer.send(email, resolve);
			}

			Property.getValue('backrest.email.enabled', true).then((enabled) => {
				if (!enabled) {
					return resolve(email);
				}

				var promises = [
					this.getEnvOrProperty('BACKREST_EMAIL_SERVER_USER_KEY', 'backrest.email.server.user'),
					this.getEnvOrProperty('BACKREST_EMAIL_SERVER_PASSWORD_KEY', 'backrest.email.server.password'),
					this.getEnvOrProperty('BACKREST_EMAIL_SERVER_HOST_KEY', 'backrest.email.server.host'),
					this.getEnvOrProperty('BACKREST_EMAIL_SERVER_PORT_KEY', 'backrest.email.server.port'),
					this.getEnvOrProperty('BACKREST_EMAIL_SERVER_SSL_KEY', 'backrest.email.server.ssl')
				];

				Promise.all(promises).then((properties) => {
					this.smtpServer = emailjs.server.connect({
						'user': properties[0],
						'password': properties[1],
						'host': properties[2],
						'port': properties[3],
						'ssl': properties[4]
					});
					this.smtpServer.send(email, resolve);
				});
			});
		});
	}

	/**
	 * Retrieves a value from environment variable or property.
	 * @private
	 * @param {string} envKey Name of environment variable key.
	 * @param {string} propertyKey Name of property key.
	 * @returns {object}
	 */
	static getEnvOrProperty (envKey, propertyKey) {
		if (process.env[envKey] && process.env[process.env[envKey]]) {
			return Promise.resolve(process.env[process.env[envKey]])
		}

		return Property.getValue(propertyKey);
	}

	/**
	 * Send a password reset request email for the specified user.
	 * @param {object} user User requesting password reset.
	 * @returns {Promise}
	 */
	static sendResetPassword (user) {
		return new Promise((resolve) => {
			this.getEmail('passwordResetRequest').then((email) => {
				if (!email.enabled) {
					resolve();
				}

				var promises = [];
				promises.push(Property.getValue('backrest.authentication.resetPasswordToken.timeout'));
				promises.push(Property.getValue('backrest.authentication.resetPasswordToken.algorithm'));
				promises.push(Property.getValue('backrest.authentication.resetPasswordToken.password'));
				Promise.all(promises).then((properties) => {

					// create and encrypt the token;
					var [timeout, algorithm, password] = properties;
					var token = Token.generate(timeout, algorithm, password, user._id);

					// format the email message
					email.to = (user.firstName || '') + ' ' + (user.lastName || '') + ' <' + user.email + '>';
					email.text = email.text.replace(/\{firstName}/g, (user.firstName || ''))
						.replace(/\{lastName}/g, (user.lastName || ''))
						.replace(/\{token}/g, encodeURIComponent(token));

					// format the email message - html
					if (email.attachment) {
						email.attachment.forEach((attachment) => {
							if (!attachment.alternative) {
								return;
							}

							attachment.data = attachment.data.replace(/\{firstName}/g, (user.firstName || ''))
								.replace(/\{lastName}/g, (user.lastName || ''))
								.replace(/\{token}/g, encodeURIComponent(token))
								.replace(/\{token}/g, '');
						});
					}

					// send the email
					this.send(email).then(resolve);
				});
			});
		});
	}

	/**
	 * Send user confirmation email.
	 * @param {object} user User to confirm.
	 * @returns {Promise}
	 */
	static sendConfirmEmail (user) {
		return new Promise((resolve) => {
			if (user.isConfirmed) {
				return resolve('Email already confirmed.');
			}

			this.getEmail('confirmEmail').then((email) => {
				if (!email.enabled) {
					resolve();
				}

				var promises = [];
				promises.push(Property.getValue('backrest.authentication.confirmEmailToken.timeout'));
				promises.push(Property.getValue('backrest.authentication.confirmEmailToken.algorithm'));
				promises.push(Property.getValue('backrest.authentication.confirmEmailToken.password'));
				Promise.all(promises).then((properties) => {

					// create and encrypt the token;
					var [timeout, algorithm, password] = properties;
					var token = Token.generate(timeout, algorithm, password, user._id);

					// format the email message
					email.to = (user.firstName || '') + ' ' + (user.lastName || '') + ' <' + user.email + '>';
					email.text = email.text.replace(/\{firstName}/g, (user.firstName || ''))
						.replace(/\{lastName}/g, (user.lastName || ''))
						.replace(/\{token}/g, encodeURIComponent(token));

					// format the email message - html
					if (email.attachment) {
						for (var a = 0; a < email.attachment.length; a++) {
							email.attachment.forEach((attachment) => {
								if (!attachment.alternative) {
									return;
								}

								attachment.data = attachment.data.replace(/\{firstName}/g, (user.firstName || ''))
									.replace(/\{lastName}/g, (user.lastName || ''))
									.replace(/\{token}/g, encodeURIComponent(token))
									.replace(/\{token}/g, '');
							});
						}
					}

					// send the email
					this.send(email).then(resolve);
				});
			});
		});
	}

	/**
	 * Send an error email.
	 * @param {object} request Request which caused the error.
	 * @param {object} error Error being emailed.
	 * @returns {Promise}
	 */
	static sendErrorEmail (request, error) {
		return new Promise((resolve) => {
			this.getEmail('errorEmail').then((email) => {
				if (!email.enabled) {
					resolve();
				}

				// execute api call
				var query = url.parse(request.url, true).query;

				// parse data to JSON
				var data = JSON.parse(query.data);

				// format the email message
				email.text = email.text.replace(/\{timestamp}/g, new Date().toString())
					.replace(/\{error}/g, error.stack)
					.replace(/\{url}/g, request.url)
					.replace(/\{method}/g, request.method)
					.replace(/\{headers}/g, JSON.stringify(request.headers, null, 4))
					.replace(/\{session}/g, JSON.stringify(request.session, null, 4))
					.replace(/\{data}/g, data);

				// format the email message - html
				if (email.attachment) {
					email.attachment.forEach((attachment) => {
						if (!attachment.alternative) {
							return;
						}

						attachment.data = attachment.data.replace(/\{timestamp}/g, new Date().toString())
							.replace(/\{error}/g, error.stack)
							.replace(/\{url}/g, request.url)
							.replace(/\{method}/g, request.method)
							.replace(/\{headers}/g, JSON.stringify(request.headers, null, 4))
							.replace(/\{session}/g, JSON.stringify(request.session, null, 4))
							.replace(/\{data}/g, data);
					});
				}

				// send the email
				this.send(email).then(resolve);
			});
		});
	}
};