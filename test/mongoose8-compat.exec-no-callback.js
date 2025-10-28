/*
 * Mongoose 8 Compatibility - ensure handlers don't call exec(callback)
 * and that list/detail GET work with filters without using callbacks.
 */

const express = require('express');
const request = require('supertest');
const bodyParser = require('body-parser');
const restful = require('..');

const mongoose = restful.mongoose;

describe('Mongoose 8 compatibility (no exec callbacks)', function() {
  let app, Resource, counter = 0;
  let originalExec, originalCountDocuments;

  beforeEach(function() {
    // Fresh app
    app = express();
    app.use(bodyParser.json());

    // Patch Mongoose to detect callback usage in exec
    originalExec = mongoose.Query.prototype.exec;
    originalCountDocuments = mongoose.Model.countDocuments;

    mongoose.Query.prototype.exec = function(...args) {
      if (args.length && typeof args[0] === 'function') {
        throw new Error('Query.exec called with a callback');
      }
      // Return a predictable payload based on whether it's detail vs list
      const isDetail = this._conditions && (this._conditions._id || this.op === 'findOne' || this.op === 'findById');
      if (isDetail) {
        return Promise.resolve({ _id: this._conditions._id || '507f1f77bcf86cd799439011', name: 'Detail Item' });
      }
      return Promise.resolve([
        { _id: '507f1f77bcf86cd799439011', name: 'Item A' },
        { _id: '507f1f77bcf86cd799439012', name: 'Item B' }
      ]);
    };

    mongoose.Model.countDocuments = function(filter) {
      // Ensure a plain object filter is passed and return 2 to match the stubbed list
      if (filter && typeof filter !== 'object') {
        throw new Error('countDocuments expected object filter');
      }
      return Promise.resolve(2);
    };

    // Define a simple model to exercise filters
    const TestSchema = new mongoose.Schema({
      name: String,
      active: Boolean,
      property: String,
      birth: Date,
      sex: String,
      breed: String,
      class: String,
      lot: String
    });

    counter += 1;
    Resource = restful.model('M8Compat' + counter, TestSchema);
    Resource.methods(['get']);
    Resource.register(app, '/items');
  });

  afterEach(function() {
    // Restore patched methods
    mongoose.Query.prototype.exec = originalExec;
    mongoose.Model.countDocuments = originalCountDocuments;
  });

  it('GET list should not use exec(callback) and set X-Total-Count', function(done) {
    const url = '/items?sort=birth&active=true&property__in=A,B&select=name%20sex%20birth%20breed%20class%20lot&limit=20&skip=0';

    request(app)
      .get(url)
      .expect(200)
      .expect(res => {
        if (!Array.isArray(res.body)) throw new Error('Expected array body');
        if (res.body.length !== 2) throw new Error('Expected 2 items');
        if (res.headers['x-total-count'] !== '2') throw new Error('Expected X-Total-Count=2');
      })
      .end(done);
  });

  it('GET detail should not use exec(callback) and return object', function(done) {
    request(app)
      .get('/items/507f1f77bcf86cd799439011')
      .expect(200)
      .expect(res => {
        if (!res.body || res.body._id !== '507f1f77bcf86cd799439011') {
          throw new Error('Expected detail object with _id');
        }
      })
      .end(done);
  });
});
