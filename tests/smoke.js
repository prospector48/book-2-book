// End-to-end smoke test. Start the server first (npm start), then: npm run test:smoke
// Creates two throw-away users (random emails) and walks through the whole swap flow.
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const run = Date.now();
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) { failed++; if (extra) console.log('      ', JSON.stringify(extra)); }
}

(async () => {
  const pw = 'Test12345';
  // Cairo and Giza (about 10-20 km apart)
  const a = await call('POST', '/auth/register', { body: { full_name: 'Alice Test', email: `alice${run}@test.com`, password: pw, latitude: 30.0444, longitude: 31.2357 } });
  const b = await call('POST', '/auth/register', { body: { full_name: 'Bob Test', email: `bob${run}@test.com`, password: pw, phone: '+201000000000', latitude: 30.0131, longitude: 31.2089 } });
  check('register alice', a.status === 201 && !('password_hash' in a.data.user), a);
  check('register bob', b.status === 201, b);

  check('weak password rejected', (await call('POST', '/auth/register', { body: { full_name: 'X Y', email: 'x@y.com', password: 'short' } })).status === 400);
  check('duplicate email rejected', (await call('POST', '/auth/register', { body: { full_name: 'Alice 2', email: `ALICE${run}@test.com`, password: pw } })).status === 409);
  check('wrong password rejected', (await call('POST', '/auth/login', { body: { email: `alice${run}@test.com`, password: 'Wrong12345' } })).status === 401);

  const la = await call('POST', '/auth/login', { body: { email: `alice${run}@test.com`, password: pw } });
  check('login alice', la.status === 200 && la.data.token && !JSON.stringify(la.data).includes('password'), la);
  const A = la.data.token;
  const B = (await call('POST', '/auth/login', { body: { email: `bob${run}@test.com`, password: pw } })).data.token;

  check('no token -> 401', (await call('GET', '/users/me')).status === 401);
  check('USER cannot list users -> 403', (await call('GET', '/users', { token: A })).status === 403);

  const title = `Smoke Book ${run}`;
  const bobBook = await call('POST', '/listings', { token: B, body: { listing_type: 'OFFER', book: { title, author: 'Smoke Author' }, condition: 'GOOD' } });
  const aliceBook = await call('POST', '/listings', { token: A, body: { listing_type: 'OFFER', book: { title: `Alice Book ${run}`, author: 'Someone' }, condition: 'LIKE_NEW' } });
  check('bob lists a book', bobBook.status === 201, bobBook);
  check('alice lists a book', aliceBook.status === 201, aliceBook);

  const near = await call('GET', `/books/nearby?q=${encodeURIComponent(title)}&radius_km=50`, { token: A });
  check('alice finds bob\'s book nearby (saved location)', near.status === 200 && near.data.count === 1 && near.data.results[0].distance_km > 0, near);
  check('bad coordinates rejected', (await call('GET', '/books/nearby?lat=999&lng=0', { token: A })).status === 400);

  const ex = await call('POST', '/exchanges', { token: A, body: { requested_listing_id: bobBook.data.listing.id, offered_listing_id: aliceBook.data.listing.id } });
  check('alice requests a swap', ex.status === 201 && ex.data.exchange.status === 'PENDING', ex);
  const id = ex.data.exchange.id;

  check('bob sees it incoming', (await call('GET', '/exchanges?box=incoming', { token: B })).data.count >= 1);
  check('requester cannot accept -> 403', (await call('PATCH', `/exchanges/${id}/status`, { token: A, body: { status: 'ACCEPTED' } })).status === 403);
  const acc = await call('PATCH', `/exchanges/${id}/status`, { token: B, body: { status: 'ACCEPTED' } });
  check('bob accepts', acc.status === 200 && acc.data.exchange.status === 'ACCEPTED', acc);
  const gone = await call('GET', `/books/nearby?q=${encodeURIComponent(title)}`, { token: A });
  check('accepted book no longer searchable', gone.data.count === 0, gone);
  const done = await call('PATCH', `/exchanges/${id}/status`, { token: A, body: { status: 'COMPLETED' } });
  check('alice completes', done.status === 200 && done.data.exchange.status === 'COMPLETED', done);

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
