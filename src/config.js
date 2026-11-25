require('dotenv').config();

function need(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing environment variable: ${key} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const jwtSecret = need('JWT_SECRET');
if (jwtSecret.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: need('DATABASE_URL'),
  dbSsl: process.env.DB_SSL !== 'false',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  corsOrigin: process.env.CORS_ORIGIN || false,
};
