const router = require('express').Router();
const db = require('../db');
const S = require('../schemas');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');

router.use(requireAuth);

const SELECT_EXCHANGE = `
  SELECT e.id, e.status, e.created_at,
         e.requester_id, ru.full_name AS requester_name,
         e.receiver_id,  vu.full_name AS receiver_name,
         e.requested_listing_id, rb.title AS requested_title, rb.author AS requested_author,
         e.offered_listing_id,   ob.title AS offered_title,   ob.author AS offered_author,
         CASE WHEN e.status IN ('ACCEPTED','COMPLETED') THEN ru.phone END AS requester_phone,
         CASE WHEN e.status IN ('ACCEPTED','COMPLETED') THEN vu.phone END AS receiver_phone
  FROM public.exchange e
  JOIN public."user" ru ON ru.id = e.requester_id
  JOIN public."user" vu ON vu.id = e.receiver_id
  JOIN public.listing rl ON rl.id = e.requested_listing_id JOIN public.book rb ON rb.id = rl.book_id
  JOIN public.listing ol ON ol.id = e.offered_listing_id   JOIN public.book ob ON ob.id = ol.book_id`;

// POST /api/exchanges  - ask to swap: "I want requested listing, I give offered listing"
router.post('/', validate(S.createExchange), async (req, res) => {
  const { requested_listing_id, offered_listing_id } = req.valid.body;

  const { rows } = await db.query(
    'SELECT id, user_id, listing_type, is_available FROM public.listing WHERE id = ANY($1::uuid[])',
    [[requested_listing_id, offered_listing_id]]
  );
  const requested = rows.find((r) => r.id === requested_listing_id);
  const offered = rows.find((r) => r.id === offered_listing_id);

  if (!requested) throw new HttpError(404, 'REQUESTED_NOT_FOUND', 'The listing you want does not exist.');
  if (!offered) throw new HttpError(404, 'OFFERED_NOT_FOUND', 'The listing you are offering does not exist.');
  if (requested.listing_type !== 'OFFER' || !requested.is_available)
    throw new HttpError(409, 'NOT_AVAILABLE', 'That book is not available for swapping.');
  if (requested.user_id === req.user.id)
    throw new HttpError(400, 'OWN_LISTING', 'You cannot request your own book.');
  if (offered.user_id !== req.user.id)
    throw new HttpError(403, 'NOT_YOUR_LISTING', 'The book you offer must be one of your own listings.');
  if (offered.listing_type !== 'OFFER' || !offered.is_available)
    throw new HttpError(409, 'OFFERED_NOT_AVAILABLE', 'The book you offer is not marked as available.');

  const dup = await db.query(
    `SELECT 1 FROM public.exchange
     WHERE requester_id=$1 AND requested_listing_id=$2 AND offered_listing_id=$3 AND status='PENDING'`,
    [req.user.id, requested_listing_id, offered_listing_id]
  );
  if (dup.rowCount) throw new HttpError(409, 'DUPLICATE_REQUEST', 'You already sent this exact request.');

  const ins = await db.query(
    `INSERT INTO public.exchange (requester_id, receiver_id, requested_listing_id, offered_listing_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.user.id, requested.user_id, requested_listing_id, offered_listing_id]
  );
  const full = await db.query(`${SELECT_EXCHANGE} WHERE e.id = $1`, [ins.rows[0].id]);
  res.status(201).json({ exchange: full.rows[0] });
});

// GET /api/exchanges?box=incoming|outgoing|all&status=PENDING   - "my swap requests"
router.get('/', validate(S.listExchanges, 'query'), async (req, res) => {
  const { box, status } = req.valid.query;
  const where = {
    incoming: 'e.receiver_id = $1',
    outgoing: 'e.requester_id = $1',
    all: '(e.receiver_id = $1 OR e.requester_id = $1)',
  }[box];
  const params = [req.user.id];
  let sql = `${SELECT_EXCHANGE} WHERE ${where}`;
  if (status) {
    params.push(status);
    sql += ' AND e.status = $2';
  }
  const { rows } = await db.query(`${sql} ORDER BY e.created_at DESC LIMIT 100`, params);
  res.json({ count: rows.length, exchanges: rows });
});

// GET /api/exchanges/:id  (participants only)
router.get('/:id', validate(S.idParam, 'params'), async (req, res) => {
  const { rows } = await db.query(
    `${SELECT_EXCHANGE} WHERE e.id = $1 AND (e.requester_id = $2 OR e.receiver_id = $2)`,
    [req.valid.params.id, req.user.id]
  );
  if (!rows[0]) throw new HttpError(404, 'EXCHANGE_NOT_FOUND', 'Swap request not found.');
  res.json({ exchange: rows[0] });
});

// PATCH /api/exchanges/:id/status
//   PENDING  -> ACCEPTED | REJECTED   (receiver only)
//   ACCEPTED -> COMPLETED             (either participant)
router.patch('/:id/status', validate(S.idParam, 'params'), validate(S.setExchangeStatus), async (req, res) => {
  const { id } = req.valid.params;
  const { status: next } = req.valid.body;

  await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM public.exchange WHERE id = $1 FOR UPDATE', [id]);
    const ex = rows[0];
    const isParticipant = ex && (ex.requester_id === req.user.id || ex.receiver_id === req.user.id);
    if (!isParticipant) throw new HttpError(404, 'EXCHANGE_NOT_FOUND', 'Swap request not found.');

    if (next === 'COMPLETED') {
      if (ex.status !== 'ACCEPTED')
        throw new HttpError(409, 'BAD_TRANSITION', `Only ACCEPTED swaps can be completed (this one is ${ex.status}).`);
    } else {
      if (ex.receiver_id !== req.user.id)
        throw new HttpError(403, 'NOT_RECEIVER', 'Only the owner of the requested book can accept or reject.');
      if (ex.status !== 'PENDING')
        throw new HttpError(409, 'BAD_TRANSITION', `Only PENDING swaps can be ${next.toLowerCase()} (this one is ${ex.status}).`);
    }

    if (next === 'ACCEPTED') {
      const ids = [ex.requested_listing_id, ex.offered_listing_id];
      const l = await c.query('SELECT id, is_available FROM public.listing WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids]);
      if (l.rows.length !== 2 || l.rows.some((x) => !x.is_available))
        throw new HttpError(409, 'NOT_AVAILABLE', 'One of the books is no longer available.');

      await c.query('UPDATE public.listing SET is_available = FALSE WHERE id = ANY($1::uuid[])', [ids]);
      // Other pending requests that involve these books can no longer happen.
      await c.query(
        `UPDATE public.exchange SET status = 'REJECTED'
         WHERE status = 'PENDING' AND id <> $1
           AND (requested_listing_id = ANY($2::uuid[]) OR offered_listing_id = ANY($2::uuid[]))`,
        [id, ids]
      );
    }

    await c.query('UPDATE public.exchange SET status = $2 WHERE id = $1', [id, next]);
  });

  const { rows } = await db.query(`${SELECT_EXCHANGE} WHERE e.id = $1`, [id]);
  res.json({ exchange: rows[0] });
});

module.exports = router;
