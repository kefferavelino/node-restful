/**
 * Express 5 Integration Test
 * Tests actual HTTP requests to routes registered with Express 5
 */

var express = require('express');
var request = require('supertest');
var restful = require('../');

describe('Express 5 Integration', function() {
  var app, Resource, testCounter = 0;

  beforeEach(function() {
    app = express();
    
    // Express 4 compatibility: body-parser is separate
    var bodyParser = require('body-parser');
    app.use(bodyParser.json());
    
    var mongoose = restful.mongoose;
    var TestSchema = new mongoose.Schema({
      name: String,
      value: Number
    });
    
    testCounter++;
    Resource = restful.model('IntegrationTest' + testCounter, TestSchema);
    
    // Mock handlers to avoid database calls
    Resource.methods(['get', 'post', 'put', 'delete']);
    
    // Override handlers to return mock data
    Resource.route('get', {
      handler: function(req, res) {
        if (req.params.id) {
          res.json({ id: req.params.id, name: 'Detail Item' });
        } else {
          res.json([{ id: '507f1f77bcf86cd799439011', name: 'List Item' }]);
        }
      }
    });
    
    Resource.route('post', {
      handler: function(req, res) {
        res.status(201).json({ id: '507f1f77bcf86cd799439011', ...req.body });
      },
      detail: false
    });
    
    Resource.route('put', {
      handler: function(req, res) {
        res.json({ id: req.params.id, ...req.body, updated: true });
      },
      detail: true
    });
    
    Resource.route('delete', {
      handler: function(req, res) {
        res.status(204).send();
      },
      detail: true
    });
    
    Resource.register(app, '/items');
  });

  it('GET /items should return list', function(done) {
    request(app)
      .get('/items')
      .expect(200)
      .expect(function(res) {
        if (!Array.isArray(res.body)) throw new Error('Expected array');
      })
      .end(done);
  });

  it('GET /items/:id should return detail', function(done) {
    request(app)
      .get('/items/507f1f77bcf86cd799439011')
      .expect(200)
      .expect(function(res) {
        if (res.body.id !== '507f1f77bcf86cd799439011') {
          throw new Error('Expected id in response');
        }
      })
      .end(done);
  });

  it('GET /items/:id should reject invalid ID format', function(done) {
    request(app)
      .get('/items/invalid123')
      .expect(400)
      .expect(function(res) {
        if (!res.body.error || res.body.error.indexOf('Invalid id') === -1) {
          throw new Error('Expected invalid id error');
        }
      })
      .end(done);
  });

  it('POST /items should create', function(done) {
    request(app)
      .post('/items')
      .send({ name: 'New Item', value: 42 })
      .expect(201)
      .expect(function(res) {
        if (res.body.name !== 'New Item') throw new Error('Expected name in response');
      })
      .end(done);
  });

  it('PUT /items/:id should update', function(done) {
    request(app)
      .put('/items/507f1f77bcf86cd799439011')
      .send({ name: 'Updated Item' })
      .expect(200)
      .expect(function(res) {
        if (!res.body.updated) throw new Error('Expected updated flag');
      })
      .end(done);
  });

  it('DELETE /items/:id should delete', function(done) {
    request(app)
      .delete('/items/507f1f77bcf86cd799439011')
      .expect(204)
      .end(done);
  });

  it('should handle custom routes with detail', function(done) {
    var customCounter = testCounter;
    var CustomResource = restful.model('CustomTest' + customCounter, new restful.mongoose.Schema({ name: String }));
    CustomResource.methods(['get']);
    CustomResource.route('stats', {
      handler: function(req, res) {
        res.json({ id: req.params.id, stats: { count: 10 } });
      },
      detail: true
    });
    
    var customApp = express();
    CustomResource.register(customApp, '/custom');
    
    request(customApp)
      .get('/custom/507f1f77bcf86cd799439011/stats')
      .expect(200)
      .expect(function(res) {
        if (!res.body.stats) throw new Error('Expected stats in response');
      })
      .end(done);
  });
});
