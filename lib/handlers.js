var _ = require('underscore');
var mongoose = require('mongoose');

/*
 * The last handler to be called in the chain of middleware
 * This figures out what response format it should be in and sends it
 */
exports.last = function(req, res, next) {
  if (res.locals.bundle) {
    if (req.body.format === 'js') {
      return res.send(res.locals.bundle);
    } else if (req.body.format === 'html' || req.query.format === 'html') {
      return res.render(this.templateRoot + '/' + req.templatePath, res.locals.bundle);
    } else {
      return res.status(res.locals.status_code).json(res.locals.bundle);
    }
  }
  res.send();
};

exports.schema = function(req, res, next) {
  // We can mount a model to multiple apps, so we need to get the base url from the request url
  var baseuri = req.url.split('/');
  baseuri = baseuri.slice(0, baseuri.length - 1).join('/');
  var detailuri = baseuri + '/:id';
  exports.respond(res, 200, {
    resource: this.modelName,
    allowed_methods: Object.keys(this.allowed_methods),
    list_uri: baseuri,
    detail_uri: detailuri,
    fields: keep(this.schema.paths, ['regExp', 'path', 'instance', 'isRequired'])
  });
  next();
};

exports.get = async function(req, res, next) {
  if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
    exports.respond(res, 404, exports.objectNotFound());
    next();
  } else {
    try {
      const list = await req.quer;
      if (req.params.id) {
        exports.respondOrErr(res, 404, !list && exports.objectNotFound(), 200, (list && _.isArray(list)) ? list[0] : list);
        next();
      } else {
        delete req.quer.options;
        try {
          const total = await req.quer.countDocuments();
          res.set('X-Total-Count', total);
          exports.respond(res, 200, list);
          next();
        } catch (err) {
          exports.respond(res, 500, err);
          next();
        }
      }
    } catch (err) {
      exports.respond(res, 500, err);
      next();
    }
  }
};

exports.getDetail = async function(req, res, next) {
  try {
    const one = await req.quer;
    exports.respond(res, 200, one);
    next();
  } catch (err) {
    exports.respond(res, 500, err);
    next();
  }
};

/**
 * Generates a handler that returns the object at @param pathName
 * where pathName is the path to an objectId field
 */
exports.getPath = function(pathName) {
  return async function(req, res, next) {
    req.quer = req.quer.populate(pathName);
    try {
      const one = await req.quer;
      exports.respond(res, 200, (one && one.get(pathName)) || {});
      next();
    } catch (err) {
      var errStatus = ((err && err.status) ? err.status : 500);
      exports.respond(res, errStatus, err);
      next();
    }
  };
};

exports.post = async function(req, res, next) {
  var obj = new this(req.body);
  try {
    await obj.save();
    exports.respond(res, 201, obj);
    next();
  } catch (err) {
    exports.respond(res, 400, err);
    next();
  }
};

exports.put = async function(req, res, next) {
  // Remove immutable ObjectId from update attributes to prevent request failure
  if (req.body._id && req.body._id === req.params.id) {
    delete req.body._id;
  }

  // Update in 1 atomic operation on the database if not specified otherwise
  try {
    const newObj = await req.quer.findOneAndReplace({'_id': req.params.id}, req.body, { omitUndefined: true, ...this.update_options});
    if (!newObj) {
      exports.respond(res, 404, exports.objectNotFound());
    } else {
      exports.respond(res, 200, newObj);
    }
    next();
  } catch (err) {
    exports.respond(res, 500, err);
    next();
  }
};

exports.patch = async function(req, res, next) {
  // Remove immutable ObjectId from update attributes to prevent request failure
  if (req.body._id && req.body._id === req.params.id) {
    delete req.body._id;
  }

  // Update in 1 atomic operation on the database if not specified otherwise
  if (this.shouldUseAtomicUpdate) {
    try {
      const newObj = await req.quer.findOneAndUpdate({}, req.body, this.update_options);
      if (!newObj) {
        exports.respond(res, 404, exports.objectNotFound());
      } else {
        exports.respond(res, 200, newObj);
      }
      next();
    } catch (err) {
      exports.respond(res, 500, err);
      next();
    }
  } else {
    // Preform the update in two operations allowing mongoose to fire its schema update hook
    try {
      const docToUpdate = await req.quer.findOne({"_id": req.params.id});
      var objNotFound = !docToUpdate && exports.objectNotFound();
      if (objNotFound) {
        exports.respond(res, 404, objNotFound);
        return next();
      }

      docToUpdate.set(req.body);
      try {
        const obj = await docToUpdate.save();
        exports.respond(res, 200, obj);
        next();
      } catch (err) {
        exports.respond(res, 400, err);
        next();
      }
    } catch (err) {
      exports.respond(res, 500, err);
      next();
    }
  }
};

exports.delete = async function(req, res, next) {
  // Delete in 1 atomic operation on the database if not specified otherwise
  if (this.shouldUseAtomicUpdate) {
    try {
      const obj = await req.quer.findOneAndRemove({}, this.delete_options);
      if (!obj) {
        exports.respond(res, 404, exports.objectNotFound());
      } else {
        exports.respond(res, 204, {});
      }
      next();
    } catch (err) {
      exports.respond(res, 500, err);
      next();
    }
  } else {
    // Preform the remove in two steps allowing mongoose to fire its schema update hook
    try {
      const docToRemove = await req.quer.findOne({"_id": req.params.id});
      var objNotFound = !docToRemove && exports.objectNotFound();
      if (objNotFound) {
        exports.respond(res, 404, objNotFound);
        return next();
      }

      try {
        await docToRemove.remove();
        exports.respond(res, 204, {});
        next();
      } catch (err) {
        exports.respond(res, 400, err);
        next();
      }
    } catch (err) {
      exports.respond(res, 500, err);
      next();
    }
  }
};

// I'm going to leave these here because it might be nice to have standardized
// error messages for common failures

exports.objectNotFound = function() {
  return {
    status: 404,
    message: 'Object not found',
    name: 'ObjectNotFound',
    errors: {
      _id: {
        message: "Could not find object with specified attributes"
      }
    }
  };
};
exports.respond404 = function() {
  return {
    status: 404,
    message: 'Page Not Found',
    name: "PageNotFound",
    errors: 'Endpoint not found for model ' + this.modelName
  };
};
exports.authFailure = function() {
  return {
    status: 401,
    message: 'Unauthorized',
    name: "Unauthorized",
    errors: 'Operation not authorzed on ' + this.modelName
  };
};
exports.badRequest = function(errobj) {
  return {
    status: 400,
    message: 'Bad Request',
    name: "BadRequest",
    errors: errobj || "Your request was invalid"
  };
};

/**
 * Takes a response, error, success statusCode and success payload
 *
 * If there is an error, it returns a 400 with the error as the payload
 * If there is no error, it returns statusCode with the specified payload
 *
 */
exports.respondOrErr = function(res, errStatusCode, err, statusCode, content) {
  if (err) {
    exports.respond(res, errStatusCode, err);
  } else {
    exports.respond(res, statusCode, content);
  }
};

exports.respond = function(res, statusCode, content) {
  res.locals.status_code = statusCode;
  res.locals.bundle = content;
};

function keep(obj, keepers) {
  var result = {};
  for (var key in obj) {
    result[key] = {};
    for (var key2 in obj[key]) {
      if (keepers.indexOf(key2) > -1) {
        result[key][key2] = obj[key][key2];
      }
      if ('schema' === key2) {
        result[key][key2] = keep(obj[key][key2].paths, keepers);
      }
    }
  }
  return result;
}
