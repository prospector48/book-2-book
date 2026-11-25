class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const send = (status, code, message, details) =>
    res.status(status).json({ error: { code, message, details } });

  if (err instanceof HttpError) return send(err.status, err.code, err.message, err.details);
  if (err.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  if (err.type === 'entity.too.large') return send(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  if (err.code === '22P02') return send(400, 'BAD_ID', 'One of the ids is not a valid UUID.');
  if (err.code === '23505') return send(409, 'DUPLICATE', 'This record already exists.');
  if (err.code === '23503')
    return send(409, 'IN_USE', 'This record is still referenced by other records (for example swap requests) and cannot be deleted.');

  console.error(err);
  return send(500, 'SERVER_ERROR', 'Something went wrong on our side. Please try again.');
}

module.exports = { HttpError, notFound, errorHandler };
