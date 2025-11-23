const { Pool } = require('pg');
require('dotenv').config();

// Determine whether to use SSL for DB connections. Many hosted Postgres providers
// (Render, Heroku, etc.) require SSL. Allow opt-in via DB_SSL or enable in
// production or when DB_HOST is not localhost.
const initialUseSsl = (process.env.DB_SSL === 'true') || (process.env.NODE_ENV === 'production') || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1');

let activePool = null;

function makePoolOptions(useSsl) {
  if (process.env.DATABASE_URL) {
    const opts = { connectionString: process.env.DATABASE_URL };
    if (useSsl) opts.ssl = { rejectUnauthorized: false };
    return opts;
  }
  const poolConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  };
  if (useSsl) poolConfig.ssl = { rejectUnauthorized: false };
  return poolConfig;
}

function attachPool(pool) {
  if (!pool) return;
  activePool = pool;
  // Mirror pool errors to console so deploy logs capture issues
  try {
    pool.on('error', (err) => {
      console.error('Unexpected error on idle Postgres client', err && (err.stack || err));
    });
  } catch (e) {
    console.warn('Could not attach error handler to pool:', e && e.message);
  }
}

// Create a pool and test connectivity. If the test fails, try the opposite SSL
// mode once and switch to it if it succeeds. This helps hosted environments
// where SSL requirements are inconsistent.
function tryCreatePoolWithFallback() {
  const trySetup = async (useSsl) => {
    const opts = makePoolOptions(useSsl);
    const attempts = 3;
    const baseDelay = 500; // ms
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const p = new Pool(opts);
      try {
        await p.query('SELECT 1');
        console.log(`DB: connected using useSsl=${useSsl} (attempt ${attempt})`);
        return p;
      } catch (err) {
        try { await p.end(); } catch (e) { /* ignore */ }
        if (attempt < attempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.warn(`DB: connect attempt ${attempt} failed, retrying in ${delay}ms...`, err && (err.stack || err));
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
        // all attempts failed
        console.warn(`DB: all ${attempts} connect attempts failed for useSsl=${useSsl}`);
        throw err;
      }
    }
  };

  // Attempt initial strategy, then fallback to opposite SSL setting once.
  return (async () => {
    const firstTrySsl = initialUseSsl;
    try {
      const p = await trySetup(firstTrySsl);
      attachPool(p);
      return;
    } catch (err1) {
      console.warn(`DB: initial connection using useSsl=${firstTrySsl} failed:`, err1 && (err1.stack || err1));
      const fallbackSsl = !firstTrySsl;
      try {
        const p2 = await trySetup(fallbackSsl);
        console.log(`DB: fallback connection succeeded using useSsl=${fallbackSsl}`);
        attachPool(p2);
        return;
      } catch (err2) {
        console.error(`DB: fallback connection using useSsl=${fallbackSsl} also failed:`, err2 && (err2.stack || err2));
        // As a last resort, create a pool with the initial options so callers
        // receive a Pool object (even if it may not connect). Attach it so
        // exported proxy methods work without throwing missing-property errors.
        const finalPool = new Pool(makePoolOptions(firstTrySsl));
        attachPool(finalPool);
        return;
      }
    }
  })();
}

// Kick off creation (async). Expose a proxy immediately so other modules can
// require this file synchronously and use `query`, `connect`, etc. Calls will
// delegate to whichever pool becomes active.
tryCreatePoolWithFallback().catch((e) => {
  console.error('DB: unexpected error during pool setup:', e && (e.stack || e));
});

// Export a proxy that forwards to the active pool instance. This keeps the
// module API compatible with existing code that calls `pool.query(...)`.
const exported = new Proxy({}, {
  get(_, prop) {
    const pool = activePool;
    if (!pool) {
      throw new Error(`Postgres pool not initialized yet; attempted to access '${String(prop)}'`);
    }
    const val = pool[prop];
    if (typeof val === 'function') return val.bind(pool);
    return val;
  }
});

module.exports = exported;
