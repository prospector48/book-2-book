const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const S = require('../schemas');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in 15 minutes.' } },
});

// Compared when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

const signToken = (user) =>
  jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });

// POST /api/auth/register  - always creates role USER
router.post('/register', limiter, validate(S.register), async (req, res) => {
  const { full_name, email, password, phone, latitude, longitude } = req.valid.body;
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  try {
    const { rows } = await db.query(
      `INSERT INTO public."user" (full_name, email, password_hash, phone, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${db.USER_COLS}`,
      [full_name, email, hash, phone ?? null, latitude ?? null, longitude ?? null]
    );
    res.status(201).json({ user: rows[0], token: signToken(rows[0]) });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    throw err;
  }
});

// POST /api/auth/login
router.post('/login', limiter, validate(S.login), async (req, res) => {
  const { email, password } = req.valid.body;
  const { rows } = await db.query(
    `SELECT ${db.USER_COLS}, password_hash FROM public."user" WHERE lower(email) = $1`,
    [email]
  );
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect.');

  const { password_hash, ...user } = row; // strip the hash before responding
  res.json({ user, token: signToken(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT ${db.USER_COLS} FROM public."user" WHERE id = $1`, [req.user.id]);
  res.json({ user: rows[0] });
});

module.exports = router;
