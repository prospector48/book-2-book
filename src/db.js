const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: 10,
});
pool.on('error', (e) => console.error('Unexpected DB error:', e.message));

// Run several queries atomically.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// The ONLY user columns the API may return. password_hash is never listed.
const USER_COLS = 'id, full_name, email, role, phone, latitude, longitude, created_at';

module.exports = { query: (t, p) => pool.query(t, p), tx, pool, USER_COLS };
