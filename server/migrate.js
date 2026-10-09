import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Applies migrations/*.sql in order, once each. Safe to run on every boot. */
export async function migrate() {
  const client = await pool.connect();
  try {
    // Advisory lock so two instances booting together don't race.
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(DIR, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`Migration applied: ${f}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => { console.log("Migrations up to date."); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
