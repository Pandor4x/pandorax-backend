const { Pool } = require('pg');
require('dotenv').config();

// Determine whether to use SSL for DB connections. Many hosted Postgres providers
// (Render, Heroku, etc.) require SSL. Allow opt-in via DB_SSL or enable in
// production or when DB_HOST is not localhost.
const useSsl = (process.env.DB_SSL === 'true') || (process.env.NODE_ENV === 'production') || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1');

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

const pool = new Pool(poolConfig);

module.exports = pool;
