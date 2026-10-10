// Point of sale, to retail standard:
//   • one sale per "Complete" tap (client_ref makes retries safe)
//   • line and ticket discounts with a reason; above the seller's authority a manager approves with their PIN
//   • split tender: any mix of Cash / Transfer / POS Card; cash tendered and change recorded
//   • VAT per product, prices VAT-inclusive, shown on the receipt
//   • parked (held) tickets, cleared-ticket log, X / Z till reports, receipt header in settings
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, tx } from "./db.js";
import { requirePerm, requireAuth, signPurpose, verifyPurpose } from "./auth.js";
import { allocateStock } from "./stock.js";
import { openTill, tillSummary, approvalLimits } from "./operations.js";
import { can, UNLIMITED_APPROVER, DISCOUNT_REASONS, weakPin } from "../src/shared/permissions.js";
import { ah, parse, audit, bad, notFound, conflict, HttpError, round3, fmtDateTime } from "./util.js";

const naira = (n) => `₦${Math.round(n || 0).toLocaleString("en-NG")}`;
const id = z.coerce.number().int().positive();
const qtyNum = z.coerce.number().positive().max(100000);
const METHODS = ["Cash", "Transfer", "POS Card"];
const PIN_MAX_FAILS = 5;

export const DEFAULT_PROFILE = { name: "Blades & Butchers", tagline: "From Ranch to Retail", address: "", phone: "", email: "", tin: "", receiptFooter: "Thank you for shopping with us!", scaleLabel: "weight" };
export async function businessProfile(db = { query }) {
  const r = (await db.query("SELECT value FROM settings WHERE key = 'business_profile'")).rows[0];
  return { ...DEFAULT_PROFILE, ...(r?.value || {}) };
}

const discountSchema = z.object({ type: z.enum(["pct", "amount"]), value: z.coerce.number().min(0).max(1e9) });
const discountAmount = (d, base) => (!d || !d.value ? 0 : Math.min(base, d.type === "pct" ? Math.round((base * Math.min(d.value, 100)) / 100) : Math.round(d.value)));

/** The most discount (as % of the ticket before discount) this user can give or approve. */
async function discountAuthority(db, roles) {
  if (can(roles, UNLIMITED_APPROVER)) return 100;
  if (!can(roles, "pos.discount")) return 0;
  return (await approvalLimits(db)).discountPct;
}

/** Record one tender against an order. */
export async function recordPayment(db, { orderId, method, amount, tendered = null, ref = null, tillId = null, userId }) {
  await db.query("INSERT INTO order_payments (order_id, method, amount, tendered, ref, till_session_id, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [orderId, method, amount, tendered, ref, tillId, userId]);
}

export function posRoutes(r) {
  /* ---------------------------------------------------------- the sale */
  r.post("/sales", requirePerm("pos.use"), ah(async (req, res) => {
    const b = parse(z.object({
      clientRef: z.string().trim().min(8).max(64).optional(),
      customerId: id.nullable().optional(),
      items: z.array(z.object({
        sku: z.string().min(1), qty: qtyNum, scale: z.boolean().optional(),
        discount: discountSchema.optional(),
      })).min(1).max(100),
      discount: discountSchema.optional(),                               // whole-ticket discount, after line discounts
      discountReason: z.string().trim().max(60).optional(),
      overrideToken: z.string().max(2000).optional(),                     // a manager's PIN approval (POST /pos/authorize)
      fulfilment: z.enum(["Walk-in", "Delivery"]).default("Walk-in"),
      area: z.string().trim().max(60).optional(),
      payments: z.array(z.object({
        method: z.enum(METHODS), amount: z.coerce.number().int().positive().max(1e12),
        tendered: z.coerce.number().int().positive().max(1e12).optional(),
        ref: z.string().trim().max(60).optional().or(z.literal("")),
      })).max(6).optional(),
      payLater: z.boolean().optional(),
      // Older clients: a single payment
      paymentStatus: z.enum(["Paid", "Pending"]).optional(),
      paymentMethod: z.enum(METHODS).optional(),
      paymentRef: z.string().trim().max(60).optional().or(z.literal("")),
    }), req.body);
    if (b.fulfilment === "Delivery" && !b.area) throw bad("Delivery orders need an area.");
    const payLater = b.payLater ?? b.paymentStatus === "Pending";

    // Same tap retried (network blip): return the sale already made, never charge twice.
    if (b.clientRef) {
      const dup = (await query("SELECT code, total, change_given FROM orders WHERE client_ref = $1", [b.clientRef])).rows[0];
      if (dup) return res.status(200).json({ code: dup.code, total: dup.total, change: dup.change_given, duplicate: true });
    }

    const out = await tx(async (db) => {
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
      const skus = [...new Set(b.items.map((i) => i.sku))].sort();
      const prods = (await db.query("SELECT * FROM products WHERE sku = ANY($1) AND active ORDER BY sku FOR UPDATE", [skus])).rows;
      const bySku = Object.fromEntries(prods.map((p) => [p.sku, p]));

      // 1. Price every line, then line discounts.
      const lines = b.items.map((it) => {
        const p = bySku[it.sku];
        if (!p) throw notFound(`Product ${it.sku} not found.`);
        if (p.unit !== "KG" && !Number.isInteger(it.qty)) throw bad(`${p.name} must be sold in whole ${p.unit.toLowerCase()}s.`);
        const qty = round3(it.qty);
        const gross = Math.round(qty * p.price);
        const lineDisc = discountAmount(it.discount, gross);
        return { p, qty, gross, discount: lineDisc, scale: p.unit === "KG" && it.scale === true };
      });
      const gross = lines.reduce((s, l) => s + l.gross, 0);
      // 2. Ticket discount, spread across lines in proportion (so refunds give back what was actually paid).
      const afterLines = lines.reduce((s, l) => s + l.gross - l.discount, 0);
      const ticketDisc = discountAmount(b.discount, afterLines);
      if (ticketDisc > 0) {
        let left = ticketDisc;
        lines.forEach((l, i) => {
          const base = l.gross - l.discount;
          const share = i === lines.length - 1 ? left : Math.min(left, Math.round((ticketDisc * base) / afterLines));
          l.discount += share; left -= share;
        });
      }
      const discountTotal = lines.reduce((s, l) => s + l.discount, 0);
      const total = gross - discountTotal;

      // 3. Who authorised the discount?
      let discountBy = null;
      if (discountTotal > 0) {
        if (!b.discountReason || !DISCOUNT_REASONS.includes(b.discountReason)) throw bad("Pick a reason for the discount.");
        const pct = (discountTotal / gross) * 100;
        const own = await discountAuthority(db, req.user.roles);
        if (pct <= own + 1e-9) discountBy = req.user.id;
        else {
          if (!b.overrideToken) {
            throw new HttpError(403, own ? `A ${pct.toFixed(1)}% discount is above your ${own}% limit — a manager must approve it.` : "Discounts need a manager's approval.");
          }
          let c;
          try { c = verifyPurpose(b.overrideToken, "pos-override"); } catch { throw new HttpError(403, "The manager approval has expired — ask again."); }
          if (c.cashier !== req.user.id) throw new HttpError(403, "That approval was for another till.");
          if (pct > c.maxPct + 1e-9) throw new HttpError(403, `The approving manager can authorise up to ${c.maxPct}% — this is ${pct.toFixed(1)}%.`);
          discountBy = c.approver;
        }
      }

      // 4. VAT (prices include it).
      for (const l of lines) {
        l.subtotal = l.gross - l.discount;
        l.vat = Number(l.p.vat_rate) || 0;
        l.tax = l.vat ? Math.round((l.subtotal * l.vat) / (100 + l.vat)) : 0;
      }
      const taxTotal = lines.reduce((s, l) => s + l.tax, 0);

      // 5. Tenders.
      let payments = b.payments || [];
      if (!payments.length && !payLater && b.paymentStatus !== "Pending") {
        payments = [{ method: b.paymentMethod ?? "Cash", amount: total, ref: b.paymentRef }]; // legacy single payment
      }
      if (payLater && payments.length) throw bad("A pay-later order can't also take payment now.");
      let change = 0;
      if (!payLater) {
        const paid = payments.reduce((s, p) => s + p.amount, 0);
        if (total === 0 && payments.length) throw bad("Nothing to pay on this ticket.");
        if (paid !== total) throw bad(`Payments (${naira(paid)}) must add up to the total (${naira(total)}).`);
        for (const p of payments) {
          if (p.tendered != null && p.method !== "Cash") throw bad("Only cash has change.");
          if (p.tendered != null && p.tendered < p.amount) throw bad("Cash tendered is less than the amount.");
          change += p.tendered != null ? p.tendered - p.amount : 0;
        }
      }
      const methods = [...new Set(payments.map((p) => p.method))];
      const method = payLater ? (b.paymentMethod ?? null) : methods.length === 1 ? methods[0] : methods.length ? "Split" : null;
      const hasCash = payments.some((p) => p.method === "Cash");
      const firstRef = payments.find((p) => p.method !== "Cash" && p.ref)?.ref || null;
      const paid = !payLater;

      // 6. Stock (counter first, earliest use-by; expired never sold), then the order.
      for (const l of lines) l.allocations = await allocateStock(db, { sku: l.p.sku, qty: l.qty, kind: "sale", reference: code, userId: req.user.id });
      const isDelivery = b.fulfilment === "Delivery";
      const { rows } = await db.query(
        `INSERT INTO orders (code, customer_id, channel, status, payment_status, payment_method, total, area, user_id, till_session_id, cash_session_id,
           paid_at, payment_ref, gross_total, discount_total, discount_reason, discount_by, tax_total, change_given, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $5 = 'Paid' THEN now() END, $12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [code, customer?.id ?? null, isDelivery ? "Delivery" : "POS", isDelivery ? "Confirmed" : "Delivered",
         paid ? "Paid" : "Pending", method, total, isDelivery ? b.area : "Walk-in", req.user.id, till.id, hasCash ? till.id : null,
         firstRef, gross, discountTotal, discountTotal ? b.discountReason : null, discountBy, taxTotal, change, b.clientRef ?? null]);
      const orderId = rows[0].id;
      for (const l of lines) {
        await db.query(
          `INSERT INTO order_items (order_id, product_sku, qty, unit_price, subtotal, allocations, scale_weighed, discount, vat_rate, tax)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [orderId, l.p.sku, l.qty, l.p.price, l.subtotal, JSON.stringify(l.allocations), l.scale, l.discount, l.vat, l.tax]);
      }
      for (const p of payments) {
        await recordPayment(db, { orderId, method: p.method, amount: p.amount, tendered: p.method === "Cash" ? (p.tendered ?? p.amount) : null,
          ref: p.method === "Cash" ? null : p.ref || null, tillId: till.id, userId: req.user.id });
      }
      const tenders = payments.map((p) => `${p.method} ${naira(p.amount)}`).join(" + ");
      await audit(db, req.user.id, `Sale ${code}`, `${naira(total)} · ${customer?.name ?? "Walk-in"} · ${paid ? tenders : "Pending"}${change ? ` · change ${naira(change)}` : ""}`);
      if (discountTotal) {
        await audit(db, discountBy, `Discount on ${code}`, `${naira(discountTotal)} (${((discountTotal / gross) * 100).toFixed(1)}%) · ${b.discountReason}${discountBy !== req.user.id ? ` · approved for ${req.user.name}` : ""}`);
      }
      return { code, total, gross, discount: discountTotal, tax: taxTotal, change, paymentMethod: method };
    }).catch((e) => {
      // Two taps racing with the same clientRef: the loser reports the winner's sale.
      if (e.code === "23505" && b.clientRef) return null;
      throw e;
    });
    if (!out) {
      const dup = (await query("SELECT code, total, change_given FROM orders WHERE client_ref = $1", [b.clientRef])).rows[0];
      return res.status(200).json({ code: dup.code, total: dup.total, change: dup.change_given, duplicate: true });
    }
    res.status(201).json(out);
  }));

  /* ---------------------------------------------------------- manager override (PIN) */
  r.post("/pos/authorize", requirePerm("pos.use"), ah(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().email(), pin: z.string().regex(/^\d{4,6}$/, "4–6 digits"), pct: z.coerce.number().min(0).max(100) }), req.body);
    const out = await tx(async (db) => {
      const m = (await db.query("SELECT * FROM users WHERE lower(email) = lower($1) AND active FOR UPDATE", [b.email])).rows[0];
      const roles = m ? [m.role, ...(m.extra_roles || [])] : [];
      if (!m || !m.pos_pin_hash || !can(roles, "pos.discount")) throw new HttpError(403, "That person can't approve discounts, or hasn't set a till PIN.");
      if (m.id === req.user.id) throw new HttpError(403, "Another manager must approve — not the person selling.");
      if (m.pos_pin_locked_until && new Date(m.pos_pin_locked_until) > new Date()) throw new HttpError(429, "Too many wrong PINs — this manager's PIN is locked for 15 minutes.");
      if (!(await bcrypt.compare(b.pin, m.pos_pin_hash))) {
        const fails = m.pos_pin_fails + 1;
        const lock = fails >= PIN_MAX_FAILS;
        await db.query("UPDATE users SET pos_pin_fails = $2, pos_pin_locked_until = $3 WHERE id = $1",
          [m.id, lock ? 0 : fails, lock ? new Date(Date.now() + 15 * 60e3) : null]);
        await audit(db, req.user.id, "Wrong manager PIN at the till", `for ${m.name}${lock ? " · PIN locked 15 min" : ""}`);
        return { error: lock ? "Wrong PIN — locked for 15 minutes." : "Wrong PIN." };
      }
      await db.query("UPDATE users SET pos_pin_fails = 0, pos_pin_locked_until = NULL WHERE id = $1", [m.id]);
      const maxPct = await discountAuthority(db, roles);
      if (b.pct > maxPct + 1e-9) throw new HttpError(403, `${m.name} can approve up to ${maxPct}% — this is ${b.pct.toFixed(1)}%. Ask the Owner or MD.`);
      return { token: signPurpose({ purpose: "pos-override", approver: m.id, cashier: req.user.id, maxPct }, "10m"), approver: m.name, maxPct };
    });
    if (out.error) throw new HttpError(403, out.error);
    res.json(out);
  }));

  r.post("/auth/pos-pin", requirePerm("pos.discount"), ah(async (req, res) => {
    const b = parse(z.object({ password: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/, "must be 4–6 digits") }), req.body);
    if (weakPin(b.pin)) throw bad("Pick a PIN that isn't one digit repeated or a straight run (like 1234).");
    if (!(await bcrypt.compare(b.password, req.user.password_hash))) throw bad("Current password is incorrect.");
    await query("UPDATE users SET pos_pin_hash = $2, pos_pin_fails = 0, pos_pin_locked_until = NULL WHERE id = $1", [req.user.id, await bcrypt.hash(b.pin, 10)]);
    await audit(null, req.user.id, "Set till approval PIN", null);
    res.json({ ok: true });
  }));

  /* ---------------------------------------------------------- held (parked) tickets */
  const cartLine = z.object({ sku: z.string().min(1), qty: qtyNum, scale: z.boolean().optional(), discount: discountSchema.optional() });
  r.post("/pos/held", requirePerm("pos.use"), ah(async (req, res) => {
    const b = parse(z.object({
      label: z.string().trim().max(40).optional().or(z.literal("")),
      customerId: id.nullable().optional(),
      cart: z.object({ items: z.array(cartLine).min(1).max(100), discount: discountSchema.optional(), discountReason: z.string().max(60).optional() }),
      total: z.coerce.number().int().min(0).max(1e12),
    }), req.body);
    const count = (await query("SELECT count(*)::int AS n FROM pos_held")).rows[0].n;
    if (count >= 50) throw conflict("50 tickets are already on hold — recall or clear some first.");
    const label = b.label || `Ticket ${new Date(Date.now() + 3600e3).toISOString().slice(11, 16)}`;
    const row = (await query("INSERT INTO pos_held (label, customer_id, cart, total, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [label, b.customerId ?? null, JSON.stringify(b.cart), b.total, req.user.id])).rows[0];
    res.status(201).json({ id: row.id, label });
  }));

  /** Recall = take it off hold (returns the cart). Any till may recall a parked ticket. */
  r.post("/pos/held/:id/recall", requirePerm("pos.use"), ah(async (req, res) => {
    const row = (await query("DELETE FROM pos_held WHERE id = $1 RETURNING *", [req.params.id])).rows[0];
    if (!row) throw notFound("That ticket was already recalled on another till.");
    res.json({ label: row.label, customerId: row.customer_id, cart: row.cart });
  }));

  /** Clearing a ticket that had items is logged (loss prevention). */
  r.post("/pos/void", requirePerm("pos.use"), ah(async (req, res) => {
    const b = parse(z.object({ lines: z.coerce.number().int().min(1).max(100), value: z.coerce.number().int().min(0).max(1e12),
      reason: z.string().trim().max(60).optional() }), req.body);
    const till = await openTill({ query }, req.user.id);
    if (till) await query("UPDATE till_sessions SET voided_tickets = voided_tickets + 1, voided_value = voided_value + $2 WHERE id = $1", [till.id, b.value]);
    await audit(null, req.user.id, "Cleared a ticket", `${b.lines} line${b.lines === 1 ? "" : "s"} · ${naira(b.value)}${b.reason ? ` · ${b.reason}` : ""}${till ? ` · ${till.code}` : ""}`);
    res.json({ ok: true });
  }));

  /* ---------------------------------------------------------- X / Z report */
  r.get("/till/:code/report", requireAuth, ah(async (req, res) => {
    const s = (await query(`SELECT t.*, u.name AS cashier FROM till_sessions t JOIN users u ON u.id = t.user_id WHERE t.code = $1`, [req.params.code])).rows[0];
    if (!s) throw notFound("Till session not found.");
    const reviewer = can(req.user.roles, "till.review");
    const mine = s.user_id === req.user.id;
    if (!reviewer && !mine) throw new HttpError(403, "You can only see your own till's report.");
    if (!reviewer && s.status === "Open") throw new HttpError(403, "Your Z report is ready once the till is closed (blind count).");
    const sum = await tillSummary({ query }, s);
    const [refunds, discounts, top] = await Promise.all([
      query(`SELECT method, count(*)::int AS n, COALESCE(sum(amount), 0) AS amount FROM refunds WHERE till_session_id = $1 AND status = 'Approved' GROUP BY method`, [s.id]),
      query(`SELECT discount_reason AS reason, count(*)::int AS n, COALESCE(sum(discount_total), 0) AS amount FROM orders
             WHERE till_session_id = $1 AND status <> 'Cancelled' AND discount_total > 0 GROUP BY discount_reason ORDER BY amount DESC`, [s.id]),
      query(`SELECT p.name, p.unit, sum(oi.qty) AS qty, sum(oi.subtotal) AS amount FROM order_items oi JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.sku = oi.product_sku WHERE o.till_session_id = $1 AND o.status <> 'Cancelled'
             GROUP BY p.name, p.unit ORDER BY amount DESC LIMIT 10`, [s.id]),
    ]);
    const showCash = reviewer || s.status !== "Open";
    res.json({
      type: s.status === "Open" ? "X" : "Z", code: s.code, cashier: s.cashier, status: s.status,
      openedAt: fmtDateTime(s.opened_at), closedAt: s.closed_at ? fmtDateTime(s.closed_at) : null, printedAt: fmtDateTime(new Date()),
      sales: { count: sum.sales.n, gross: sum.sales.gross, discounts: sum.sales.discounts, net: sum.sales.net, tax: sum.sales.tax },
      tenders: sum.byMethod, changeGiven: sum.sales.change,
      refunds: refunds.rows, discountsByReason: discounts.rows, topItems: top.rows.map((t) => ({ ...t, qty: round3(t.qty) })),
      voided: { tickets: s.voided_tickets, value: s.voided_value },
      cash: showCash ? { float: sum.float, cashIn: sum.cashIn, cashOut: sum.cashOut, expected: sum.expected,
        counted: s.counted_cash, variance: s.variance } : null,
    });
  }));

  /* ---------------------------------------------------------- receipt header */
  r.patch("/settings/business", requirePerm("setup.manage"), ah(async (req, res) => {
    const t = (n) => z.string().trim().max(n).optional();
    const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), tagline: t(80), address: t(160), phone: t(40), email: t(80),
      tin: t(30), receiptFooter: t(200), scaleLabel: z.enum(["weight", "price"]).optional() }), req.body);
    const cur = await businessProfile();
    const next = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
    await query("INSERT INTO settings (key, value) VALUES ('business_profile', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(next)]);
    const ch = Object.keys(next).filter((k) => next[k] !== cur[k]);
    if (ch.length) await audit(null, req.user.id, "Updated receipt details", ch.join(", "));
    res.json(next);
  }));
}

/* ================================================================== state */
export async function posState(user) {
  const [held, profile, limits] = await Promise.all([
    query(`SELECT h.id, h.label, h.total, h.created_at, h.cart, c.name AS customer, u.name AS who FROM pos_held h
           LEFT JOIN customers c ON c.id = h.customer_id JOIN users u ON u.id = h.user_id ORDER BY h.created_at`),
    businessProfile(),
    approvalLimits(),
  ]);
  return {
    held: held.rows.map((h) => ({ id: h.id, label: h.label, total: h.total, customer: h.customer, who: h.who, at: fmtDateTime(h.created_at), lines: h.cart.items.length })),
    profile,
    discountReasons: DISCOUNT_REASONS,
    myDiscountPct: can(user.roles, UNLIMITED_APPROVER) ? 100 : can(user.roles, "pos.discount") ? limits.discountPct : 0,
  };
}
