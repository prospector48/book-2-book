# BookLoop back end

Node.js 18+ / Express 5 / PostgreSQL (Supabase) / JWT + bcrypt / zod validation.

## File creation order
1. `package.json`, `.env.example`, `.gitignore`
2. `db/schemafile.sql`            (database - run once in the Supabase SQL editor)
3. `src/config.js`, `src/db.js`   (env vars + DB pool)
4. `src/middleware/errors.js`, `validate.js`, `auth.js`
5. `src/schemas.js`               (all input rules)
6. `src/routes/auth.js` -> `users.js` -> `books.js` -> `listings.js` -> `exchanges.js`
7. `src/app.js`, `src/server.js`
8. `public/index.html`, `public/search.js`  (search-nearby page)
9. `tests/smoke.js`

## Run
```bash
npm install
cp .env.example .env        # fill DATABASE_URL and JWT_SECRET
# Run db/schemafile.sql once in Supabase > SQL Editor (fresh database only)
npm start                   # http://localhost:3000
```
Open http://localhost:3000 for the search page.

## First admin
Register normally, then in the Supabase SQL editor:
```sql
UPDATE public."user" SET role = 'ADMIN' WHERE email = 'you@example.com';
```
Log in again. Later admins can be made with `PATCH /api/users/:id/role`.

## Routes
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/register | public | create account (role USER) |
| POST | /api/auth/login | public | get token |
| GET | /api/auth/me | user | current user |
| GET/PATCH | /api/users/me | user | profile, save location |
| GET | /api/users/:id | user | public profile + rating |
| GET | /api/users | admin | list users |
| PATCH | /api/users/:id/role | admin | set USER/ADMIN |
| DELETE | /api/users/:id | admin | delete user |
| GET | /api/books/nearby | user | proximity search |
| GET/POST | /api/books | user | search / create book |
| GET | /api/books/:id | user | one book |
| DELETE | /api/books/:id | admin | delete book |
| POST | /api/listings | user | list a book |
| GET | /api/listings/mine | user | my books |
| PATCH/DELETE | /api/listings/:id | owner | edit / remove |
| POST | /api/exchanges | user | request a swap |
| GET | /api/exchanges?box=incoming\|outgoing\|all | user | my swap requests |
| GET | /api/exchanges/:id | participant | one swap |
| PATCH | /api/exchanges/:id/status | participant | accept / reject / complete |

## Test every route (curl)
```bash
API=http://localhost:3000/api

# 1. Register (Cairo location)
curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"full_name":"Alice Test","email":"alice@test.com","password":"Test12345","latitude":30.0444,"longitude":31.2357}'

# 2. Login -> copy the token
curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@test.com","password":"Test12345"}'
TOKEN=paste-token-here

# 3. Me / update location
curl -s $API/auth/me -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH $API/users/me -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"latitude":30.05,"longitude":31.24}'

# 4. List a book (new book created automatically)
curl -s -X POST $API/listings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"listing_type":"OFFER","book":{"title":"Dune","author":"Frank Herbert"},"condition":"GOOD"}'
curl -s $API/listings/mine -H "Authorization: Bearer $TOKEN"

# 5. Search nearby (needs a SECOND user's listing; the search hides your own)
curl -s "$API/books/nearby?q=dune&lat=30.04&lng=31.23&radius_km=25" -H "Authorization: Bearer $TOKEN"
# omit lat/lng to use your saved location:
curl -s "$API/books/nearby?q=dune" -H "Authorization: Bearer $TOKEN"

# 6. Swap request: I want THEIR listing id, I give MY listing id
curl -s -X POST $API/exchanges -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"requested_listing_id":"THEIR_LISTING_ID","offered_listing_id":"MY_LISTING_ID"}'
curl -s "$API/exchanges?box=outgoing" -H "Authorization: Bearer $TOKEN"
# as the other user:
curl -s "$API/exchanges?box=incoming" -H "Authorization: Bearer $OTHER_TOKEN"
curl -s -X PATCH $API/exchanges/EXCHANGE_ID/status -H "Authorization: Bearer $OTHER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"ACCEPTED"}'

# 7. Admin-only (expect 403 for a normal user)
curl -s $API/users -H "Authorization: Bearer $TOKEN"
```

Automatic test of the whole flow (server must be running):
```bash
npm run test:smoke
```

## Error format
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid.",
             "details": [{ "field": "password", "message": "Password needs a number" }] } }
```
Status codes: 400 invalid input, 401 not logged in, 403 wrong role/not allowed, 404 not found, 409 conflict, 429 too many login attempts.

## Security notes
- Secrets only in `.env` (JWT secret must be 32+ chars; server refuses to start otherwise).
- Passwords hashed with bcrypt (matches the `chk_password_hash_format` constraint); the hash is never selected in any response query.
- Roles are re-read from the database on every request.
- Login is rate limited; unknown email and wrong password give the same message.
- Use the Supabase service/direct DB connection string in `DATABASE_URL` (RLS in the schema blocks the public anon key).
