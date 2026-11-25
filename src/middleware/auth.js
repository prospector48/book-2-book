const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { HttpError } = require('./errors');

// Verifies the Bearer token, then loads the CURRENT user (so deleted users
// or changed roles take effect immediately, not only when the token expires).
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'NO_TOKEN', 'Missing token. Send header "Authorization: Bearer <token>".');
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    throw new HttpError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      expired ? 'Your session expired. Please log in again.' : 'Invalid token.');
  }

  const { rows } = await db.query('SELECT id, full_name, email, role FROM public."user" WHERE id = $1', [payload.sub]);
  if (!rows[0]) throw new HttpError(401, 'USER_NOT_FOUND', 'This account no longer exists.');

  req.user = rows[0];
  next();
}

// requireRole('ADMIN') - use AFTER requireAuth
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    throw new HttpError(403, 'FORBIDDEN', `This action requires role: ${roles.join(' or ')}.`);
  }
  next();
};

module.exports = { requireAuth, requireRole };
