'use strict';

const assert       = require('assert');
const path         = require('path');

const Address      = require('address-rfc2821').Address;
const fixtures     = require('haraka-test-fixtures');
const constants    = require('haraka-constants');
const sinon        = require('sinon');

const MongoClient  = require('mongodb').MongoClient;

const stub         = fixtures.stub.stub;

const noop         = () => {};

function _set_up (done) {
  // dummy values for test
  process.env.MONGO_URI = 'test_uri'
  process.env.MONGO_DB_NAME = 'test_db'

  this.plugin = new fixtures.plugin('mail_forwarding');

  this.plugin.loginfo = sinon.spy() // suppress logs

  this.plugin.db = sinon.spy() // mock MongoDB

  done();
}

describe('dotenv', function() {
   it('should throw an error without proper environment variables set', function(done) {
      assert.throws(() => { new fixtures.plugin('mail_forwarding') }, new Error('ENV not properly configured. Exiting...'));
      done()
   })
})

describe('load_srs_ini', function () {
  beforeEach(_set_up)

  it('should properly load configuration files', function (done) {
    this.plugin.config = this.plugin.config.module_config(path.resolve('tests'));
    this.plugin.load_srs_ini()
    assert.equal(this.plugin.cfg.main.secret, '123')
    assert.equal(this.plugin.cfg.main.sender_domain, 'domain.me')
    done()
  });
})

describe('route_relay', function () {
  beforeEach(_set_up)
  
  beforeEach(function (done) {
    this.connection = fixtures.connection.createConnection({}, { 
      notes: {},
    });
    this.connection.transaction = fixtures.transaction.createTransaction();
    done()
  })

  it('should not call process_message_id', function (done) {
    this.plugin.process_message_id = sinon.spy()
    this.plugin.route_relay(noop, this.connection)
    sinon.assert.notCalled(this.plugin.process_message_id)
    done()
  })

  it('should call process_message_id', function (done) {
    this.plugin.process_message_id = sinon.spy()
    this.connection.transaction.notes.two_way_relay_flag = true;

    this.plugin.route_relay(noop, this.connection)

    assert(this.plugin.process_message_id.calledOnce)
    done()
  })

  describe('callback', function (done) {
    beforeEach(function (done) {
      this.plugin.process_message_id = function(tx, callback) {
        return callback();
      }
      done();
    });

    it('should deny the email by saying it does not exist', function (done) {
      const next = (status, message) => {
        assert.equal(status, constants.DENY)
        assert.equal(message, this.plugin.EMAIL_NOT_FOUND)
      }

      this.plugin.route_relay(next, this.connection)
      done();
    });

    it('should deny the email when the email is a self-send', function (done) {
      const next = (status, message) => {
        assert.equal(status, constants.DENY)
        assert.equal(message, this.plugin.SELF_SEND)
      }

      this.connection.transaction.notes.addresses_to_forward = []
      this.plugin.route_relay(next, this.connection)
      done();
    });

    it('should accept the email and call the forward_message function', function (done) {
      const next = (status) => {
        assert.equal(status, undefined)
      }

      this.plugin.forward_message = sinon.spy()

      this.connection.transaction.notes.addresses_to_forward = ['hello']
      this.plugin.route_relay(next, this.connection)

      assert(this.plugin.forward_message.calledOnce)

      done();
    });
  })
})

describe('forward_message', function() {
  beforeEach(_set_up)

  beforeEach(function (done) {
    this.connection = fixtures.connection.createConnection({}, { 
      notes: {},
    });
    this.connection.transaction = fixtures.transaction.createTransaction();
    this.plugin.config = this.plugin.config.module_config(path.resolve('tests'));

    // load configurations
    this.connection.transaction.mail_from = new Address('test@test.com')

    this.plugin.srs = {
      rewrite: sinon.spy()
    }

    this.plugin.load_srs_ini()
    done()
  })

  it('should call srs rewrite function properly', function(done) {
    this.plugin.forward_message(this.connection.transaction, ['joe@test.com'])
    assert(this.plugin.srs.rewrite.calledOnce)
    assert.deepEqual(this.plugin.srs.rewrite.firstCall.args, ['test', 'test.com'])
    done();
  });

  it('should rewrite headers', function(done) {
    this.plugin.srs.rewrite = sinon.fake.returns('return-value-bounce');
    this.plugin.forward_message(this.connection.transaction, ['joe@test.com'])
    
    assert.equal(this.connection.transaction.mail_from.original, 'return-value-bounce@domain.me')
    assert.deepEqual(this.connection.transaction.rcpt_to, [new Address('<joe@test.com>')])
    assert.deepEqual(this.connection.transaction.mail_from, new Address('return-value-bounce@domain.me'))

    done();
  });
})

describe('init_mongo_db', function(done) {
  beforeEach(_set_up)

  let mongoCallback;
  let testDBMock;

  class ClientMock {
    constructor() {
      this.spy = new CollectionMock();
    }

    db() {
      return this.spy;
    }
  }

  class CollectionMock {
    constructor() {
      this.spy = sinon.spy();
    }

    collection(...args) {
      assert.deepEqual(args, ['aliases'])
      return noop;
    }
  }

  beforeEach(function (done) {
    mongoCallback = (url, config, callback) => {
      assert.equal(url, 'test_uri')
      assert.deepEqual(config, {
        useNewUrlParser: true,
        keepAlive: true,
        connectTimeoutMS: 0,
        socketTimeoutMS: 0
      })

      testDBMock = new ClientMock();

      callback(null, testDBMock);
    }

    sinon.stub(MongoClient, "connect").callsFake(mongoCallback)
    done()
  })

  afterEach(function () {
      MongoClient.connect.restore(); // Unwraps the spy
  });

  it('should call the MongoDB connection method and next', function(done) {
    const next = (status) => {
      assert.equal(status, undefined)
    }

    let server = {
      notes: {}
    }

    this.plugin.init_mongo_db(next, server)

    assert.ok(this.plugin.db)
    assert.ok(server.notes.mongodb)

    done()
  })
})

describe('fetch_alias_from_db', function(done) {
  beforeEach(_set_up)

  let mongoCallback;

  class MongoMock {
    constructor() {
      this.spy = sinon.spy();
    }

    findOne(query, callback) {
      this.spy();
      callback(null, []);
    }
  }

  beforeEach(function (done) {
    mongoCallback = sinon.spy();
    done()
  })

  it('should call the plugin DB method and also the callback', function(done) {
    const rcptMock = new Address('<test@test.com>')

    this.plugin.db = new MongoMock();
    this.plugin.fetch_alias_from_db(rcptMock, mongoCallback)

    assert(this.plugin.db.spy.calledOnce)
    assert(mongoCallback.calledOnce)

    done()
  })
})

describe('fetch_references', function() {
  beforeEach(_set_up)

  it('should fetch all the references in the string', function(done) {
    const res = this.plugin.fetch_references('<test@test.com> <test@google.com>')

    assert.deepEqual(res, ['test@test.com', 'test@google.com'])

    done()
  })
})

describe('two_way_relay', function(done) {
  beforeEach(_set_up)

  class MongoMock {
    constructor() {
      this.spy = sinon.spy();
    }

    insertOne(query) {
      this.spy(query);
    }
  }

  beforeEach(function(done) {
    this.connection = fixtures.connection.createConnection({}, { 
      notes: {},
    });
    this.connection.transaction = fixtures.transaction.createTransaction();
    this.connection.transaction.notes = {
      mail_from: 'from@test.com',
      mail_to: ['to@test.com'],
      alias_full: 'alias@domain.me',
      rcpt_host: 'test.com',
      rcpt_user: 'to'
    }

    this.plugin.db = new MongoMock()

    done()
  })

  it('should do nothing but print logger statements', function(done) {
    this.connection.transaction.notes.mail_to = null
    this.plugin.two_way_relay(this.connection.transaction, null, null)
    assert.equal(this.plugin.loginfo.callCount, 3)
    done()
  })

  it('should add the entry into the database', function(done) {
    this.plugin.two_way_relay(this.connection.transaction, null, '123')

    assert.equal(this.plugin.loginfo.callCount, 2)
    assert.deepEqual(this.plugin.db.spy.firstCall.args, [{
        id: '123',
        origin: 'from@test.com', 
        dest: 'to@test.com',
        alias: 'alias@domain.me',
    }])

    done()
  })

  describe('email chain', function() {
    describe('headers', function() {
      it('should set `reply-to` header to the reply.* domain', function(done) {
        const mockMessageThread = {
          origin: 'from@test.com',
          dest: 'to@test.com',
          alias: 'alias@domain.me'
        }
        this.connection.transaction.add_header('from', 'john doe <from@test.com>')
        this.plugin.two_way_relay(this.connection.transaction, mockMessageThread, '123')
        assert.equal(this.connection.transaction.header.get('Reply-To'), 'john doe <to@reply.test.com>')
        assert.equal(this.plugin.loginfo.callCount, 4)
        done()
      })

      it('should set `reply-to` header to the alias', function(done) {
        const mockMessageThread = {
          origin: 'customer@test.me',
          dest: 'masked_alias@test.me',
          alias: 'alias@domain.me'
        }

        this.connection.transaction.add_header('from', 'alias to mask <masked_alias@test.me>')
        this.plugin.two_way_relay(this.connection.transaction, mockMessageThread, '123')
        assert.equal(this.connection.transaction.header.get('Reply-To'), 'alias to mask <alias@domain.me>')
        assert.equal(this.plugin.loginfo.callCount, 4)
        done()
      })
    })
  })
})

describe('alias_forward', function() {
  beforeEach(_set_up)

  beforeEach(function(done) {
    this.connection = fixtures.connection.createConnection({}, { 
      notes: {},
    });

    this.connection.transaction = fixtures.transaction.createTransaction();
    this.connection.transaction.mail_from = new Address('joe@test.com')

    done()
  })

  it('should call the fetch_alias_from_db method', function(done) {
    this.plugin.fetch_alias_from_db = sinon.spy()

    this.plugin.alias_forward(noop, this.connection, [{ user: 'test', host: 'test.com' }])
    assert(this.plugin.fetch_alias_from_db.calledOnce)

    done()
  })

  describe('callback', function() {
    it('should handle null results', function(done) {

      const fakeCallBack = (rcpt, callback) => {
        callback(null);
      }

      sinon.stub(this.plugin, "fetch_alias_from_db").callsFake(fakeCallBack)

      this.plugin.alias_forward(noop, this.connection, [{ user: 'alias', host: 'domain.me' }])

      assert(this.plugin.fetch_alias_from_db.calledOnce)
      
      assert.deepEqual(this.connection.transaction.notes, {
        addresses_to_forward: null,
        forward: true,
        mail_from: 'joe@test.com',
        mail_to: null,
        alias_full: 'alias@domain.me',
        rcpt_host: 'domain.me',
        rcpt_user: 'alias',
        two_way_relay_flag: false
      })

      done()
    })

    it('should update headers in callback', function(done) {

      const fakeCallBack = (rcpt, callback) => {
        callback({ 
          dest: ['test@test.com']
        });
      }

      sinon.stub(this.plugin, "fetch_alias_from_db").callsFake(fakeCallBack)

      this.plugin.alias_forward(noop, this.connection, [{ user: 'alias', host: 'domain.me' }])

      assert(this.plugin.fetch_alias_from_db.calledOnce)
      
      assert.deepEqual(this.connection.transaction.notes, {
        addresses_to_forward: [ 'test@test.com' ],
        forward: true,
        mail_from: 'joe@test.com',
        mail_to: [ 'test@test.com' ],
        alias_full: 'alias@domain.me',
        rcpt_host: 'domain.me',
        rcpt_user: 'alias',
        two_way_relay_flag: false
      })

      done()
    })
  })
})