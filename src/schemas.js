const { z } = require('zod');

const uuid = z.string().uuid('Must be a valid id');
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Phone looks invalid');

const bothOrNeither = (o) => (o.latitude === undefined) === (o.longitude === undefined);
const locMsg = { message: 'Send latitude and longitude together', path: ['latitude'] };

const idParam = z.object({ id: uuid });

const register = z
  .object({
    full_name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(255),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters')
      .regex(/[A-Za-z]/, 'Password needs a letter')
      .regex(/[0-9]/, 'Password needs a number'),
    phone: phone.optional(),
    latitude: lat.optional(),
    longitude: lng.optional(),
  })
  .strict()
  .refine(bothOrNeither, locMsg);

const login = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(1).max(72),
  })
  .strict();

const updateMe = z
  .object({
    full_name: z.string().trim().min(2).max(100),
    phone: phone.nullable(),
    latitude: lat,
    longitude: lng,
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'Send at least one field to update' })
  .refine(bothOrNeither, locMsg);

const setRole = z.object({ role: z.enum(['USER', 'ADMIN']) }).strict();

const bookFields = {
  title: z.string().trim().min(1).max(255),
  author: z.string().trim().min(1).max(150),
  isbn: z.string().trim().max(20).optional(),
  category: z.string().trim().max(100).optional(),
};
const createBook = z.object(bookFields).strict();

const listBooks = z.object({
  q: z.string().trim().max(100).default(''),
  category: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const nearbyQuery = z
  .object({
    q: z.string().trim().max(100).default(''),
    lat: lat.optional(),
    lng: lng.optional(),
    radius_km: z.coerce.number().min(0.1).max(500).default(50),
  })
  .refine((o) => (o.lat === undefined) === (o.lng === undefined), {
    message: 'Send lat and lng together (or neither to use your saved location)',
    path: ['lat'],
  });

const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'];

const createListing = z
  .object({
    listing_type: z.enum(['OFFER', 'WANTED']),
    book_id: uuid.optional(),
    book: z.object(bookFields).strict().optional(),
    condition: z.enum(CONDITIONS).optional(),
    photo_url: z.string().url().max(2000).optional(),
  })
  .strict()
  .refine((o) => !!o.book_id !== !!o.book, {
    message: 'Send either book_id (existing book) or book {title, author} (new book), not both',
    path: ['book_id'],
  });

const updateListing = z
  .object({
    condition: z.enum(CONDITIONS),
    photo_url: z.string().url().max(2000).nullable(),
    is_available: z.boolean(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'Send at least one field to update' });

const createExchange = z
  .object({ requested_listing_id: uuid, offered_listing_id: uuid })
  .strict()
  .refine((o) => o.requested_listing_id !== o.offered_listing_id, {
    message: 'Requested and offered listing must be different',
    path: ['offered_listing_id'],
  });

const listExchanges = z.object({
  box: z.enum(['incoming', 'outgoing', 'all']).default('all'),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED']).optional(),
});

const setExchangeStatus = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'COMPLETED']) }).strict();

module.exports = {
  idParam, register, login, updateMe, setRole, createBook, listBooks, nearbyQuery,
  createListing, updateListing, createExchange, listExchanges, setExchangeStatus,
};
