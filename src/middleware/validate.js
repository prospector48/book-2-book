const { HttpError } = require('./errors');

// validate(schema, 'body' | 'query' | 'params')
// Validated + cleaned data is placed in req.valid[source].
module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(
      new HttpError(
        400,
        'VALIDATION_ERROR',
        'Some fields are invalid.',
        result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }))
      )
    );
  }
  req.valid = { ...(req.valid || {}), [source]: result.data };
  next();
};
