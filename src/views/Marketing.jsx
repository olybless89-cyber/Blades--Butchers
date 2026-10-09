import React, { useState } from "react";
import { Plus, Pencil, Check, Trash2, Download, CalendarDays } from "lucide-react";
import { C, nairaFmt, exportCsv } from "../lib/theme.js";
import { CONTENT_STATUSES } from "../shared/permissions.js";
import { KpiCard, SectionHeader, Btn, StatusPill, Modal, Field, Input, Select, Card, Table, Empty, ICONS, useBusy } from "../components/ui.jsx";

const PLATFORMS = ["Instagram", "TikTok", "Facebook", "WhatsApp", "X (Twitter)", "All Channels"];
const POST_TYPES = ["Product Spotlight", "Butcher Tip", "Behind the Scenes", "Recipe", "Weekend Offer", "Customer Testimonial", "Lifestyle / Family Food"];
const todayIso = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function MarketingView({ data, actions, permit }) {
  const campaigns = data.campaigns || [];
  const content = data.content || [];
  const canEdit = permit("marketing.edit");
  const [modal, setModal] = useState(null); // { kind: "campaign"|"post", item? }
  const [confirm, setConfirm] = useState(null);

  const spend = campaigns.reduce((s, c) => s + c.budget, 0);
  const revenue = campaigns.reduce((s, c) => s + c.revenue, 0);
  const leads = campaigns.reduce((s, c) => s + c.leads, 0);
  const orders = campaigns.reduce((s, c) => s + c.orders, 0);
  const today = todayIso();
  const upcoming = content.filter((p) => p.date >= today);
  const recent = content.filter((p) => p.date < today).reverse();

  const doExport = () => {
    const ok = exportCsv("bladeos-campaigns.csv", campaigns.map(({ id, ...c }) => ({ ...c, roas: c.budget ? (c.revenue / c.budget).toFixed(2) : "" })));
    actions.notify(ok ? "Campaigns exported" : "Nothing to export", ok ? "ok" : "error");
  };
  const remove = async () => {
    const { kind, item } = confirm;
    const ok = kind === "campaign" ? await actions.deleteCampaign(item.id, item.name) : await actions.deletePost(item.id);
    if (ok) setConfirm(null);
  };

  return (
    <div>
      {modal?.kind === "campaign" && <CampaignForm item={modal.item} onClose={() => setModal(null)} actions={actions} />}
      {modal?.kind === "post" && <PostForm item={modal.item} onClose={() => setModal(null)} actions={actions} />}
      {confirm && (
        <Modal title="Delete?" onClose={() => setConfirm(null)}>
          <p className="f-body text-sm mb-5" style={{ color: C.ink }}>Delete {confirm.kind === "campaign" ? `the campaign "${confirm.item.name}"` : `the post "${confirm.item.title}"`}? This can't be undone.</p>
          <div className="flex gap-2"><Btn variant="ghost" full onClick={() => setConfirm(null)}>Keep it</Btn><Btn variant="danger" icon={Trash2} full onClick={remove}>Delete</Btn></div>
        </Modal>
      )}

      <SectionHeader eyebrow="Marketing" title="Marketing & Content" action={<>
        {campaigns.length > 0 && <Btn icon={Download} small variant="ghost" onClick={doExport}>Export</Btn>}
        {canEdit && <Btn icon={Plus} small onClick={() => setModal({ kind: "campaign" })}>Add Campaign</Btn>}
      </>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KpiCard label="Ad Spend" value={nairaFmt(spend)} icon={ICONS.DollarSign} />
        <KpiCard label="Leads" value={leads.toLocaleString("en-NG")} icon={ICONS.MessageCircle} />
        <KpiCard label="Orders" value={orders.toLocaleString("en-NG")} icon={ICONS.ClipboardList} />
        <KpiCard label="Blended ROAS" value={spend ? `${(revenue / spend).toFixed(2)}x` : "—"} sub={revenue ? `${nairaFmt(revenue)} revenue` : null} icon={ICONS.TrendingUp} />
      </div>

      <Card pad={false} className="mb-6">
        <div className="px-5 py-4 border-b f-display text-base" style={{ borderColor: C.line, color: C.ink }}>Campaign Performance</div>
        <Table head={["Campaign", "Platform", "Budget", "Leads", "Orders", "Revenue", "ROAS", ""]} minWidth={820}
          empty={campaigns.length === 0 ? (canEdit ? "No campaigns yet — add one, then update leads, orders and revenue as results come in." : "No campaigns yet.") : null}>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t" style={{ borderColor: C.rowLine }}>
              <td className="px-5 py-3 f-body text-sm font-medium" style={{ color: C.ink }}>{c.name}</td>
              <td className="px-5 py-3 f-body text-xs" style={{ color: C.muted }}>{c.platform}</td>
              <td className="px-5 py-3 f-mono text-sm" style={{ color: C.ink }}>{nairaFmt(c.budget)}</td>
              <td className="px-5 py-3 f-mono text-sm" style={{ color: C.ink }}>{c.leads}</td>
              <td className="px-5 py-3 f-mono text-sm" style={{ color: C.ink }}>{c.orders}</td>
              <td className="px-5 py-3 f-mono text-sm font-semibold" style={{ color: C.burgundy }}>{nairaFmt(c.revenue)}</td>
              <td className="px-5 py-3 f-mono text-sm font-semibold" style={{ color: C.ok }}>{c.budget ? `${(c.revenue / c.budget).toFixed(2)}x` : "—"}</td>
              <td className="px-5 py-3">
                {canEdit && <div className="flex gap-1 justify-end">
                  <Btn small variant="ghost" icon={Pencil} onClick={() => setModal({ kind: "campaign", item: c })} />
                  <Btn small variant="ghost" icon={Trash2} onClick={() => setConfirm({ kind: "campaign", item: c })} />
                </div>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="f-display text-base flex items-center gap-2" style={{ color: C.ink }}><CalendarDays size={15} /> Content Calendar</h3>
          {canEdit && <Btn small icon={Plus} onClick={() => setModal({ kind: "post" })}>Add Post</Btn>}
        </div>
        {content.length === 0 && <Empty>Nothing planned. Add posts to plan the week's content and track approvals.</Empty>}
        {upcoming.length > 0 && <PostGrid posts={upcoming} canEdit={canEdit} onEdit={(p) => setModal({ kind: "post", item: p })} onDelete={(p) => setConfirm({ kind: "post", item: p })} today={today} />}
        {recent.length > 0 && (<>
          <div className="f-body text-[10px] uppercase tracking-widest mt-5 mb-2" style={{ color: C.muted }}>Last 14 days</div>
          <PostGrid posts={recent} canEdit={canEdit} onEdit={(p) => setModal({ kind: "post", item: p })} onDelete={(p) => setConfirm({ kind: "post", item: p })} today={today} />
        </>)}
      </Card>
    </div>
  );
}

function PostGrid({ posts, canEdit, onEdit, onDelete, today }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {posts.map((p) => (
        <div key={p.id} className="rounded-xl p-3" style={{ background: C.cream, outline: p.date === today ? `2px solid ${C.gold}` : "none" }}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="f-body text-[10px] uppercase tracking-wide" style={{ color: p.date === today ? C.gold : C.muted }}>{p.date === today ? "Today" : dayLabel(p.date)}</div>
            {canEdit && <div className="flex gap-1 -mt-1 -mr-1">
              <button aria-label="Edit post" onClick={() => onEdit(p)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white"><Pencil size={11} style={{ color: C.muted }} /></button>
              <button aria-label="Delete post" onClick={() => onDelete(p)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white"><Trash2 size={11} style={{ color: C.muted }} /></button>
            </div>}
          </div>
          <div className="f-body text-sm font-semibold mb-1" style={{ color: C.ink }}>{p.title}</div>
          <div className="f-body text-[11px] mb-2" style={{ color: C.muted }}>{p.type} · {p.platform}</div>
          <StatusPill status={p.status} />
        </div>
      ))}
    </div>
  );
}

function CampaignForm({ item, onClose, actions }) {
  const [f, setF] = useState({ name: item?.name ?? "", platform: item?.platform ?? "Instagram", budget: String(item?.budget ?? ""), leads: String(item?.leads ?? 0), orders: String(item?.orders ?? 0), revenue: String(item?.revenue ?? 0) });
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const nums = ["budget", "leads", "orders", "revenue"];
  const valid = f.name.trim().length >= 2 && f.platform.trim().length >= 2 && nums.every((k) => f[k] !== "" && Number.isInteger(Number(f[k])) && Number(f[k]) >= 0);
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { name: f.name.trim(), platform: f.platform.trim(), ...Object.fromEntries(nums.map((k) => [k, Number(f[k])])) };
      const r = item ? await actions.updateCampaign(item.id, body) : await actions.addCampaign(body);
      if (r) onClose();
    });
  };
  return (
    <Modal title={item ? `Edit ${item.name}` : "Add Campaign"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Campaign name"><Input value={f.name} onChange={set("name")} required maxLength={80} autoFocus placeholder="e.g. Sallah Ram & Beef Bundle" /></Field>
        <Field label="Platform">
          <Input list="mk-plat" value={f.platform} onChange={set("platform")} required maxLength={60} />
          <datalist id="mk-plat">{PLATFORMS.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Budget / spend (₦)"><Input mono type="number" min="0" step="1" value={f.budget} onChange={set("budget")} required /></Field>
          <Field label="Revenue (₦)"><Input mono type="number" min="0" step="1" value={f.revenue} onChange={set("revenue")} /></Field>
          <Field label="Leads"><Input mono type="number" min="0" step="1" value={f.leads} onChange={set("leads")} /></Field>
          <Field label="Orders"><Input mono type="number" min="0" step="1" value={f.orders} onChange={set("orders")} /></Field>
        </div>
        <p className="f-body text-xs" style={{ color: C.muted }}>Update leads, orders and revenue as results come in from each platform.</p>
        <Btn type="submit" icon={Check} full busy={busy} disabled={!valid}>{item ? "Save Changes" : "Add Campaign"}</Btn>
      </form>
    </Modal>
  );
}

function PostForm({ item, onClose, actions }) {
  const [f, setF] = useState({ date: item?.date ?? todayIso(), title: item?.title ?? "", type: item?.type ?? POST_TYPES[0], platform: item?.platform ?? "Instagram", status: item?.status ?? "Draft" });
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.date && f.title.trim().length >= 2 && f.type.trim().length >= 2 && f.platform.trim().length >= 2;
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, title: f.title.trim(), type: f.type.trim(), platform: f.platform.trim() };
      const r = item ? await actions.updatePost(item.id, body) : await actions.addPost(body);
      if (r) onClose();
    });
  };
  return (
    <Modal title={item ? "Edit Post" : "Add Post"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title"><Input value={f.title} onChange={set("title")} required maxLength={120} autoFocus placeholder="e.g. Weekend family meat box" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date"><Input type="date" value={f.date} onChange={set("date")} required /></Field>
          <Field label="Status"><Select value={f.status} onChange={set("status")}>{CONTENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Type">
            <Input list="post-types" value={f.type} onChange={set("type")} required maxLength={40} />
            <datalist id="post-types">{POST_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Platform">
            <Input list="post-plat" value={f.platform} onChange={set("platform")} required maxLength={40} />
            <datalist id="post-plat">{PLATFORMS.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
        </div>
        <Btn type="submit" icon={Check} full busy={busy} disabled={!valid}>{item ? "Save Changes" : "Add Post"}</Btn>
      </form>
    </Modal>
  );
}
