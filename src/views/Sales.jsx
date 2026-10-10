import React, { useEffect, useMemo, useState } from "react";
import { Plus, X, Download, Phone, MapPin, Search, UserPlus, Check, ArrowRight, Printer, Ban, Loader2, ShoppingCart, Undo2, Wallet, Lock, FileText } from "lucide-react";
import { C, nairaFmt, qtyFmt, initials, exportCsv } from "../lib/theme.js";
import { ORDER_FLOW, REFUND_REASONS, RESTOCK_REASON } from "../shared/permissions.js";
import { SectionHeader, Btn, StatusPill, Modal, Field, Input, Select, Card, Table, Empty, useBusy } from "../components/ui.jsx";
import { TillReportModal, printReceipt } from "./POS.jsx";

const AREAS = ["Wuse II", "Garki", "Maitama", "Gwarinpa", "Jabi", "Asokoro", "Life Camp", "Utako", "Kubwa", "Lokogoma"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ============================================================ ORDERS */
const ORDER_FILTERS = ["All", "Open", "Unpaid", "Delivered", "Cancelled"];

export function OrdersView({ data, actions, permit }) {
  const orders = data.orders || [];
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const [open, setOpen] = useState(null);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "Open") list = list.filter((o) => !["Delivered", "Cancelled"].includes(o.status));
    if (filter === "Unpaid") list = list.filter((o) => o.payment === "Pending" && o.status !== "Cancelled");
    if (filter === "Delivered" || filter === "Cancelled") list = list.filter((o) => o.status === filter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((o) => o.id.toLowerCase().includes(s) || o.customer.toLowerCase().includes(s) || o.product.toLowerCase().includes(s));
    }
    return list;
  }, [orders, filter, q]);

  const exportOrders = () => {
    const ok = exportCsv(`bladeos-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((o) => ({ order: o.id, date: o.date, customer: o.customer, products: o.product, amount: o.amount, payment: o.payment, status: o.status, channel: o.channel, area: o.area })));
    actions.notify(ok ? "Orders exported" : "Nothing to export", ok ? "ok" : "error");
  };

  return (
    <div>
      {open && <OrderModal code={open} actions={actions} permit={permit} profile={data.pos?.profile} onClose={() => setOpen(null)} />}
      <SectionHeader eyebrow="Sales" title="Orders" action={<Btn icon={Download} small variant="ghost" onClick={exportOrders}>Export</Btn>} />
      <Card pad={false}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: C.line }}>
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {ORDER_FILTERS.map((f) => (
              <button key={f} onClick={() => { setFilter(f); setLimit(40); }} className="f-body text-xs px-2.5 py-1.5 rounded-md font-medium shrink-0 transition-all active:scale-95"
                style={{ background: filter === f ? C.charcoal : C.cream, color: filter === f ? "#fff" : C.muted }}>{f}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 sm:w-64" style={{ background: C.cream }}>
            <Search size={14} style={{ color: C.muted }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, customer, product" className="bg-transparent outline-none text-sm f-body w-full" />
          </div>
        </div>
        <Table head={["Order", "Customer", "Products", "Amount", "Payment", "Status", "Date"]} minWidth={760} empty={filtered.length === 0 ? "No orders match." : null}>
          {filtered.slice(0, limit).map((o) => (
            <tr key={o.id} className="border-t hover:bg-stone-50 cursor-pointer" style={{ borderColor: C.rowLine }} onClick={() => setOpen(o.id)}>
              <td className="px-5 py-3 f-mono text-sm font-semibold whitespace-nowrap" style={{ color: C.burgundy }}>{o.id}</td>
              <td className="px-5 py-3 f-body text-sm" style={{ color: C.ink }}>{o.customer}</td>
              <td className="px-5 py-3 f-body text-sm truncate max-w-[220px]" style={{ color: C.muted }}>{o.product}</td>
              <td className="px-5 py-3 f-mono text-sm font-semibold whitespace-nowrap" style={{ color: C.ink }}>
                {nairaFmt(o.amount)}{o.refunded > 0 && <div className="f-body text-[10px] font-normal" style={{ color: C.danger }}>−{nairaFmt(o.refunded)} refunded</div>}
              </td>
              <td className="px-5 py-3"><StatusPill status={o.payment} /></td>
              <td className="px-5 py-3"><StatusPill status={o.status} /></td>
              <td className="px-5 py-3 f-body text-sm whitespace-nowrap" style={{ color: C.muted }}>{o.date}</td>
            </tr>
          ))}
        </Table>
        <div className="px-5 py-3 border-t flex items-center justify-between gap-2" style={{ borderColor: C.line }}>
          <span className="f-body text-xs" style={{ color: C.muted }}>Showing {Math.min(limit, filtered.length)} of {filtered.length} (latest {orders.length} orders loaded)</span>
          {filtered.length > limit && <Btn small variant="ghost" onClick={() => setLimit((l) => l + 60)}>Show more</Btn>}
        </div>
      </Card>
    </div>
  );
}

function OrderModal({ code, actions, permit, profile, onClose }) {
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [payWith, setPayWith] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [busy, run] = useBusy();
  const load = () => actions.getOrder(code).then(setO).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [code]);

  const canEdit = permit("orders.edit");
  const canRefund = permit("refunds.request") || permit("refunds.direct");
  const refundDirect = permit("refunds.direct");
  const next = o && ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
  const update = (body) => run(async () => { if (await actions.updateOrder(code, body)) { setConfirmCancel(false); await load(); } });

  return (
    <Modal title={`Order ${code}`} onClose={onClose} wide>
      {refunding && o && <RefundModal order={o} direct={refundDirect} onClose={() => setRefunding(false)}
        onSubmit={async (body) => { const r = await actions.requestRefund(body); if (r) { setRefunding(false); await load(); } return r; }} />}
      {error && <p className="f-body text-sm" style={{ color: C.danger }}>{error}</p>}
      {!o && !error && <div className="flex items-center gap-2 f-body text-sm" style={{ color: C.muted }}><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {o && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <StatusPill status={o.status} /><StatusPill status={o.payment} />
            <span className="f-body text-xs" style={{ color: C.muted }}>{o.channel}{o.paymentMethod ? ` · ${o.paymentMethod}` : ""}{o.paymentRef ? ` (${o.paymentRef})` : ""}{o.staff ? ` · by ${o.staff}` : ""}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
            <Info label="Customer" value={o.customer} />
            <Info label="Phone" value={o.phone || "—"} />
            <Info label="Area" value={o.area || "—"} />
            <Info label="Placed" value={new Date(o.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })} />
          </div>
          <div className="rounded-xl overflow-hidden border mb-5" style={{ borderColor: C.border }}>
            {o.items.map((i, k) => (
              <div key={k} className="flex justify-between gap-2 px-4 py-2.5 border-b last:border-0" style={{ borderColor: C.rowLine }}>
                <div>
                  <div className="f-body text-sm" style={{ color: C.ink }}>{i.name}</div>
                  <div className="f-mono text-xs" style={{ color: C.muted }}>{i.qty} {i.unit} × {nairaFmt(i.listPrice ?? i.price)}{i.discount ? ` · −${nairaFmt(i.discount)}` : ""}</div>
                </div>
                <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>{nairaFmt(i.subtotal)}</div>
              </div>
            ))}
            {o.discount > 0 && (
              <div className="flex justify-between px-4 py-2 border-t" style={{ borderColor: C.rowLine }}>
                <span className="f-body text-xs" style={{ color: C.gold }}>Discount{o.discountReason ? ` · ${o.discountReason}` : ""}</span>
                <span className="f-mono text-xs" style={{ color: C.gold }}>−{nairaFmt(o.discount)}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3" style={{ background: C.cream }}>
              <span className="f-body text-sm font-semibold">Total{o.payments?.length > 1 ? ` · ${o.payments.map((p) => `${p.method} ${nairaFmt(p.amount)}`).join(" + ")}` : ""}</span>
              <span className="f-mono text-base font-bold" style={{ color: C.burgundy }}>{nairaFmt(o.total)}</span>
            </div>
            {o.refunded > 0 && (
              <div className="flex justify-between px-4 py-2.5 border-t" style={{ borderColor: C.rowLine }}>
                <span className="f-body text-sm" style={{ color: C.danger }}>Refunded · net {nairaFmt(o.netTotal)}</span>
                <span className="f-mono text-sm font-semibold" style={{ color: C.danger }}>−{nairaFmt(o.refunded)}</span>
              </div>
            )}
          </div>
          {o.refunds.length > 0 && (
            <div className="mb-5">
              <div className="f-body text-[10px] uppercase tracking-wide mb-2" style={{ color: C.muted }}>Refunds</div>
              <div className="space-y-1.5">
                {o.refunds.map((r) => (
                  <div key={r.code} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: C.cream }}>
                    <div className="min-w-0">
                      <div className="f-body text-xs" style={{ color: C.ink }}>{r.code} · {r.reason}</div>
                      <div className="f-body text-[11px]" style={{ color: C.muted }}>by {r.requestedBy}{r.decidedBy ? ` · ${r.status.toLowerCase()} by ${r.decidedBy}` : " · awaiting approval"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="f-mono text-sm font-semibold" style={{ color: C.danger }}>{nairaFmt(r.amount)}</div>
                      <StatusPill status={r.status === "Approved" ? "Paid" : r.status === "Pending" ? "Pending" : "Cancelled"} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {canEdit && o.status !== "Cancelled" && (
            <div className="flex flex-wrap gap-2">
              {next && <Btn icon={ArrowRight} busy={busy} onClick={() => update({ status: next })}>Mark {next}</Btn>}
              {o.payment === "Pending" && (
                <span className="inline-flex gap-1 items-center">
                  <Select value={payWith} onChange={(e) => setPayWith(e.target.value)}><option>Cash</option><option>Transfer</option><option>POS Card</option></Select>
                  {payWith !== "Cash" && <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} maxLength={60} placeholder={payWith === "Transfer" ? "Sender / bank" : "Slip no."} aria-label="Payment reference" />}
                  <Btn variant="gold" icon={Check} busy={busy} onClick={() => update({ paymentStatus: "Paid", paymentMethod: payWith, ...(payWith !== "Cash" && payRef.trim() ? { paymentRef: payRef.trim() } : {}) })}>Mark Paid</Btn>
                </span>
              )}
              {o.status !== "Delivered" && (!confirmCancel
                ? <Btn variant="danger" icon={Ban} onClick={() => setConfirmCancel(true)}>Cancel Order</Btn>
                : <Btn variant="danger" icon={Ban} busy={busy} onClick={() => update({ status: "Cancelled" })}>Confirm — cancel & restock</Btn>)}
            </div>
          )}
          <div className="mt-3">
            <Btn small variant="ghost" icon={Printer} onClick={() => printReceipt(profile, {
              code: o.code, at: o.createdAt, cashier: o.staff, customer: o.customer,
              lines: o.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.listPrice ?? i.price, discount: i.discount || 0, total: i.subtotal, vat: i.tax > 0 })),
              gross: o.gross ?? o.total, discount: o.discount || 0, tax: o.tax || 0, total: o.total,
              tenders: o.payments || [], change: o.change || 0, later: o.payment !== "Paid" }, { copy: true })}>Reprint receipt</Btn>
          </div>
          {canRefund && o.refundable && o.items.some((i) => i.refundableQty > 0) && (
            <div className="mt-3"><Btn variant="ghost" icon={Undo2} onClick={() => setRefunding(true)}>{refundDirect ? "Refund Items" : "Request Refund"}</Btn></div>
          )}
        </>
      )}
    </Modal>
  );
}

function RefundModal({ order, direct, onClose, onSubmit }) {
  const [qty, setQty] = useState(() => Object.fromEntries(order.items.map((i) => [i.id, ""])));
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(["Cash", "Transfer", "POS Card"].includes(order.paymentMethod) ? order.paymentMethod : "Cash");
  const [note, setNote] = useState("");
  const [busy, run] = useBusy();
  const sameDayCounter = order.channel === "POS" &&
    new Date(order.createdAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" }) === new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" });
  const reasons = REFUND_REASONS.filter((r) => r !== RESTOCK_REASON || sameDayCounter);
  const lines = order.items.map((i) => {
    const v = qty[i.id]; const q = Number(v);
    const err = v === "" ? null : !(q > 0) ? "Above zero" : i.unit !== "KG" && !Number.isInteger(q) ? "Whole numbers" : q > i.refundableQty + 1e-9 ? `Max ${i.refundableQty}` : null;
    return { ...i, q: v === "" ? 0 : q, err };
  });
  const chosen = lines.filter((l) => l.q > 0 && !l.err);
  const amount = chosen.reduce((s, l) => s + Math.round(l.q * l.price), 0);
  const valid = chosen.length > 0 && !lines.some((l) => l.err) && reason && note.trim().length >= 3;
  const submit = (e) => {
    e.preventDefault();
    run(() => onSubmit({ order: order.code, items: chosen.map((l) => ({ itemId: l.id, qty: l.q })), reason, method, note: note.trim() }));
  };
  return (
    <Modal title={`Refund — ${order.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="f-body text-sm" style={{ color: C.ink }}>{l.name}</div>
                <div className="f-mono text-[11px]" style={{ color: C.muted }}>{l.refundableQty > 0 ? `up to ${l.refundableQty} ${l.unit} · ${nairaFmt(l.price)}/${l.unit}` : "nothing left to refund"}</div>
              </div>
              <div className="w-28 shrink-0">
                <Input mono type="number" min="0" step={l.unit === "KG" ? "0.001" : "1"} disabled={l.refundableQty <= 0}
                  value={qty[l.id]} onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))} placeholder="0" />
                {l.err && <div className="f-body text-[10px]" style={{ color: C.danger }}>{l.err}</div>}
              </div>
            </div>
          ))}
        </div>
        <Field label="Reason" hint={reason && reason !== RESTOCK_REASON ? "Food safety: returned meat is written off, not resold." : reason === RESTOCK_REASON ? "The goods go back into stock where they came from." : null}>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason…</option>
            {reasons.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Pay back by"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option>Cash</option><option>Transfer</option><option>POS Card</option></Select></Field>
          <Field label="Refund amount"><div className="f-mono text-lg font-semibold py-1.5" style={{ color: C.danger }}>{nairaFmt(amount)}</div></Field>
        </div>
        <Field label="What happened"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Customer found bone fragments" /></Field>
        {!direct && <p className="f-body text-xs" style={{ color: C.muted }}>A manager must approve this before any money is paid back.</p>}
        <Btn type="submit" icon={Undo2} full busy={busy} disabled={!valid}>{direct ? `Refund ${nairaFmt(amount)}` : "Submit for Approval"}</Btn>
      </form>
    </Modal>
  );
}

const Info = ({ label, value }) => (
  <div>
    <div className="f-body text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>{label}</div>
    <div className="f-body text-sm font-medium" style={{ color: C.ink }}>{value}</div>
  </div>
);

/* ============================================================ CUSTOMERS */
export function CustomersView({ data, actions, permit }) {
  const customers = data.customers || [];
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const filtered = q.trim()
    ? customers.filter((c) => [c.name, c.phone, c.area, c.code].some((v) => String(v).toLowerCase().includes(q.trim().toLowerCase())))
    : customers;
  return (
    <div>
      {selected && <CustomerProfile customer={customers.find((c) => c.id === selected)} onClose={() => setSelected(null)} />}
      {adding && <AddCustomerModal onClose={() => setAdding(false)} onSave={actions.addCustomer} />}
      <SectionHeader eyebrow="Sales" title="Customer CRM" action={<>
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 w-56 border" style={{ background: "#fff", borderColor: C.border }}>
          <Search size={14} style={{ color: C.muted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" className="bg-transparent outline-none text-sm f-body w-full" />
        </div>
        {permit("customers.edit") && <Btn icon={UserPlus} small onClick={() => setAdding(true)}>Add Customer</Btn>}
      </>} />
      {filtered.length === 0 && <Empty>No customers match.</Empty>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <button key={c.id} onClick={() => setSelected(c.id)} className="text-left rounded-2xl p-5 border hover:shadow-md transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2" style={{ background: "#fff", borderColor: C.border, "--tw-ring-color": C.gold }}>
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center f-mono text-xs font-semibold shrink-0" style={{ background: C.gold, color: "#fff" }}>{initials(c.name)}</div>
              <span className="f-body text-xs truncate" style={{ color: C.muted }}>{c.area}</span>
            </div>
            <div className="f-body text-sm font-semibold mb-2 truncate" style={{ color: C.ink }}>{c.name}</div>
            <div className="grid grid-cols-3 gap-2 f-mono text-xs">
              <div><span style={{ color: C.muted }}>Orders</span><div className="font-semibold" style={{ color: C.ink }}>{c.orders}</div></div>
              <div className="col-span-2"><span style={{ color: C.muted }}>Spent</span><div className="font-semibold truncate" style={{ color: C.burgundy }}>{nairaFmt(c.spent)}</div></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomerProfile({ customer, onClose }) {
  if (!customer) return null;
  return (
    <Modal title={customer.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[["Total Orders", customer.orders], ["Total Spent", nairaFmt(customer.spent)], ["Avg. Order", nairaFmt(customer.avg)], ["Last Purchase", customer.last]].map(([l, v], i) => (
          <div key={l} className="rounded-xl p-3" style={{ background: C.cream }}>
            <div className="f-body text-[10px] uppercase" style={{ color: C.muted }}>{l}</div>
            <div className={`f-mono ${i === 3 ? "text-sm" : "text-lg"} font-semibold truncate`} style={{ color: i === 1 ? C.burgundy : C.ink }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 f-body text-sm" style={{ color: C.muted }}>
        <span className="f-mono text-xs">{customer.code}</span>
        {customer.phone !== "—" && <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 hover:underline"><Phone size={13} /> {customer.phone}</a>}
        {customer.area !== "—" && <span className="flex items-center gap-1.5"><MapPin size={13} /> {customer.area}, Abuja</span>}
      </div>
      {customer.favourites.length > 0 && (<>
        <h4 className="f-body text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.muted }}>Favourite Products</h4>
        <div className="flex flex-wrap gap-2 mb-6">
          {customer.favourites.map((f) => <span key={f} className="f-body text-xs px-3 py-1.5 rounded-full" style={{ background: "#F3E4E6", color: C.burgundy }}>{f}</span>)}
        </div>
      </>)}
      <h4 className="f-body text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.muted }}>Recent Orders</h4>
      {customer.history.length === 0 ? <Empty>No orders yet.</Empty> : (
        <div className="space-y-2">
          {customer.history.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ background: C.cream }}>
              <div className="min-w-0">
                <div className="f-body text-sm truncate" style={{ color: C.ink }}>{o.product}</div>
                <div className="f-mono text-xs" style={{ color: C.muted }}>{o.id} · {o.date}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>{nairaFmt(o.amount)}</div>
                {o.status !== "Delivered" && <StatusPill status={o.status} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function AddCustomerModal({ onClose, onSave, onCreated }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [busy, run] = useBusy();
  const phoneBad = phone && !/^[+\d][\d\s-]{6,19}$/.test(phone.trim());
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await onSave({ name: name.trim(), phone: phone.trim(), area: area.trim() || undefined });
      if (r) { onCreated?.(r); onClose(); }
    });
  };
  return (
    <Modal title="Add Customer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoFocus /></Field>
        <Field label="Phone" error={phoneBad ? "Check the number" : null}><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" /></Field>
        <Field label="Area">
          <Input list="cust-areas" value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="e.g. Wuse II" />
          <datalist id="cust-areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
        <Btn type="submit" icon={Check} full busy={busy} disabled={name.trim().length < 2 || phoneBad}>Save Customer</Btn>
      </form>
    </Modal>
  );
}

/* ============================================================ DELIVERY */
export function DeliveryView({ data, actions, permit }) {
  const list = data.deliveries || [];
  const [open, setOpen] = useState(null);
  const [busyCode, setBusyCode] = useState(null);
  const canEdit = permit("orders.edit");
  const advance = async (o) => {
    const next = ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
    if (!next) return;
    setBusyCode(o.id);
    await actions.updateOrder(o.id, { status: next });
    setBusyCode(null);
  };
  const counts = ORDER_FLOW.slice(0, 4).map((s) => [s, list.filter((o) => o.status === s).length]);
  return (
    <div>
      {open && <OrderModal code={open} actions={actions} permit={permit} profile={data.pos?.profile} onClose={() => setOpen(null)} />}
      <SectionHeader eyebrow="Sales" title="Delivery Dashboard" />
      {permit("till.use") && !permit("pos.use") && <TillBar till={data.tills?.mine} actions={actions} label="cash bag" />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {counts.map(([s, n]) => (
          <div key={s} className="rounded-xl px-4 py-3 border" style={{ background: "#fff", borderColor: C.border }}>
            <div className="f-body text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>{s}</div>
            <div className="f-mono text-xl font-semibold" style={{ color: C.ink }}>{n}</div>
          </div>
        ))}
      </div>
      <Card pad={false}>
        <Table head={["Order", "Customer", "Area", "Amount", "Payment", "Status", ""]} minWidth={720} empty={list.length === 0 ? "No deliveries waiting — everything is out the door." : null}>
          {list.map((o) => {
            const next = ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
            return (
              <tr key={o.id} className="border-t" style={{ borderColor: C.rowLine }}>
                <td className="px-5 py-3 f-mono text-sm font-semibold cursor-pointer hover:underline whitespace-nowrap" style={{ color: C.burgundy }} onClick={() => setOpen(o.id)}>{o.id}</td>
                <td className="px-5 py-3 f-body text-sm" style={{ color: C.ink }}>{o.customer}</td>
                <td className="px-5 py-3 f-body text-sm" style={{ color: C.muted }}><span className="inline-flex items-center gap-1.5"><MapPin size={12} />{o.area}</span></td>
                <td className="px-5 py-3 f-mono text-sm" style={{ color: C.ink }}>{nairaFmt(o.amount)}</td>
                <td className="px-5 py-3"><StatusPill status={o.payment} /></td>
                <td className="px-5 py-3"><StatusPill status={o.status} /></td>
                <td className="px-5 py-3 text-right">
                  {canEdit && next && <Btn small icon={ArrowRight} busy={busyCode === o.id} onClick={() => advance(o)}>{next}</Btn>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

/* ============================================================ TILL */
export function TillBar({ till, actions, label = "till", canX = false }) {
  const [float, setFloat] = useState("");
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState(null);
  const [busy, run] = useBusy();
  const Label = label[0].toUpperCase() + label.slice(1);
  // The close dialog lives outside the open/closed branches so its result survives the refresh that closes the till.
  const closeModal = (<>
    {closing && <CloseTillModal till={till || closing} label={label} actions={actions} onClose={() => setClosing(false)} onReport={(code) => { setClosing(false); setReport(code); }} />}
    {report && <TillReportModal code={report} actions={actions} onClose={() => setReport(null)} />}
  </>);
  if (!till) return (<>
    {closeModal}
    <Card className="mb-5">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <div className="f-body text-sm font-semibold flex items-center gap-2 mb-1" style={{ color: C.ink }}><Lock size={14} /> Your {label} is closed</div>
          <p className="f-body text-xs" style={{ color: C.muted }}>Count the opening float in the drawer and enter it to start {label === "till" ? "selling" : "collecting cash"}.</p>
        </div>
        <div className="w-full sm:w-44"><Field label="Opening float (₦)"><Input mono type="number" min="0" step="1" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="20000" /></Field></div>
        <Btn icon={Wallet} busy={busy} disabled={float === "" || !(Number(float) >= 0) || !Number.isInteger(Number(float))} onClick={() => run(() => actions.openTill(Number(float)))}>Open {Label}</Btn>
      </div>
    </Card>
  </>);
  return (
    <>
      {closeModal}
      <div className="rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center justify-between gap-2" style={{ background: till.stale ? "#F5E4E2" : "#E7F0E9" }}>
        <span className="f-body text-xs" style={{ color: C.ink }}>
          <Wallet size={12} className="inline mr-1.5" style={{ color: till.stale ? C.danger : C.ok }} />
          {Label} <span className="f-mono font-semibold">{till.code}</span> open since {till.openedAt} · float {nairaFmt(till.float)} · {till.sales} sale{till.sales === 1 ? "" : "s"}
          {till.stale && <span style={{ color: C.danger }}> · open over 16 hours — close it now</span>}
        </span>
        <span className="flex gap-1.5">
          {canX && <Btn small variant="ghost" icon={FileText} onClick={() => setReport(till.code)}>X report</Btn>}
          <Btn small variant="ghost" icon={Lock} onClick={() => setClosing(till)}>Close {Label}</Btn>
        </span>
      </div>
    </>
  );
}

function CloseTillModal({ till, label, actions, onClose, onReport }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await actions.closeTill({ counted: Number(counted), note: note.trim() || undefined });
      if (r) setResult(r);
    });
  };
  if (result) return (
    <Modal title={`${result.code} closed`} onClose={onClose}>
      <div className="text-center mb-5">
        <div className="f-mono text-2xl font-semibold mb-1" style={{ color: result.variance === 0 ? C.ok : C.danger }}>
          {result.variance === 0 ? "Balanced" : `${nairaFmt(Math.abs(result.variance))} ${result.variance > 0 ? "over" : "short"}`}
        </div>
        <div className="f-body text-sm" style={{ color: C.muted }}>Counted {nairaFmt(result.counted)} · expected {nairaFmt(result.expected)}</div>
        <p className="f-body text-xs mt-3" style={{ color: C.muted }}>Sent to a manager for sign-off. Hand the cash over as usual.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Btn variant="ghost" icon={FileText} onClick={() => onReport?.(result.code)}>Z report</Btn>
        <Btn onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
  return (
    <Modal title={`Close ${label} ${till.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="f-body text-sm" style={{ color: C.ink }}>Count all the cash in the {label}, including the float, and enter the total. The system figure is shown only after you submit.</p>
        <Field label="Cash counted (₦)"><Input mono type="number" min="0" step="1" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. ₦500 note torn, set aside" /></Field>
        <Btn type="submit" icon={Lock} full busy={busy} disabled={counted === "" || !Number.isInteger(Number(counted)) || Number(counted) < 0}>Close & Submit Count</Btn>
      </form>
    </Modal>
  );
}
