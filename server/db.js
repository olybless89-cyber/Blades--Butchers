import pg from "pg";

// Return NUMERIC and BIGINT as JS numbers (money is whole Naira, well within safe range).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. On Railway, add a Postgres service and reference ${{Postgres.DATABASE_URL}}.");
  process.exit(1);
}

const isInternal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const ssl = process.env.PGSSL === "true" ? { rejectUnauthorized: false } : process.env.PGSSL === "false" || isInternal ? false : { rejectUnauthorized: false };

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("Postgres pool error:", err.message));

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. Rolls back on any thrown error. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
