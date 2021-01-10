const util = require('util');
const Address = require('address-rfc2821').Address;
const Transaction = require('./transaction');
const logger = require('./logger');
const _ = require('lodash');
const MongoClient = require('mongodb').MongoClient;

// dotenv config
require('dotenv').config({
    path: `${__dirname}/../.env`
});

const url = process.env.MONGO_URI
const dbName = process.env.MONGO_DB_NAME

if(!url) {
    throw(new Error('ENV not properly configured. Exiting...'))
}

exports.SELF_SEND = "Hi! You're receiving this rejection email because the sender and the recipient emails are identical. Please try sending this email from another account.Have a great day! :)";
exports.EMAIL_NOT_FOUND = "Email address not found."

exports.register = function () {
    const plugin = this;
    try {
        plugin.SRS = require('srs.js');
    }
    catch (e) {
        plugin.logerror("failed to load srs, " +
                        " try installing it: npm install srs.js");
        return;
    }
    plugin.load_srs_ini();
    plugin.srs = new plugin.SRS({secret: plugin.cfg.main.secret});

    this.register_hook('init_master', 'init_mongo_db');
    this.register_hook('init_child', 'init_mongo_db');

    this.register_hook('rcpt', 'alias_forward'); // hook configures and compiles information
    this.register_hook('data_post', 'route_relay'); // forwards the email
};

exports.init_mongo_db = function(next, server) {
    const plugin = this;

    if(!server.notes.mongodb) {
        MongoClient.connect(url, { 
            'useNewUrlParser': true, 
            'keepAlive': true, 
            'connectTimeoutMS': 0, 
            'socketTimeoutMS': 0 
        }, 
        (err, client) => {
            if (err) {
                plugin.logerror(err);
                throw err;
            }
            
            server.notes.mongodb = client.db().collection('aliases');
            plugin.db = server.notes.mongodb;
            next();
        });
    } else {
        plugin.db = server.notes.mongodb;
        next();
    }
}

exports.shutdown = function() {
    server.notes.mongodb.close();
}

exports.load_srs_ini = function () {
  const plugin = this;
  plugin.cfg = plugin.config.get('srs.ini', 'ini', () => {
    plugin.load_srs_ini();
  });
};

exports.route_relay = function (next, connection) {
    const plugin = this;

    const tx = connection.transaction;
    const hasReplyTo = tx.header.get('In-Reply-To');

    const after_process_message = () => {
        const forward_addresses = tx.notes.addresses_to_forward;

        if(!forward_addresses) {
            return next(DENY, this.EMAIL_NOT_FOUND);
        }

        if(forward_addresses.length == 0) {
            if(!hasReplyTo) {
                return next(DENY, this.SELF_SEND);
            }
        }

        this.forward_message(tx, forward_addresses);

        return next();
    }

    if(tx.notes.two_way_relay_flag) {
        this.process_message_id(tx, after_process_message);
    } else {
        after_process_message();
    }
}

exports.alias_forward = function (next, connection, params) {
    const rcpt = params[0];
    const plugin = this;

    const { user, host } = rcpt;

    this.fetch_alias_from_db(rcpt, (forward_addresses) => {
        const originEmailData = connection.transaction.mail_from;
        const originEmailFull = `${originEmailData.user}@${originEmailData.host}`;
        const destEmailFull = `${rcpt.user}@${rcpt.host}`;

        const filterOrigin = (item) => {
            return item != originEmailFull
        }

        const forwardAddressedWithoutOrigin = (forward_addresses && _.filter(forward_addresses.dest, filterOrigin));

        connection.transaction.notes.addresses_to_forward = forwardAddressedWithoutOrigin;

        // Tell later plugins that this transaction is now an alias
        connection.transaction.notes.forward = true;
        connection.relaying = true;

        connection.transaction.notes.mail_from = originEmailFull;
        connection.transaction.notes.mail_to = forwardAddressedWithoutOrigin;
        connection.transaction.notes.alias_full = destEmailFull;
        connection.transaction.notes.rcpt_host = rcpt.host;
        connection.transaction.notes.rcpt_user = rcpt.user;
        connection.transaction.notes.two_way_relay_flag = (forward_addresses && forward_addresses.two_way_relay) || false;

        return next();
    });
};

exports.process_message_id = function(tx, callback) {
    if(!tx.notes.two_way_relay_flag) {
        return callback();
    }

    const plugin = this;
    const references = tx.header.get('References');
    const message_id = (references ? this.fetch_references(references)[0] : this.fetch_references(tx.header.get('Message-ID'))[0]).trim();

        
    plugin.db.findOne({
        id: message_id
    }, (err, results) => {
        if(err) {
            plugin.loginfo('Error:', err);
        } else {
            this.two_way_relay(tx, results, message_id)
        }
        return callback();
    });
}

exports.two_way_relay = function(tx, results, message_id) {
    const { mail_from, mail_to, alias_full, rcpt_host, rcpt_user } = tx.notes;
    const plugin = this;
    const from_header = tx.header.get('from');
    const sender_name = from_header.replace(/<.*>/, '').trim();

    // plugin.loginfo("from: ", sender_name);

    if(!mail_to && !results) {
        plugin.loginfo('Not found in our database with message_id:', message_id);
        plugin.loginfo('However, it seems like this was sent as a reply from the author to themselves.')
        plugin.loginfo('We will be throwing an error here.');
    }
    else if(!results) {
        plugin.loginfo('Not found in our database with message_id:', message_id);
        plugin.loginfo('alias_full:', alias_full)

        plugin.db.insertOne({
            id: message_id,
            origin: mail_from, 
            dest: mail_to[0], // assume we're just picking one for now (future support coming soon!),
            alias: alias_full,
        });
        tx.add_header('Reply-To', `${sender_name} <${rcpt_user}@reply.${rcpt_host}>`);
    } else {
        plugin.loginfo('Found in our database with message_id:', message_id);
        plugin.loginfo(results)
        plugin.loginfo(mail_from, results.origin == mail_from)
        plugin.loginfo('alias_full:', alias_full)

        if(results.origin == mail_from) {
            tx.notes.addresses_to_forward = [results.dest];
            tx.add_header('Reply-To', `${sender_name} <${rcpt_user}@reply.${rcpt_host}>`);
        } else {
            tx.notes.addresses_to_forward = [results.origin]
            tx.remove_header('from');
            tx.remove_header('to');
            tx.add_header('from', `${sender_name} <${results.alias}>`);
            tx.add_header('to', results.origin);
            tx.add_header('Reply-To', `${sender_name} <${results.alias}>`);
        }

    }
}

exports.fetch_references = function(references) {
    const re = new RegExp("<(.*?)>", "g");
    const trimmed = references.trim();

    let matches = [];
    const results = [];

    while(matches = re.exec(trimmed)) {
        results.push(matches[1]);
    }

    return results;
}

exports.fetch_alias_from_db = function(rcpt, callback) {
    const { user, host } = rcpt;
    const plugin = this;

    plugin.db.findOne({
        user,
        host,
        active: true,
    }, (err, results) => {

        if(err) {
            plugin.loginfo('Error:', err);
        } 
        
        return callback(results);
    });
}

exports.forward_message = function(originalTransaction, recipients) {
    const plugin = this;
    const send_transaction = Transaction.createTransaction();
    
    Object.assign(send_transaction, originalTransaction);

    send_transaction.rcpt_to = recipients.map(recipient => {
        return new Address('<' + recipient + '>');
    });

    const original_recipient = originalTransaction.rcpt_to[0];

    // SRS to maximize chances of accurate delivery
    const sender = send_transaction.mail_from;
    const srsReverseValue = null;

    const beforeSrsRewriteFrom = sender;
    const afterSrsRewriteFrom = new Address(plugin.srs.rewrite(sender.user, sender.host), plugin.cfg.main.sender_domain);

    send_transaction.mail_from = afterSrsRewriteFrom;

    // logger.loginfo(plugin, 'beforeSrsRewriteFrom=' + beforeSrsRewriteFrom + ', afterSrsRewriteFrom=' + afterSrsRewriteFrom + '.');

    originalTransaction.rcpt_to = send_transaction.rcpt_to;
    originalTransaction.mail_from = send_transaction.mail_from;
};