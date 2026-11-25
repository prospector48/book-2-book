const router = require('express').Router();
const db = require('../db');
const S = require('../schemas');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');

router.use(requireAuth);

// POST /api/listings  - "list a book"
// Send book_id (existing) OR book {title, author, ...} (created or reused if same title+author).
router.post('/', validate(S.createListing), async (req, res) => {
  const { listing_type, book_id, book, condition, photo_url } = req.valid.body;

  const created = await db.tx(async (c) => {
    let bookId = book_id;
    if (book) {
      const found = await c.query(
        'SELECT id FROM public.book WHERE lower(title) = lower($1) AND lower(author) = lower($2) LIMIT 1',
        [book.title, book.author]
      );
      if (found.rows[0]) bookId = found.rows[0].id;
      else {
        const ins = await c.query(
          'INSERT INTO public.book (title, author, isbn, category) VALUES ($1,$2,$3,$4) RETURNING id',
          [book.title, book.author, book.isbn ?? null, book.category ?? null]
        );
        bookId = ins.rows[0].id;
      }
    } else {
      const exists = await c.query('SELECT 1 FROM public.book WHERE id = $1', [bookId]);
      if (!exists.rowCount) throw new HttpError(404, 'BOOK_NOT_FOUND', 'That book_id does not exist.');
    }

    const { rows } = await c.query(
      `INSERT INTO public.listing (user_id, book_id, listing_type, condition, photo_url)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, book_id, listing_type, condition, photo_url, is_available, created_at`,
      [req.user.id, bookId, listing_type, condition ?? null, photo_url ?? null]
    );
    return rows[0];
  });

  res.status(201).json({ listing: created });
});

// GET /api/listings/mine  - "my books"
router.get('/mine', async (req, res) => {
  const { rows } = await db.query(
    `SELECT l.id, l.listing_type, l.condition, l.photo_url, l.is_available, l.created_at,
            b.id AS book_id, b.title, b.author
     FROM public.listing l JOIN public.book b ON b.id = l.book_id
     WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
    [req.user.id]
  );
  res.json({ count: rows.length, listings: rows });
});

// PATCH /api/listings/:id  (owner only)
router.patch('/:id', validate(S.idParam, 'params'), validate(S.updateListing), async (req, res) => {
  const allowed = ['condition', 'photo_url', 'is_available'];
  const keys = allowed.filter((k) => req.valid.body[k] !== undefined);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const { rows } = await db.query(
    `UPDATE public.listing SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2
     RETURNING id, book_id, listing_type, condition, photo_url, is_available, created_at`,
    [req.valid.params.id, req.user.id, ...keys.map((k) => req.valid.body[k])]
  );
  if (!rows[0]) throw new HttpError(404, 'LISTING_NOT_FOUND', 'Listing not found (or it is not yours).');
  res.json({ listing: rows[0] });
});

// DELETE /api/listings/:id  (owner only) - 409 if it is used in a swap request
router.delete('/:id', validate(S.idParam, 'params'), async (req, res) => {
  const r = await db.query('DELETE FROM public.listing WHERE id = $1 AND user_id = $2', [
    req.valid.params.id, req.user.id,
  ]);
  if (!r.rowCount) throw new HttpError(404, 'LISTING_NOT_FOUND', 'Listing not found (or it is not yours).');
  res.status(204).end();
});

module.exports = router;
