import { fileURLToPath } from "node:url";
import { pool, query, tx } from "./db.js";
import { hashPassword } from "./auth.js";

/* =====================================================================
   Starting catalogue — inserted ONCE on the very first boot. After that,
   products, locations and ranches are managed in BladeOS → Setup, and
   renames or retirements are never undone by a redeploy.
   ===================================================================== */
export const LOCATIONS = ["Cold Room A", "Cold Room B", "Display Chiller", "Freezer 01", "Freezer 02", "Processing Area"];
export const RANCHES = ["Ranch A — Kuje", "Ranch B — Gwagwalada"];
export const PRODUCTS = [
  // sku, name, category, unit, price, cost, min
  ["PB-BEEF", "Premium Beef", "Beef", "KG", 8500, 5270, 40],
  ["STEW-BEEF", "Stew Cuts", "Beef", "KG", 6800, 4216, 30],
  ["BL-BEEF", "Boneless Beef", "Beef", "KG", 9200, 5704, 20],
  ["MINCE-BEEF", "Minced Beef", "Beef", "KG", 7200, 4464, 20],
  ["OTH-BEEF", "Other Beef Cuts", "Beef", "KG", 5600, 3472, 15],
  ["GOAT-MEAT", "Goat Meat", "Goat", "KG", 7800, 4836, 25],
  ["RAM-MEAT", "Ram Meat", "Sheep", "KG", 8200, 5084, 10],
  ["CHICKEN", "Chicken", "Poultry", "Unit", 7200, 4464, 30],
  ["TURKEY", "Turkey", "Poultry", "Unit", 15500, 9610, 15],
  ["SAUSAGE", "Sausages", "Processed", "Pack", 3200, 1984, 20],
  ["KPOMO", "Kpomo", "By-product", "KG", 2600, 1612, 10],
];

export async function seedReference() {
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(727275)");
    const done = (await db.query("SELECT 1 FROM settings WHERE key = 'reference_seeded'")).rows[0];
    if (done) return;
    for (const [i, name] of LOCATIONS.entries()) {
      // Safe ranges: freezers −30 to −18 °C, chillers/cold rooms 0–4 °C, cutting room 0–10 °C.
      const range = /^freezer/i.test(name) ? [-30, -18] : /^processing/i.test(name) ? [0, 10] : [0, 4];
      await db.query("INSERT INTO storage_locations (name, sort, sells_first, temp_min, temp_max) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING",
        [name, i, name === "Display Chiller", range[0], range[1]]);
    }
    for (const name of RANCHES) await db.query("INSERT INTO ranches (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    for (const [i, p] of PRODUCTS.entries()) {
      await db.query(
        `INSERT INTO products (sku, name, category, unit, price, cost_price, min_stock, sort, plu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (sku) DO NOTHING`,
        [...p, i, i + 1]   // PLU 1, 2, 3… for scale-printed labels
      );
    }
    await db.query("INSERT INTO settings (key, value) VALUES ('reference_seeded', 'true'::jsonb)");
    console.log("Starting catalogue created: products, storage locations, ranches.");
  });
}

/** Creates the first Owner from ADMIN_EMAIL / ADMIN_PASSWORD if there are no users yet. */
export async function ensureOwner() {
  const { rows } = await query("SELECT count(*)::int AS n FROM users");
  if (rows[0].n > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    console.warn("\n⚠️  No users exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) and redeploy to create the first Owner account.\n");
    return;
  }
  // ADMIN_PASSWORD lives in the hosting dashboard, so it's treated as temporary and must be replaced at first sign-in.
  await query("INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES ($1, lower($2), 'Owner', $3, TRUE)",
    [process.env.ADMIN_NAME || "Owner", email, await hashPassword(password)]);
  console.log(`Created Owner account: ${email}`);
}

/** Called on every boot: reference data (idempotent) + first Owner. Business data is entered by staff. */
export async function bootstrap() {
  await seedReference();
  await ensureOwner();
  const { breakGlassMfa } = await import("./auth.js");
  await breakGlassMfa();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { migrate } = await import("./migrate.js");
  migrate()
    .then(bootstrap)
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
