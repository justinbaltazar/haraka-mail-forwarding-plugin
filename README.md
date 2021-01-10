# Masked SMTP Server

### About

This is a plugin which should be run and configured with the [Haraka SMTP server](http://haraka.github.io/).

Based off of the original [haraka-alias-forward by chadsmith on Github](https://github.com/chadsmith/haraka-alias-forward).
Work on this version began from a fork of [X-Ryl669's modifications](https://github.com/X-Ryl669/haraka-alias-forward) to the original source.
X-Ryl669's modifications implements [SRS rewrites](https://en.wikipedia.org/wiki/Sender_Rewriting_Scheme) which leads to a noticable improvement in email delivery. 

This plugin interfaces with MongoDB.

This allows us to do two important things:
- update aliases and forwarding rules on the fly
- store `Message-ID` and `Reference` headers to allow the masking of email replies

### Set Up

**Prequisites**

- Node >= `10.21.0`
- Haraka (latest version) run `npm install -g Haraka` to install. [More detailed installation instructions can be found on Haraka's main repository](https://github.com/haraka/haraka).

**Installation**

Run `yarn` in the main directory to install necessary packages.
Haraka can be run by running `haraka -c /path/to/this/repository`

**Configuration**

Haraka's documentation provides a [very thorough coverage of configuration options](http://haraka.github.io/core/CoreConfig/). 
I recommend properly configuring [DKIM](https://github.com/haraka/Haraka/blob/master/docs/plugins/dkim_sign.md) and SPF on the domain that will be forwarding emails to avoid emails from landing in spam. 
I also recommend setting up the `tls` plugin. I have included some of these configuration files in this repository. 

**Please do not forget to change the `secret` and `sender_domain` values in `config/srs.ini`**. 

An `.env` file should be kept in your main Haraka folder with the following keys: `MONGO_URI` and `MONGO_DB_NAME`. 
If these two values are not set on either the .env file or in the environment that this Haraka is being running, this plugin will throw an error.

### Tests
To run tests, run `yarn test`. These tests were written using the `Sinon` and `assert` libraries and can be found in the `tests` directory.