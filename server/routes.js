import express from "express";
import { z } from "zod";
import { query, tx } from "./db.js";
import { authRoutes, loadUser, requireAuth, requirePerm, requirePasswordChange, hashPassword, publicUser, passwordRule, rolesOf } from "./auth.js";
import { controlRoutes, requestAdjustment } from "./controls.js";
import { buildState } from "./state.js";
import { addStock, allocateStock, transferStock, returnAllocations } from "./stock.js";
import { openTill, operationRoutes } from "./operations.js";
import { ROLES, LEADERSHIP_ROLES, COMBINABLE_ROLES, ORDER_FLOW, can, PROCESSING_SKUS, CONTENT_STATUSES } from "../src/shared/permissions.js";
import { ah, parse, audit, bad, notFound, conflict, HttpError, round2, round3 } from "./util.js";

const money = z.coerce.number().int().min(0).max(1e12);
const qtyNum = z.coerce.number().positive().max(1e6);
const id = z.coerce.number().int().positive();

export function apiRouter() {
  const r = express.Router();

  // Mutations must be JSON — together with SameSite=Lax cookies this blocks cross-site form CSRF.
  r.use((req, _res, next) => {
    // DELETE is exempt: browsers can't send it cross-site without a CORS preflight, and it has no body.
    if (!["GET", "HEAD", "DELETE"].includes(req.method) && !req.is("application/json")) {
      return next(new HttpError(415, "Requests must be JSON."));
    }
    next();
  });
  r.use(loadUser);
  r.use(requirePasswordChange);

  authRoutes(r);

  /* ------------------------------------------------------------ state */
  r.get("/state", requireAuth, ah(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await buildState(req.user));
  }));

  /* ------------------------------------------------------------ livestock */
  const animalSchema = z.object({
    species: z.enum(["Cattle", "Goat", "Sheep"]),
    breed: z.string().trim().min(1).max(60),
    sex: z.enum(["Male", "Female"]),
    age: z.coerce.number().min(0).max(30),
    weight: z.coerce.number().positive().max(2000),
    cost: money.nullable().optional(),   // purchase cost — only roles with cost access may enter it
    ranch: z.string().trim().min(1),
    pen: z.string().trim().max(30).optional(),
    health: z.enum(["Healthy", "Under Observation"]),
    acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  r.post("/livestock", requirePerm("ranch.edit"), ah(async (req, res) => {
    const a = parse(animalSchema, req.body);
    if (a.cost != null && !can(req.user.roles, "costs.view")) throw new HttpError(403, "Purchase costs are entered by management.");
    const out = await tx(async (db) => {
      const ranch = (await db.query("SELECT id FROM ranches WHERE name = $1 AND active", [a.ranch])).rows[0];
      if (!ranch) throw bad("Unknown or retired ranch.");
      const n = (await db.query("SELECT nextval('livestock_code_seq') AS n")).rows[0].n;
      const prefix = a.species === "Cattle" ? "COW" : a.species === "Goat" ? "GT" : "SHP";
      const code = `${prefix}-${String(n).padStart(5, "0")}`;
      const { rows } = await db.query(
        `INSERT INTO livestock (code, tag, species, breed, sex, age_years, weight_kg, acquired_on, acquisition_cost, ranch_id, pen, health, vaccination, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, (now() AT TIME ZONE 'Africa/Lagos')::date),$9,$10,$11,$12,'Pending','Active') RETURNING code`,
        [code, `TAG-${1000 + Number(n)}`, a.species, a.breed, a.sex, a.age, a.weight, a.acquiredOn ?? null, a.cost ?? null, ranch.id, a.pen || "Pen 01", a.health]
      );
      await audit(db, req.user.id, `Added ${rows[0].code}`, `${a.species} · ${a.breed} · ${a.weight} KG`);
      return rows[0];
    });
    res.status(201).json(out);
  }));

  r.patch("/livestock/:code", requirePerm("ranch.edit"), ah(async (req, res) => {
    const b = parse(z.object({
      status: z.enum(["Active", "Growing", "Ready for Processing", "Ready for Sale", "Sold"]).optional(),
      weight: z.coerce.number().positive().max(2000).optional(),
      health: z.enum(["Healthy", "Under Observation"]).optional(),
      vaccination: z.string().trim().min(1).max(40).optional(),
      pen: z.string().trim().min(1).max(30).optional(),
      cost: money.optional(),
    }), req.body);
    if (b.cost !== undefined && !can(req.user.roles, "costs.view")) throw new HttpError(403, "Purchase costs are entered by management.");
    const out = await tx(async (db) => {
      const cur = (await db.query("SELECT * FROM livestock WHERE code = $1 FOR UPDATE", [req.params.code])).rows[0];
      if (!cur) throw notFound("Animal not found.");
      if (cur.status === "Processed") throw conflict("This animal has already been processed.");
      const next = { ...cur, status: b.status ?? cur.status, weight_kg: b.weight ?? cur.weight_kg, health: b.health ?? cur.health, vaccination: b.vaccination ?? cur.vaccination, pen: b.pen ?? cur.pen, cost: b.cost ?? cur.acquisition_cost };
      await db.query(
        "UPDATE livestock SET status=$2, weight_kg=$3, health=$4, vaccination=$5, pen=$6, acquisition_cost=$7, updated_at=now() WHERE id=$1",
        [cur.id, next.status, next.weight_kg, next.health, next.vaccination, next.pen, next.cost]
      );
      const changes = [
        b.status && b.status !== cur.status && `status ${cur.status} → ${b.status}`,
        b.weight && b.weight !== cur.weight_kg && `weight ${cur.weight_kg} → ${b.weight} KG`,
        b.health && b.health !== cur.health && `health → ${b.health}`,
        b.vaccination && b.vaccination !== cur.vaccination && `vaccination → ${b.vaccination}`,
        b.pen && b.pen !== cur.pen && `pen → ${b.pen}`,
        b.cost !== undefined && b.cost !== cur.acquisition_cost && `purchase cost ${cur.acquisition_cost == null ? "recorded" : "changed"}: ₦${b.cost.toLocaleString("en-NG")}`,
      ].filter(Boolean);
      if (changes.length) await audit(db, req.user.id, `Updated ${cur.code}`, changes.join(", "));
      return { code: cur.code };
    });
    res.json(out);
  }));

  /* ------------------------------------------------------------ processing */
  const kg = z.coerce.number().min(0).max(2000);
  r.post("/processing", requirePerm("processing.edit"), ah(async (req, res) => {
    const b = parse(z.object({
      animal: z.string().min(1),
      location: z.string().min(1),
      outputs: z.object({ premium: kg, stew: kg, boneless: kg, minced: kg, other: kg, bones: kg, offal: kg, fat: kg, kpomo: kg, waste: kg }),
    }), req.body);
    const o = b.outputs;
    const out = await tx(async (db) => {
      const animal = (await db.query("SELECT * FROM livestock WHERE code = $1 FOR UPDATE", [b.animal])).rows[0];
      if (!animal) throw notFound("Animal not found.");
      if (animal.status !== "Ready for Processing") throw conflict(`${animal.code} is not marked Ready for Processing.`);
      const loc = (await db.query("SELECT id FROM storage_locations WHERE name = $1 AND active", [b.location])).rows[0];
      if (!loc) throw bad("Unknown or retired storage location.");

      const saleable = round3(o.premium + o.stew + o.boneless + o.minced + o.other);
      const everything = saleable + o.bones + o.offal + o.fat + o.kpomo + o.waste;
      if (saleable <= 0) throw bad("Enter the saleable meat weights.");
      if (everything > animal.weight_kg + 1e-9) throw bad(`Outputs total ${round2(everything)} KG — more than the ${animal.weight_kg} KG live weight.`);
      const yieldPct = round2((saleable / animal.weight_kg) * 100);

      const n = (await db.query("SELECT nextval('batch_code_seq') AS n")).rows[0].n;
      const code = `PB-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;

      // Cattle cuts map to beef SKUs; goat and sheep meat go to their own SKUs.
      const skuQty = animal.species === "Cattle"
        ? { "PB-BEEF": o.premium, "STEW-BEEF": o.stew, "BL-BEEF": o.boneless, "MINCE-BEEF": o.minced, "OTH-BEEF": o.other }
        : { [animal.species === "Goat" ? "GOAT-MEAT" : "RAM-MEAT"]: saleable };
      if (o.kpomo > 0) skuQty.KPOMO = o.kpomo;

      for (const [sku, qty] of Object.entries(skuQty)) {
        if (qty > 0) await addStock(db, { sku, locationId: loc.id, qty: round3(qty), kind: "production", reference: code, userId: req.user.id, batch: code });
      }
      await db.query(
        `INSERT INTO processing_batches (code, livestock_id, live_weight, saleable_kg, yield_pct, outputs, location_id, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [code, animal.id, animal.weight_kg, saleable, yieldPct, JSON.stringify(o), loc.id, req.user.id]
      );
      await db.query("UPDATE livestock SET status = 'Processed', updated_at = now() WHERE id = $1", [animal.id]);
      await audit(db, req.user.id, `Completed batch ${code}`, `${animal.code} · ${yieldPct}% yield · ${saleable} KG to ${b.location}`);
      return { code, yield: yieldPct, saleable };
    });
    res.status(201).json(out);
  }));

  /* ------------------------------------------------------------ inventory */
  r.post("/inventory/transfer", requirePerm("stock.transfer"), ah(async (req, res) => {
    const b = parse(z.object({ sku: z.string().min(1), from: z.string().min(1), to: z.string().min(1), qty: qtyNum }), req.body);
    if (b.from === b.to) throw bad("Pick a different destination.");
    const out = await tx(async (db) => {
      const locs = (await db.query("SELECT id, name, active FROM storage_locations WHERE name = ANY($1)", [[b.from, b.to]])).rows;
      const from = locs.find((l) => l.name === b.from), to = locs.find((l) => l.name === b.to);
      if (!from || !to) throw bad("Unknown storage location.");
      if (!to.active) throw conflict(`${to.name} is retired.`);
      const p = (await db.query("SELECT name, unit FROM products WHERE sku = $1", [b.sku])).rows[0];
      if (!p) throw notFound("Product not found.");
      if (p.unit !== "KG" && !Number.isInteger(b.qty)) throw bad(`${p.unit} items must be moved in whole numbers.`);
      const ref = `TRF-${Date.now().toString(36).toUpperCase()}`;
      await transferStock(db, { sku: b.sku, fromId: from.id, toId: to.id, qty: b.qty, reference: ref, fromName: from.name, toName: to.name, userId: req.user.id });
      await audit(db, req.user.id, `Transferred ${b.qty} ${p.unit} ${p.name}`, `${from.name} → ${to.name}`);
      return { ok: true, name: p.name };
    });
    res.json(out);
  }));

  r.post("/inventory/adjust", requireAuth, ah(async (req, res) => {
    // Write-offs and count corrections go through approval (server/controls.js). Only receipts post here.
    if (req.body?.kind === "wastage" || req.body?.kind === "correction") return res.status(201).json(await requestAdjustment(req));
    if (!can(req.user.roles, "stock.receive")) throw new HttpError(403, "Your role can't receive stock.");
    const b = parse(z.object({
      sku: z.string().min(1),
      location: z.string().min(1),
      kind: z.literal("receipt"),
      qty: z.coerce.number().positive().max(1e6),
      note: z.string().trim().min(2, "add the supplier / delivery note reference").max(200),
      lot: z.string().trim().max(40).optional().or(z.literal("")),          // supplier batch / lot number
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),        // use-by date on the label
    }), req.body);
    const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
    if (b.expiresOn && b.expiresOn < today) throw bad("That use-by date has already passed — this stock can't be received for sale.");
    const out = await tx(async (db) => {
      const loc = (await db.query("SELECT id, name, active FROM storage_locations WHERE name = $1", [b.location])).rows[0];
      if (!loc) throw bad("Unknown storage location.");
      if (!loc.active) throw conflict(`${loc.name} is retired.`);
      const p = (await db.query("SELECT name, unit FROM products WHERE sku = $1 AND active", [b.sku])).rows[0];
      if (!p) throw notFound("Product not found.");
      if (p.unit !== "KG" && !Number.isInteger(b.qty)) throw bad(`${p.unit} items must be whole numbers.`);
      const ref = `GRN-${Date.now().toString(36).toUpperCase()}`;
      await addStock(db, { sku: b.sku, locationId: loc.id, qty: b.qty, kind: "receipt", reference: ref, note: b.note, userId: req.user.id,
        lot: { code: b.lot || ref, expiresOn: b.expiresOn } });
      await audit(db, req.user.id, `Received ${b.qty} ${p.unit} ${p.name}`, `${loc.name} · ${b.note}`);
      return { ok: true, name: p.name };
    });
    res.json(out);
  }));

  /* ------------------------------------------------------------ sales (POS) */
  r.post("/sales", requirePerm("pos.use"), ah(async (req, res) => {
    const b = parse(z.object({
      customerId: id.nullable().optional(),
      items: z.array(z.object({ sku: z.string().min(1), qty: qtyNum })).min(1).max(50),
      fulfilment: z.enum(["Walk-in", "Delivery"]).default("Walk-in"),
      area: z.string().trim().max(60).optional(),
      paymentStatus: z.enum(["Paid", "Pending"]).default("Paid"),
      paymentMethod: z.enum(["Cash", "Transfer", "POS Card"]).default("Cash"),
    }), req.body);
    if (b.fulfilment === "Delivery" && !b.area) throw bad("Delivery orders need an area.");
    const out = await tx(async (db) => {
      // Every sale belongs to the seller's open till session, so the drawer can be reconciled at close.
      const till = await openTill(db, req.user.id);
      if (!till) throw conflict("Open your till before selling.");
      let customer = null;
      if (b.customerId) {
        customer = (await db.query("SELECT * FROM customers WHERE id = $1", [b.customerId])).rows[0];
        if (!customer) throw notFound("Customer not found.");
      }
      if (b.fulfilment === "Delivery" && !customer) throw bad("Pick a customer for delivery orders.");

      const n = (await db.query("SELECT nextval('order_code_seq') AS n")).rows[0].n;
      const code = `ORD-${n}`;
      // Lock products in a stable order to avoid deadlocks between concurrent tills.
      const skus = [...new Set(b.items.map((i) => i.sku))].sort();
      const prods = (await db.query("SELECT * FROM products WHERE sku = ANY($1) AND active ORDER BY sku FOR UPDATE", [skus])).rows;
      const bySku = Object.fromEntries(prods.map((p) => [p.sku, p]));

      let total = 0;
      const lines = [];
      for (const it of b.items) {
        const p = bySku[it.sku];
        if (!p) throw notFound(`Product ${it.sku} not found.`);
        if (p.unit !== "KG" && !Number.isInteger(it.qty)) throw bad(`${p.name} must be sold in whole ${p.unit.toLowerCase()}s.`);
        const qty = round3(it.qty);
        const allocations = await allocateStock(db, { sku: p.sku, qty, kind: "sale", reference: code, userId: req.user.id });
        const subtotal = Math.round(qty * p.price);
        total += subtotal;
        lines.push({ sku: p.sku, qty, unitPrice: p.price, subtotal, allocations });
      }

      const isDelivery = b.fulfilment === "Delivery";
      const { rows } = await db.query(
        `INSERT INTO orders (code, customer_id, channel, status, payment_status, payment_method, total, area, user_id, till_session_id, cash_session_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [code, customer?.id ?? null, isDelivery ? "Delivery" : "POS", isDelivery ? "Confirmed" : "Delivered",
         b.paymentStatus, b.paymentMethod, total, isDelivery ? b.area : "Walk-in", req.user.id, till.id,
         b.paymentStatus === "Paid" && b.paymentMethod === "Cash" ? till.id : null]
      );
      for (const l of lines) {
        await db.query(
          "INSERT INTO order_items (order_id, product_sku, qty, unit_price, subtotal, allocations) VALUES ($1,$2,$3,$4,$5,$6)",
          [rows[0].id, l.sku, l.qty, l.unitPrice, l.subtotal, JSON.stringify(l.allocations)]
        );
      }
      await audit(db, req.user.id, `Sale ${code}`, `₦${total.toLocaleString("en-NG")} · ${customer?.name ?? "Walk-in"} · ${b.paymentStatus}`);
      return { code, total };
    });
    res.status(201).json(out);
  }));

  /* ------------------------------------------------------------ orders */
  r.patch("/orders/:code", requirePerm("orders.edit"), ah(async (req, res) => {
    const b = parse(z.object({
      status: z.enum([...ORDER_FLOW, "Cancelled"]).optional(),
      paymentStatus: z.enum(["Paid", "Pending"]).optional(),
      paymentMethod: z.enum(["Cash", "Transfer", "POS Card"]).optional(),
    }), req.body);
    const out = await tx(async (db) => {
      const o = (await db.query("SELECT * FROM orders WHERE code = $1 FOR UPDATE", [req.params.code])).rows[0];
      let cashSession = o.cash_session_id, method = o.payment_method;
      if (b.paymentStatus === "Paid" && o.payment_status !== "Paid") {
        method = b.paymentMethod ?? o.payment_method ?? "Cash";
        if (method === "Cash") {
          // Cash collected later (e.g. on delivery) must land in someone's open till so it's counted at close.
          const till = await openTill(db, req.user.id);
          if (!till) throw conflict("Open your till to receive cash, or record the payment as Transfer or POS Card.");
          cashSession = till.id;
        }
      }
      if (b.paymentStatus === "Pending" && o.payment_status === "Paid") throw conflict("A paid order can't be set back to unpaid — use a refund.");
      if (!o) throw notFound("Order not found.");
      if (o.status === "Cancelled") throw conflict("This order was cancelled.");
      const changes = [];
      if (b.status && b.status !== o.status) {
        // Once goods have been handed over, money goes back through a refund (with approval), never a cancellation.
        if (o.status === "Delivered" && b.status === "Cancelled") {
          throw conflict("A delivered order can't be cancelled. Request a refund for the items instead.");
        }
        if (b.status === "Cancelled") {
          // Put the stock back where it came from.
          const items = (await db.query("SELECT * FROM order_items WHERE order_id = $1", [o.id])).rows;
          for (const it of items) {
            await returnAllocations(db, { sku: it.product_sku, allocations: it.allocations, kind: "return", reference: o.code, note: "Order cancelled", userId: req.user.id });
          }
        } else if (ORDER_FLOW.indexOf(b.status) < ORDER_FLOW.indexOf(o.status)) {
          throw conflict(`Can't move an order back from ${o.status} to ${b.status}.`);
        }
        changes.push(`${o.status} → ${b.status}`);
      }
      if (b.paymentStatus && b.paymentStatus !== o.payment_status) changes.push(`payment ${o.payment_status} → ${b.paymentStatus}${b.paymentStatus === "Paid" ? ` (${method})` : ""}`);
      if (!changes.length) return { ok: true };
      await db.query("UPDATE orders SET status = $2, payment_status = $3, payment_method = $4, cash_session_id = $5, updated_at = now() WHERE id = $1",
        [o.id, b.status ?? o.status, b.paymentStatus ?? o.payment_status, method, cashSession]);
      await audit(db, req.user.id, `Updated ${o.code}`, changes.join(", "));
      return { ok: true };
    });
    res.json(out);
  }));

  r.get("/orders/:code", requirePerm("orders.view"), ah(async (req, res) => {
    const o = (await query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS staff_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.user_id WHERE o.code = $1`,
      [req.params.code])).rows[0];
    if (!o) throw notFound("Order not found.");
    const [items, refunds] = await Promise.all([
      query(`SELECT oi.id, oi.qty, oi.unit_price, oi.subtotal, oi.refunded_qty, p.name, p.unit,
               COALESCE((SELECT sum(ri.qty) FROM refund_items ri JOIN refunds rf ON rf.id = ri.refund_id
                         WHERE ri.order_item_id = oi.id AND rf.status = 'Pending'), 0) AS pending_qty
             FROM order_items oi JOIN products p ON p.sku = oi.product_sku WHERE oi.order_id = $1 ORDER BY oi.id`, [o.id]),
      query(`SELECT rf.code, rf.amount, rf.reason, rf.status, rf.restock, rf.requested_at, u.name AS requested_by, d.name AS decided_by
             FROM refunds rf JOIN users u ON u.id = rf.requested_by LEFT JOIN users d ON d.id = rf.decided_by
             WHERE rf.order_id = $1 ORDER BY rf.requested_at DESC`, [o.id]),
    ]);
    const refundable = o.status === "Delivered" && o.payment_status === "Paid";
    res.json({
      code: o.code, customer: o.customer_name ?? "Walk-in Customer", phone: o.customer_phone, staff: o.staff_name,
      channel: o.channel, status: o.status, payment: o.payment_status, paymentMethod: o.payment_method,
      total: o.total, refunded: o.refunded, netTotal: o.net_total, area: o.area, createdAt: o.created_at, refundable,
      items: items.rows.map((i) => ({
        id: i.id, name: i.name, unit: i.unit, qty: i.qty, price: i.unit_price, subtotal: i.subtotal, refundedQty: i.refunded_qty,
        refundableQty: refundable ? round3(i.qty - i.refunded_qty - i.pending_qty) : 0,
      })),
      refunds: refunds.rows.map((x) => ({ code: x.code, amount: x.amount, reason: x.reason, status: x.status, restock: x.restock, requestedBy: x.requested_by, decidedBy: x.decided_by, at: x.requested_at })),
    });
  }));

  /* ------------------------------------------------------------ customers */
  r.post("/customers", requirePerm("customers.edit"), ah(async (req, res) => {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().trim().regex(/^[+\d][\d\s-]{6,19}$/, "looks invalid").optional().or(z.literal("")),
      area: z.string().trim().max(60).optional(),
    }), req.body);
    const out = await tx(async (db) => {
      const n = (await db.query("SELECT nextval('customer_code_seq') AS n")).rows[0].n;
      const { rows } = await db.query(
        "INSERT INTO customers (code, name, phone, area) VALUES ($1,$2,$3,$4) RETURNING id, code, name",
        [`CUST-${n}`, b.name, b.phone || null, b.area || null]
      );
      await audit(db, req.user.id, `Added customer ${b.name}`, rows[0].code);
      return rows[0];
    });
    res.status(201).json(out);
  }));

  /* ------------------------------------------------------------ setup: products */
  const productBody = z.object({
    name: z.string().trim().min(2).max(60),
    category: z.string().trim().min(2).max(30),
    unit: z.enum(["KG", "Unit", "Pack"]),
    price: money,
    costPrice: money,
    min: z.coerce.number().min(0).max(1e6),
    shelfLife: z.coerce.number().int().min(1).max(730).optional(),
  });

  r.post("/products", requirePerm("products.edit"), ah(async (req, res) => {
    const b = parse(productBody.extend({ sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, "use 2–24 letters, numbers or dashes").optional() }), req.body);
    const sku = b.sku || b.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    if (sku.length < 2) throw bad("Give the product a SKU.");
    const out = await tx(async (db) => {
      const clash = (await db.query("SELECT sku, active FROM products WHERE sku = $1 OR lower(name) = lower($2)", [sku, b.name])).rows[0];
      if (clash) throw conflict(clash.sku === sku ? `SKU ${sku} is already used${clash.active ? "" : " by a retired product"}.` : `A product called "${b.name}" already exists.`);
      const sort = (await db.query("SELECT COALESCE(max(sort), 0) + 1 AS s FROM products")).rows[0].s;
      await db.query(
        "INSERT INTO products (sku, name, category, unit, price, cost_price, min_stock, sort, shelf_life_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [sku, b.name, b.category, b.unit, b.price, b.costPrice, b.min, sort, b.shelfLife ?? 5]
      );
      await audit(db, req.user.id, `Added product ${b.name}`, `${sku} · ₦${b.price.toLocaleString("en-NG")}/${b.unit}`);
      return { sku, name: b.name };
    });
    res.status(201).json(out);
  }));

  r.patch("/products/:sku", requirePerm("products.edit"), ah(async (req, res) => {
    const b = parse(productBody.partial().extend({ active: z.boolean().optional() }), req.body);
    const out = await tx(async (db) => {
      const cur = (await db.query("SELECT * FROM products WHERE sku = $1 FOR UPDATE", [req.params.sku])).rows[0];
      if (!cur) throw notFound("Product not found.");
      if (b.unit && b.unit !== cur.unit) {
        const used = (await db.query("SELECT 1 FROM stock_movements WHERE product_sku = $1 LIMIT 1", [cur.sku])).rows[0];
        if (used) throw conflict("The unit can't change once stock has moved — add a new product instead.");
      }
      if (b.name && b.name.toLowerCase() !== cur.name.toLowerCase()) {
        const clash = (await db.query("SELECT 1 FROM products WHERE lower(name) = lower($1) AND sku <> $2", [b.name, cur.sku])).rows[0];
        if (clash) throw conflict(`A product called "${b.name}" already exists.`);
      }
      if (b.active === false && cur.active) {
        if (PROCESSING_SKUS.includes(cur.sku)) throw conflict(`${cur.name} receives processing output, so it can't be retired. You can rename it instead.`);
        const held = (await db.query("SELECT COALESCE(sum(qty), 0) AS q FROM stock WHERE product_sku = $1", [cur.sku])).rows[0].q;
        if (held > 0) throw conflict(`${cur.name} still has ${round3(held)} ${cur.unit} in stock. Sell, write off or correct it to zero first.`);
      }
      const n = { name: b.name ?? cur.name, category: b.category ?? cur.category, unit: b.unit ?? cur.unit, price: b.price ?? cur.price, cost: b.costPrice ?? cur.cost_price, min: b.min ?? cur.min_stock, active: b.active ?? cur.active, shelf: b.shelfLife ?? cur.shelf_life_days };
      await db.query("UPDATE products SET name=$2, category=$3, unit=$4, price=$5, cost_price=$6, min_stock=$7, active=$8, shelf_life_days=$9 WHERE sku=$1",
        [cur.sku, n.name, n.category, n.unit, n.price, n.cost, n.min, n.active, n.shelf]);
      const fmt = (v) => `₦${v.toLocaleString("en-NG")}`;
      const ch = [
        n.name !== cur.name && `renamed from ${cur.name}`,
        n.category !== cur.category && `category → ${n.category}`,
        n.unit !== cur.unit && `unit → ${n.unit}`,
        n.price !== cur.price && `price ${fmt(cur.price)} → ${fmt(n.price)}`,
        n.cost !== cur.cost_price && `cost ${fmt(cur.cost_price)} → ${fmt(n.cost)}`,
        n.min !== cur.min_stock && `min stock ${cur.min_stock} → ${n.min}`,
        n.active !== cur.active && (n.active ? "restored" : "retired"),
        n.shelf !== cur.shelf_life_days && `shelf life ${cur.shelf_life_days} → ${n.shelf} days`,
      ].filter(Boolean);
      if (ch.length) await audit(db, req.user.id, `Updated ${n.name}`, ch.join(", "));
      return { ok: true };
    });
    res.json(out);
  }));

  /* ------------------------------------------------------------ setup: locations & ranches */
  const placeRoutes = (path, table, label, inUseSql, inUseMsg) => {
    r.post(`/${path}`, requirePerm("setup.manage"), ah(async (req, res) => {
      const b = parse(z.object({ name: z.string().trim().min(2).max(50) }), req.body);
      const out = await tx(async (db) => {
        const clash = (await db.query(`SELECT active FROM ${table} WHERE lower(name) = lower($1)`, [b.name])).rows[0];
        if (clash) throw conflict(clash.active ? `"${b.name}" already exists.` : `"${b.name}" exists but is retired — restore it instead.`);
        const extra = table === "storage_locations" ? ", sort" : "";
        const sortVal = table === "storage_locations" ? ", (SELECT COALESCE(max(sort), 0) + 1 FROM storage_locations)" : "";
        const { rows } = await db.query(`INSERT INTO ${table} (name${extra}) VALUES ($1${sortVal}) RETURNING id`, [b.name]);
        await audit(db, req.user.id, `Added ${label} ${b.name}`, null);
        return { id: rows[0].id, name: b.name };
      });
      res.status(201).json(out);
    }));
    r.patch(`/${path}/:id`, requirePerm("setup.manage"), ah(async (req, res) => {
      const b = parse(z.object({ name: z.string().trim().min(2).max(50).optional(), active: z.boolean().optional(), sellsFirst: z.boolean().optional(),
        tempMin: z.coerce.number().min(-60).max(60).nullable().optional(), tempMax: z.coerce.number().min(-60).max(60).nullable().optional() }), req.body);
      const out = await tx(async (db) => {
        const cur = (await db.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
        if (!cur) throw notFound(`${label[0].toUpperCase() + label.slice(1)} not found.`);
        if (b.name && b.name.toLowerCase() !== cur.name.toLowerCase()) {
          const clash = (await db.query(`SELECT 1 FROM ${table} WHERE lower(name) = lower($1) AND id <> $2`, [b.name, cur.id])).rows[0];
          if (clash) throw conflict(`"${b.name}" already exists.`);
        }
        if (b.active === false && cur.active) {
          const used = (await db.query(inUseSql, [cur.id])).rows[0];
          if (used?.n > 0) throw conflict(inUseMsg(cur.name, used.n));
          const left = (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE active AND id <> $1`, [cur.id])).rows[0].n;
          if (left === 0) throw conflict(`You need at least one active ${label}.`);
        }
        await db.query(`UPDATE ${table} SET name = $2, active = $3 WHERE id = $1`, [cur.id, b.name ?? cur.name, b.active ?? cur.active]);
        const counter = table === "storage_locations" && b.sellsFirst !== undefined && b.sellsFirst !== cur.sells_first;
        if (counter) await db.query("UPDATE storage_locations SET sells_first = $2 WHERE id = $1", [cur.id, b.sellsFirst]);
        const temps = table === "storage_locations" && (b.tempMin !== undefined || b.tempMax !== undefined);
        if (temps) {
          const lo = b.tempMin !== undefined ? b.tempMin : cur.temp_min, hi = b.tempMax !== undefined ? b.tempMax : cur.temp_max;
          if (lo != null && hi != null && lo > hi) throw bad("The minimum temperature must be below the maximum.");
          await db.query("UPDATE storage_locations SET temp_min = $2, temp_max = $3 WHERE id = $1", [cur.id, lo, hi]);
        }
        const ch = [b.name && b.name !== cur.name && `renamed from ${cur.name}`, b.active !== undefined && b.active !== cur.active && (b.active ? "restored" : "retired"),
          counter && (b.sellsFirst ? "POS now sells from here first" : "no longer POS-first"),
          temps && `safe range ${b.tempMin ?? cur.temp_min}°C to ${b.tempMax ?? cur.temp_max}°C`].filter(Boolean);
        if (ch.length) await audit(db, req.user.id, `Updated ${label} ${b.name ?? cur.name}`, ch.join(", "));
        return { ok: true };
      });
      res.json(out);
    }));
  };
  placeRoutes("locations", "storage_locations", "storage location",
    "SELECT count(*)::int AS n FROM stock WHERE location_id = $1 AND qty > 0",
    (name, n) => `${name} still holds ${n} product${n === 1 ? "" : "s"}. Transfer the stock out first.`);
  placeRoutes("ranches", "ranches", "ranch",
    "SELECT count(*)::int AS n FROM livestock WHERE ranch_id = $1 AND status NOT IN ('Processed','Sold')",
    (name, n) => `${name} still has ${n} animal${n === 1 ? "" : "s"} on it.`);

  /* ------------------------------------------------------------ procurement */
  const supplierBody = z.object({
    name: z.string().trim().min(2).max(80),
    type: z.string().trim().min(2).max(40),
    contactName: z.string().trim().max(60).optional().or(z.literal("")),
    phone: z.string().trim().regex(/^[+\d][\d\s-]{6,19}$/, "looks invalid").optional().or(z.literal("")),
  });

  r.post("/suppliers", requirePerm("procurement.edit"), ah(async (req, res) => {
    const b = parse(supplierBody, req.body);
    const out = await tx(async (db) => {
      const clash = (await db.query("SELECT 1 FROM suppliers WHERE lower(name) = lower($1)", [b.name])).rows[0];
      if (clash) throw conflict(`A supplier called "${b.name}" already exists.`);
      const { rows } = await db.query("INSERT INTO suppliers (name, type, contact_name, phone) VALUES ($1,$2,$3,$4) RETURNING id",
        [b.name, b.type, b.contactName || null, b.phone || null]);
      await audit(db, req.user.id, `Added supplier ${b.name}`, b.type);
      return { id: rows[0].id, name: b.name };
    });
    res.status(201).json(out);
  }));

  r.patch("/suppliers/:id", requirePerm("procurement.edit"), ah(async (req, res) => {
    const b = parse(supplierBody.partial().extend({ active: z.boolean().optional() }), req.body);
    const out = await tx(async (db) => {
      const s = (await db.query("SELECT * FROM suppliers WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!s) throw notFound("Supplier not found.");
      if (b.name && b.name.toLowerCase() !== s.name.toLowerCase()) {
        const clash = (await db.query("SELECT 1 FROM suppliers WHERE lower(name) = lower($1) AND id <> $2", [b.name, s.id])).rows[0];
        if (clash) throw conflict(`A supplier called "${b.name}" already exists.`);
      }
      if (b.active === false && s.active) {
        const bal = (await db.query("SELECT COALESCE(sum(CASE WHEN kind='invoice' THEN amount ELSE -amount END), 0) AS b FROM supplier_entries WHERE supplier_id = $1", [s.id])).rows[0].b;
        if (bal > 0) throw conflict(`${s.name} still has ₦${bal.toLocaleString("en-NG")} outstanding.`);
      }
      const n = { name: b.name ?? s.name, type: b.type ?? s.type, contact: b.contactName !== undefined ? b.contactName || null : s.contact_name, phone: b.phone !== undefined ? b.phone || null : s.phone, active: b.active ?? s.active };
      await db.query("UPDATE suppliers SET name=$2, type=$3, contact_name=$4, phone=$5, active=$6 WHERE id=$1", [s.id, n.name, n.type, n.contact, n.phone, n.active]);
      const ch = [n.name !== s.name && `renamed from ${s.name}`, n.type !== s.type && `type → ${n.type}`, n.contact !== s.contact_name && "contact updated",
        n.phone !== s.phone && "phone updated", n.active !== s.active && (n.active ? "restored" : "retired")].filter(Boolean);
      if (ch.length) await audit(db, req.user.id, `Updated supplier ${n.name}`, ch.join(", "));
      return { ok: true };
    });
    res.json(out);
  }));

  r.post("/suppliers/:id/entries", requireAuth, ah(async (req, res) => {
    const b = parse(z.object({
      kind: z.enum(["invoice", "payment"]),
      amount: z.coerce.number().int().positive().max(1e12),
      reference: z.string().trim().max(60).optional().or(z.literal("")),
      note: z.string().trim().max(200).optional().or(z.literal("")),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.body);
    if (!can(req.user.roles, b.kind === "payment" ? "payables.pay" : "procurement.edit")) {
      throw new HttpError(403, b.kind === "payment" ? "Only an Owner, MD or Administrator can record supplier payments." : "Your role can't record supplier invoices.");
    }
    const out = await tx(async (db) => {
      const s = (await db.query("SELECT * FROM suppliers WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!s) throw notFound("Supplier not found.");
      if (!s.active) throw conflict("This supplier is retired.");
      if (b.date && b.date > new Date(Date.now() + 3600e3).toISOString().slice(0, 10)) throw bad("The date can't be in the future.");
      if (b.kind === "payment") {
        const bal = (await db.query("SELECT COALESCE(sum(CASE WHEN kind='invoice' THEN amount ELSE -amount END), 0) AS b FROM supplier_entries WHERE supplier_id = $1", [s.id])).rows[0].b;
        if (b.amount > bal) throw conflict(`That's more than the ₦${bal.toLocaleString("en-NG")} owed to ${s.name}.`);
      }
      await db.query(
        `INSERT INTO supplier_entries (supplier_id, kind, amount, reference, note, entry_date, user_id)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, (now() AT TIME ZONE 'Africa/Lagos')::date),$7)`,
        [s.id, b.kind, b.amount, b.reference || null, b.note || null, b.date ?? null, req.user.id]
      );
      await audit(db, req.user.id, `${b.kind === "invoice" ? "Recorded invoice from" : "Paid"} ${s.name}`, `₦${b.amount.toLocaleString("en-NG")}${b.reference ? ` · ${b.reference}` : ""}`);
      return { ok: true, name: s.name };
    });
    res.status(201).json(out);
  }));

  /* ------------------------------------------------------------ marketing */
  const campaignBody = z.object({
    name: z.string().trim().min(2).max(80),
    platform: z.string().trim().min(2).max(60),
    budget: money, leads: z.coerce.number().int().min(0).max(1e7), orders: z.coerce.number().int().min(0).max(1e7), revenue: money,
  });
  r.post("/campaigns", requirePerm("marketing.edit"), ah(async (req, res) => {
    const b = parse(campaignBody, req.body);
    const { rows } = await query("INSERT INTO campaigns (name, platform, budget, leads, orders, revenue) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [b.name, b.platform, b.budget, b.leads, b.orders, b.revenue]);
    await audit(null, req.user.id, `Added campaign ${b.name}`, b.platform);
    res.status(201).json({ id: rows[0].id, name: b.name });
  }));
  r.patch("/campaigns/:id", requirePerm("marketing.edit"), ah(async (req, res) => {
    const b = parse(campaignBody.partial(), req.body);
    const out = await tx(async (db) => {
      const c0 = (await db.query("SELECT * FROM campaigns WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!c0) throw notFound("Campaign not found.");
      const n = { ...c0, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
      await db.query("UPDATE campaigns SET name=$2, platform=$3, budget=$4, leads=$5, orders=$6, revenue=$7 WHERE id=$1",
        [c0.id, n.name, n.platform, n.budget, n.leads, n.orders, n.revenue]);
      await audit(db, req.user.id, `Updated campaign ${n.name}`, `${n.leads} leads · ${n.orders} orders · ₦${n.revenue.toLocaleString("en-NG")}`);
      return { ok: true };
    });
    res.json(out);
  }));
  r.delete("/campaigns/:id", requirePerm("marketing.edit"), ah(async (req, res) => {
    const { rows } = await query("DELETE FROM campaigns WHERE id = $1 RETURNING name", [req.params.id]);
    if (!rows[0]) throw notFound("Campaign not found.");
    await audit(null, req.user.id, `Deleted campaign ${rows[0].name}`, null);
    res.json({ ok: true });
  }));

  const postBody = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().trim().min(2).max(120),
    type: z.string().trim().min(2).max(40),
    platform: z.string().trim().min(2).max(40),
    status: z.enum(CONTENT_STATUSES),
  });
  r.post("/content", requirePerm("marketing.edit"), ah(async (req, res) => {
    const b = parse(postBody, req.body);
    const { rows } = await query("INSERT INTO content_posts (post_date, title, type, platform, status, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [b.date, b.title, b.type, b.platform, b.status, req.user.id]);
    res.status(201).json({ id: rows[0].id });
  }));
  r.patch("/content/:id", requirePerm("marketing.edit"), ah(async (req, res) => {
    const b = parse(postBody.partial(), req.body);
    const cur = (await query("SELECT * FROM content_posts WHERE id = $1", [req.params.id])).rows[0];
    if (!cur) throw notFound("Post not found.");
    await query("UPDATE content_posts SET post_date=COALESCE($2::date, post_date), title=$3, type=$4, platform=$5, status=$6 WHERE id=$1",
      [cur.id, b.date ?? null, b.title ?? cur.title, b.type ?? cur.type, b.platform ?? cur.platform, b.status ?? cur.status]);
    if (b.status && b.status !== cur.status) await audit(null, req.user.id, `Content "${b.title ?? cur.title}"`, `${cur.status} → ${b.status}`);
    res.json({ ok: true });
  }));
  r.delete("/content/:id", requirePerm("marketing.edit"), ah(async (req, res) => {
    const { rows } = await query("DELETE FROM content_posts WHERE id = $1 RETURNING id", [req.params.id]);
    if (!rows[0]) throw notFound("Post not found.");
    res.json({ ok: true });
  }));

  /* ------------------------------------------------------------ users */
  const extraRolesSchema = z.array(z.enum(COMBINABLE_ROLES)).max(4).optional();
  const onlyOwnerFor = (actor, ...roles) => {
    if (roles.some((r) => LEADERSHIP_ROLES.includes(r)) && actor.role !== "Owner") {
      throw new HttpError(403, "Only an Owner can grant or change Owner, Managing Director or Administrator accounts.");
    }
  };
  const cleanExtras = (primary, extras = []) => {
    const list = [...new Set(extras)].filter((r) => r !== primary);
    if (list.length && LEADERSHIP_ROLES.includes(primary)) throw bad(`${primary} can't hold additional roles.`);
    return list;
  };

  r.post("/users", requirePerm("users.manage"), ah(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), role: z.enum(ROLES), extraRoles: extraRolesSchema, password: passwordRule }), req.body);
    onlyOwnerFor(req.user, b.role);
    const extras = cleanExtras(b.role, b.extraRoles);
    // A password set by someone else is temporary: the new user must replace it at first sign-in.
    const { rows } = await query(
      "INSERT INTO users (name, email, role, extra_roles, password_hash, must_change_password) VALUES ($1, lower($2), $3, $4, $5, TRUE) RETURNING *",
      [b.name, b.email, b.role, extras, await hashPassword(b.password)]
    );
    await audit(null, req.user.id, `Created user ${b.email}`, [b.role, ...extras].join(" + "));
    res.status(201).json(publicUser(rows[0]));
  }));

  r.patch("/users/:id", requirePerm("users.manage"), ah(async (req, res) => {
    const b = parse(z.object({ role: z.enum(ROLES).optional(), extraRoles: extraRolesSchema, active: z.boolean().optional(), password: passwordRule.optional(), name: z.string().trim().min(2).max(80).optional(), resetMfa: z.literal(true).optional() }), req.body);
    const out = await tx(async (db) => {
      const u = (await db.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!u) throw notFound("User not found.");
      onlyOwnerFor(req.user, u.role, ...(b.role ? [b.role] : []));
      const role = b.role ?? u.role;
      const extras = b.extraRoles !== undefined ? cleanExtras(role, b.extraRoles) : cleanExtras(role, LEADERSHIP_ROLES.includes(role) ? [] : u.extra_roles);
      const rolesChanged = role !== u.role || extras.join() !== (u.extra_roles || []).join();
      if (u.id === req.user.id && (b.active === false || rolesChanged)) throw bad("You can't deactivate or change the roles of your own account.");
      // Never leave the business without an active Owner.
      if (u.role === "Owner" && (b.active === false || role !== "Owner")) {
        const owners = (await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'Owner' AND active AND id <> $1", [u.id])).rows[0].n;
        if (owners === 0) throw conflict("There must be at least one active Owner.");
      }
      const reset = !!b.password;
      if (b.resetMfa) {
        if (u.id === req.user.id) throw bad("You can't reset your own two-step sign-in. Use a recovery code, or ask the Owner.");
        await db.query("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL, recovery_codes = '{}' WHERE id = $1", [u.id]);
      }
      await db.query(
        `UPDATE users SET role=$2, extra_roles=$3, active=$4, name=$5, password_hash=COALESCE($6, password_hash),
           must_change_password = must_change_password OR $7, updated_at=now() WHERE id=$1`,
        [u.id, role, extras, b.active ?? u.active, b.name ?? u.name, reset ? await hashPassword(b.password) : null, reset && u.id !== req.user.id]
      );
      const ch = [
        rolesChanged && `roles ${rolesOf(u).join(" + ")} → ${[role, ...extras].join(" + ")}`,
        b.active !== undefined && b.active !== u.active && (b.active ? "reactivated" : "deactivated"),
        reset && "password reset (temporary)",
        b.resetMfa && "two-step sign-in reset (must set up again)",
        b.name && b.name !== u.name && `name → ${b.name}`,
      ].filter(Boolean);
      if (ch.length) await audit(db, req.user.id, `Updated user ${u.email}`, ch.join(", "));
      return { ok: true };
    });
    res.json(out);
  }));

  controlRoutes(r);
  operationRoutes(r);

  r.use((req, _res, next) => next(new HttpError(404, "Unknown API endpoint.")));
  return r;
}
