const { Pool } = require('pg');
require('dotenv').config();

// Determine whether to use SSL for DB connections. Many hosted Postgres providers
// (Render, Heroku, etc.) require SSL. Allow opt-in via DB_SSL or enable in
// production or when DB_HOST is not localhost.
const useSsl = (process.env.DB_SSL === 'true') || (process.env.NODE_ENV === 'production') || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1');

let pool;

// If a full connection string is provided (e.g., Render/Heroku `DATABASE_URL`), prefer it.
if (process.env.DATABASE_URL) {
  const opts = { connectionString: process.env.DATABASE_URL };
  if (useSsl) opts.ssl = { rejectUnauthorized: false };
  pool = new Pool(opts);
} else {
  const poolConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  };
  if (useSsl) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  pool = new Pool(poolConfig);
}

// Log pool-level errors (useful when connections are refused or SSL fails)
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
