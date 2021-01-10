# Masked SMTP Server

### About

Based off of the [original](https://github.com/chadsmith/haraka-alias-forward) `haraka-alias-forward` 
plugin which was modified by X-Ryl669 [on Github](https://github.com/X-Ryl669/haraka-alias-forward) to 
implement SRS headers to improve email delivery. 

This version adds MongoDB as a datastore. 

This allows us to do two important things:
- update aliases and forwarding rules on the fly
- store `Message-ID` headers and allow anonymous masking of email replies as well

### Set Up

**Prequisites**

- Node >= `10.21.0`
- Haraka (latest version) run `npm install -g Haraka` to install

**Installation**

Run `yarn` in the main directory to install necessary packages.

**Configuration**

Haraka's documentation provides a [very thorough walk through of possile configurations](http://haraka.github.io/core/CoreConfig/). I recommend properly configuring DKIM and SPF on the email domain to avoid forwarded emails from heading into spam. I also recommend setting up the `tls` plugin. I have included those configuration files in this repository. Do change the `secret` and `sender_domain` values in `config/srs.ini`, though.