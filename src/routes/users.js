const router = require('express').Router();
const db = require('../db');
const S = require('../schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');

router.use(requireAuth);

// GET /api/users/me
router.get('/me', async (req, res) => {
  const { rows } = await db.query(`SELECT ${db.USER_COLS} FROM public."user" WHERE id = $1`, [req.user.id]);
  res.json({ user: rows[0] });
});

// PATCH /api/users/me  - name, phone, location (this is how a user saves their location)
router.patch('/me', validate(S.updateMe), async (req, res) => {
  const allowed = ['full_name', 'phone', 'latitude', 'longitude'];
  const keys = allowed.filter((k) => req.valid.body[k] !== undefined);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await db.query(
    `UPDATE public."user" SET ${sets.join(', ')} WHERE id = $1 RETURNING ${db.USER_COLS}`,
    [req.user.id, ...keys.map((k) => req.valid.body[k])]
  );
  res.json({ user: rows[0] });
});

// GET /api/users  (ADMIN)
router.get('/', requireRole('ADMIN'), async (req, res) => {
  const { rows } = await db.query(`SELECT ${db.USER_COLS} FROM public."user" ORDER BY created_at DESC LIMIT 100`);
  res.json({ count: rows.length, users: rows });
});

// GET /api/users/:id  - public profile (no email/phone/location) + rating
router.get('/:id', validate(S.idParam, 'params'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.created_at,
            AVG(r.rating)::float8 AS avg_rating, COUNT(r.id)::int AS review_count
     FROM public."user" u LEFT JOIN public.review r ON r.reviewed_user_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [req.valid.params.id]
  );
  if (!rows[0]) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
  res.json({ user: rows[0] });
});

// PATCH /api/users/:id/role  (ADMIN)
router.patch('/:id/role', requireRole('ADMIN'), validate(S.idParam, 'params'), validate(S.setRole), async (req, res) => {
  if (req.valid.params.id === req.user.id) throw new HttpError(400, 'SELF_ROLE_CHANGE', 'You cannot change your own role.');
  const { rows } = await db.query(
    `UPDATE public."user" SET role = $2 WHERE id = $1 RETURNING ${db.USER_COLS}`,
    [req.valid.params.id, req.valid.body.role]
  );
  if (!rows[0]) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
  res.json({ user: rows[0] });
});

// DELETE /api/users/:id  (ADMIN)
router.delete('/:id', requireRole('ADMIN'), validate(S.idParam, 'params'), async (req, res) => {
  if (req.valid.params.id === req.user.id) throw new HttpError(400, 'SELF_DELETE', 'You cannot delete your own account here.');
  const r = await db.query('DELETE FROM public."user" WHERE id = $1', [req.valid.params.id]);
  if (!r.rowCount) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
  res.status(204).end();
});

module.exports = router;
