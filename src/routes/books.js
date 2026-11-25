const router = require('express').Router();
const db = require('../db');
const S = require('../schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');

router.use(requireAuth);

// Escape LIKE wildcards so "100%" is searched literally.
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

// GET /api/books/nearby?q=harry&lat=30.04&lng=31.23&radius_km=25
// Available OFFER listings near a point, nearest first.
// If lat/lng are omitted, the user's saved location is used.
// NOTE: this route must stay ABOVE "/:id".
router.get('/nearby', validate(S.nearbyQuery, 'query'), async (req, res) => {
  const { q, radius_km } = req.valid.query;
  let { lat, lng } = req.valid.query;

  if (lat === undefined) {
    const { rows } = await db.query('SELECT latitude, longitude FROM public."user" WHERE id = $1', [req.user.id]);
    if (rows[0].latitude == null) {
      throw new HttpError(400, 'NO_LOCATION',
        'Send lat and lng, or save your location first with PATCH /api/users/me.');
    }
    lat = rows[0].latitude;
    lng = rows[0].longitude;
  }

  const { rows } = await db.query(
    'SELECT * FROM public.find_nearby_offers($1, $2, $3, $4, $5) LIMIT 50',
    [escapeLike(q), lat, lng, radius_km, req.user.id]
  );

  res.json({
    count: rows.length,
    search_center: { lat, lng },
    radius_km,
    results: rows.map((r) => ({ ...r, distance_km: Math.round(r.distance_km * 10) / 10 })),
  });
});

// GET /api/books?q=&category=&limit=&offset=
router.get('/', validate(S.listBooks, 'query'), async (req, res) => {
  const { q, category, limit, offset } = req.valid.query;
  const like = `%${escapeLike(q)}%`;
  const { rows } = await db.query(
    `SELECT id, title, author, isbn, category, created_at FROM public.book
     WHERE (title ILIKE $1 OR author ILIKE $1) AND ($2::text IS NULL OR category = $2)
     ORDER BY title LIMIT $3 OFFSET $4`,
    [like, category ?? null, limit, offset]
  );
  res.json({ count: rows.length, books: rows });
});

// GET /api/books/:id
router.get('/:id', validate(S.idParam, 'params'), async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, title, author, isbn, category, created_at FROM public.book WHERE id = $1',
    [req.valid.params.id]
  );
  if (!rows[0]) throw new HttpError(404, 'BOOK_NOT_FOUND', 'Book not found.');
  res.json({ book: rows[0] });
});

// POST /api/books
router.post('/', validate(S.createBook), async (req, res) => {
  const { title, author, isbn, category } = req.valid.body;
  const { rows } = await db.query(
    `INSERT INTO public.book (title, author, isbn, category) VALUES ($1,$2,$3,$4)
     RETURNING id, title, author, isbn, category, created_at`,
    [title, author, isbn ?? null, category ?? null]
  );
  res.status(201).json({ book: rows[0] });
});

// DELETE /api/books/:id  (ADMIN) - fails with 409 if any listing uses the book
router.delete('/:id', requireRole('ADMIN'), validate(S.idParam, 'params'), async (req, res) => {
  const r = await db.query('DELETE FROM public.book WHERE id = $1', [req.valid.params.id]);
  if (!r.rowCount) throw new HttpError(404, 'BOOK_NOT_FOUND', 'Book not found.');
  res.status(204).end();
});

module.exports = router;
