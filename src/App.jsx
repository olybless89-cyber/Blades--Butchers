import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Beef, Scissors, Warehouse, ShoppingCart, Users, Truck, Package, Megaphone, FileBarChart,
  Search, Bell, X, LogIn, Sparkles, ShieldCheck, Settings, ClipboardList, ClipboardCheck, Menu, LogOut, KeyRound, Loader2, RefreshCw,
} from "lucide-react";
import { api, setUnauthorizedHandler } from "./lib/api.js";
import { C, initials } from "./lib/theme.js";
import { can, routeAllowed, PASSWORD_MIN } from "./shared/permissions.js";
import { Btn, Toast, ICONS, Modal, Field, Input, useBusy } from "./components/ui.jsx";
import ButcherAI from "./components/ButcherAI.jsx";
import { Dashboard, ReportsView, RoadmapView } from "./views/Overview.jsx";
import { RanchView, ProcessingView } from "./views/Ranch.jsx";
import { InventoryView } from "./views/Inventory.jsx";
import { POSView, OrdersView, CustomersView, DeliveryView } from "./views/Sales.jsx";
import { AdminView } from "./views/Admin.jsx";
import { ProcurementView } from "./views/Procurement.jsx";
import { MarketingView } from "./views/Marketing.jsx";
import { SetupView } from "./views/Setup.jsx";
import { ApprovalsView } from "./views/Approvals.jsx";
import { MfaStep, MfaEnrol } from "./views/Security.jsx";

const NAV = [
  { section: "Overview", items: [
    { id: "dashboard", label: "Executive Dashboard", icon: LayoutDashboard },
    { id: "approvals", label: "Approvals", icon: ClipboardCheck },
  ] },
  { section: "Ranch", items: [{ id: "ranch", label: "Livestock", icon: Beef }] },
  { section: "Processing", items: [{ id: "processing", label: "Processing Batches", icon: Scissors }] },
  { section: "Inventory", items: [{ id: "inventory", label: "Inventory & Cold Room", icon: Warehouse }] },
  { section: "Sales", items: [
    { id: "pos", label: "POS", icon: ShoppingCart },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "customers", label: "Customers", icon: Users },
    { id: "delivery", label: "Delivery", icon: Truck },
  ] },
  { section: "Procurement", items: [{ id: "procurement", label: "Suppliers", icon: Package }] },
  { section: "Marketing", items: [{ id: "marketing", label: "Marketing & Content", icon: Megaphone }] },
  { section: "Reports", items: [{ id: "reports", label: "Management Reports", icon: FileBarChart }] },
  { section: "System", items: [
    { id: "setup", label: "Business Setup", icon: Settings },
    { id: "roadmap", label: "Roadmap", icon: Sparkles },
    { id: "admin", label: "Administration", icon: ShieldCheck },
  ] },
];

const allowed = (roles, id) => routeAllowed(roles, id);
const IDLE_MINUTES = 30; // shared tills and back-office PCs sign out when left unattended
// Where each role starts its day.
const HOME = { Cashier: "pos", Storekeeper: "inventory", "Ranch Manager": "ranch", "Production Manager": "processing", "Delivery Manager": "delivery", "Marketing Manager": "marketing", Administrator: "admin" };
const firstRoute = (user) => (HOME[user.role] && allowed(user.roles, HOME[user.role]) ? HOME[user.role]
  : NAV.flatMap((s) => s.items).find((i) => i.id !== "roadmap" && allowed(user.roles, i.id))?.id ?? "roadmap");

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking session
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || null);
  const [toast, setToast] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [reportTab, setReportTab] = useState(null);

  const notify = useCallback((message, kind = "ok") => setToast({ message, kind, at: Date.now() }), []);

  const refresh = useCallback(async () => {
    try {
      const s = await api("/state");
      setData(s);
      setLoadError(null);
    } catch (e) {
      if (e.status !== 401) setLoadError(e.message);
    }
  }, []);

  // Session check on load; any 401 later sends the user back to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setData(null); });
    api("/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => { if (user && !user.mustChangePassword && !user.mfaSetupRequired) refresh(); }, [user, refresh]);

  // Idle sign-out.
  useEffect(() => {
    if (!user) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ["mousedown", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - last > IDLE_MINUTES * 60000) {
        await api("/auth/logout", { method: "POST" }).catch(() => {});
        setUser(null); setData(null); setRoute(null);
        setToast({ message: `Signed out after ${IDLE_MINUTES} minutes of inactivity.`, kind: "ok", at: Date.now() });
      }
    }, 30000);
    return () => { clearInterval(t); evs.forEach((e) => window.removeEventListener(e, bump)); };
  }, [user]);

  // Keep figures fresh across tills and screens.
  useEffect(() => {
    if (!user) return;
    if (!user || user.mustChangePassword || user.mfaSetupRequired) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
    return () => clearInterval(t);
  }, [user, refresh]);

  // Route guard + deep-linkable hash
  useEffect(() => {
    if (!user) return;
    if (!route || !allowed(user.roles, route)) setRoute(firstRoute(user));
  }, [user, route]);
  useEffect(() => { if (route) window.history.replaceState(null, "", `#${route}`); }, [route]);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || null);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goTo = (r) => { setRoute(r); setMobileNavOpen(false); window.scrollTo(0, 0); };

  /** Run an API call, toast the result, refresh data. Returns the response, or null on failure. */
  const act = useCallback(async (fn, success) => {
    try {
      const res = await fn();
      if (success) notify(typeof success === "function" ? success(res) : success);
      await refresh();
      return res ?? true;
    } catch (e) {
      notify(e.message, "error");
      return null;
    }
  }, [notify, refresh]);

  const actions = {
    addAnimal: (body) => act(() => api("/livestock", { method: "POST", body }), (r) => `${r.code} added to the livestock register`),
    updateAnimal: (code, body) => act(() => api(`/livestock/${encodeURIComponent(code)}`, { method: "PATCH", body }), `${code} updated`),
    processBatch: (body) => act(() => api("/processing", { method: "POST", body }), (r) => `Batch ${r.code} completed — ${r.yield}% yield, ${r.saleable} KG added to inventory`),
    transfer: (body) => act(() => api("/inventory/transfer", { method: "POST", body }), (r) => `${body.qty} of ${r.name} moved to ${body.to}`),
    adjust: (body) => act(() => api("/inventory/adjust", { method: "POST", body }),
      (r) => r.status === "Pending" ? `${r.code} sent for approval — stock changes once a manager approves` : r.code ? `${r.code} posted — ${r.name} updated` : `${r.name} received`),
    addProduct: (body) => act(() => api("/products", { method: "POST", body }), (r) => `${r.name} added (${r.sku})`),
    updateProduct: (sku, body, msg = "Product updated") => act(() => api(`/products/${encodeURIComponent(sku)}`, { method: "PATCH", body }), msg),
    addLocation: (body) => act(() => api("/locations", { method: "POST", body }), (r) => `${r.name} added`),
    updateLocation: (id, body, msg) => act(() => api(`/locations/${id}`, { method: "PATCH", body }), msg),
    addRanch: (body) => act(() => api("/ranches", { method: "POST", body }), (r) => `${r.name} added`),
    updateRanch: (id, body, msg) => act(() => api(`/ranches/${id}`, { method: "PATCH", body }), msg),
    sell: (body) => act(() => api("/sales", { method: "POST", body }), (r) => `Sale ${r.code} completed — ₦${r.total.toLocaleString("en-NG")}`),
    updateOrder: (code, body) => act(() => api(`/orders/${encodeURIComponent(code)}`, { method: "PATCH", body }), `${code} updated`),
    getOrder: (code) => api(`/orders/${encodeURIComponent(code)}`),
    addCustomer: (body) => act(() => api("/customers", { method: "POST", body }), (r) => `${r.name} added`),
    addSupplier: (body) => act(() => api("/suppliers", { method: "POST", body }), (r) => `${r.name} added`),
    updateSupplier: (id, body, msg = "Supplier updated") => act(() => api(`/suppliers/${id}`, { method: "PATCH", body }), msg),
    supplierEntry: (id, body, msg) => act(() => api(`/suppliers/${id}/entries`, { method: "POST", body }), msg),
    addCampaign: (body) => act(() => api("/campaigns", { method: "POST", body }), (r) => `${r.name} added`),
    updateCampaign: (id, body) => act(() => api(`/campaigns/${id}`, { method: "PATCH", body }), "Campaign updated"),
    deleteCampaign: (id, name) => act(() => api(`/campaigns/${id}`, { method: "DELETE" }), `${name} deleted`),
    addPost: (body) => act(() => api("/content", { method: "POST", body }), "Post added to the calendar"),
    updatePost: (id, body) => act(() => api(`/content/${id}`, { method: "PATCH", body }), "Post updated"),
    deletePost: (id) => act(() => api(`/content/${id}`, { method: "DELETE" }), "Post deleted"),
    requestRefund: (body) => act(() => api("/refunds", { method: "POST", body }),
      (r) => r.status === "Approved" ? `Refund ${r.code} issued — ₦${r.amount.toLocaleString("en-NG")}` : `Refund ${r.code} sent for approval — ₦${r.amount.toLocaleString("en-NG")}`),
    decide: (kind, code, decision, note) => act(() => api(`/approvals/${kind}/${encodeURIComponent(code)}`, { method: "POST", body: { decision, note } }),
      (r) => `${r.code} ${r.status.toLowerCase()}`),
    openTill: (float) => act(() => api("/till/open", { method: "POST", body: { float } }), (r) => `Till ${r.code} open`),
    closeTill: (body) => act(() => api("/till/close", { method: "POST", body }), null),
    reviewTill: (code, note) => act(() => api(`/till/${encodeURIComponent(code)}/review`, { method: "POST", body: { note } }), `${code} signed off`),
    logTemp: (body) => act(() => api("/temperatures", { method: "POST", body }), (r) => r.inRange ? `${r.location}: ${r.reading}°C logged` : `${r.location}: ${r.reading}°C logged as a breach`),
    scheduleCount: (body) => act(() => api("/counts", { method: "POST", body }), (r) => `Stock count ${r.code} scheduled`),
    getCount: (code) => api(`/counts/${encodeURIComponent(code)}`),
    submitCount: (code, lines) => act(() => api(`/counts/${encodeURIComponent(code)}/submit`, { method: "POST", body: { lines } }),
      (r) => r.variances ? `${r.code} submitted — ${r.variances} difference${r.variances === 1 ? "" : "s"} sent for approval` : `${r.code} submitted — everything matched`),
    cancelCount: (code) => act(() => api(`/counts/${encodeURIComponent(code)}/cancel`, { method: "POST" }), `${code} cancelled`),
    trace: (lot) => api(`/trace/${encodeURIComponent(lot)}`),
    saveLimits: (body) => act(() => api("/settings/limits", { method: "PATCH", body }), "Approval limits saved"),
    createUser: (body) => act(() => api("/users", { method: "POST", body }), (r) => `${r.name} can now sign in`),
    updateUser: (id, body) => act(() => api(`/users/${id}`, { method: "PATCH", body }), "User updated"),
    notify,
    refresh,
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null); setData(null); setRoute(null);
  };

  if (user === undefined) return <Splash />;
  if (!user) return (<>{toast && <Toast toast={toast} onDone={() => setToast(null)} />}<LoginScreen onLogin={(u) => { setUser(u); setRoute(null); }} /></>);
  if (!user.mustChangePassword && user.mfaSetupRequired) return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: C.charcoal }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: "#fff" }}>
        <MfaEnrol required onDone={() => { setUser({ ...user, mfaSetupRequired: false, mfaEnabled: true }); notify("Two-step sign-in is on"); }} />
        <button onClick={logout} className="f-body text-xs mt-4 w-full text-center hover:underline" style={{ color: C.muted }}>Sign out</button>
      </div>
    </div>
  );
  if (user.mustChangePassword) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.charcoal }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: "#fff" }}>
        <h1 className="f-display text-xl mb-1" style={{ color: C.ink }}>Choose your own password</h1>
        <p className="f-body text-sm mb-5" style={{ color: C.muted }}>You signed in with a temporary password. Set a private one of at least {PASSWORD_MIN} characters to continue.</p>
        <PasswordForm onDone={() => { setUser({ ...user, mustChangePassword: false }); notify(user.mfaSetupRequired ? "Password set — now turn on two-step sign-in" : "Password set — welcome to BladeOS"); }} />
        <button onClick={logout} className="f-body text-xs mt-4 w-full text-center hover:underline" style={{ color: C.muted }}>Sign out</button>
      </div>
    </div>
  );
  if (!data) return <Splash error={loadError} onRetry={refresh} onLogout={logout} />;

  const permit = (p) => can(user.roles, p);

  return (
    <div className="f-body min-h-screen flex" style={{ background: C.cream }}>
      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
      {aiOpen && data.insights && <ButcherAI insights={data.insights} onClose={() => setAiOpen(false)} />}
      {mfaOpen && (
        <Modal title="Two-step sign-in" onClose={() => setMfaOpen(false)}>
          <MfaEnrol onCancel={() => setMfaOpen(false)} onDone={() => { setMfaOpen(false); setUser({ ...user, mfaEnabled: true }); notify("Two-step sign-in is on"); }} />
        </Modal>
      )}
      {pwOpen && (
        <Modal title="Change Password" onClose={() => setPwOpen(false)}>
          <PasswordForm onDone={() => { notify("Password changed"); setPwOpen(false); }} />
        </Modal>
      )}
      {reportTab && (
        <Modal title="Report Center" onClose={() => setReportTab(null)} wide>
          <ReportsView data={data} initialTab={reportTab} notify={notify} />
        </Modal>
      )}

      <Sidebar route={route} setRoute={goTo} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} user={user} onLogout={logout}
        badges={{ approvals: (data.approvals ? [...data.approvals.adjustments.filter(() => data.approvals.canApproveStock), ...data.approvals.refunds.filter(() => data.approvals.canApproveRefunds)].filter((x) => x.status === "Pending" && !x.mine).length : 0)
          + (data.tills?.review || []).filter((t) => t.status === "Closed" && !t.mine).length }} />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          notifications={data.notifications} canAI={permit("ai.use")} setAiOpen={setAiOpen}
          onMenuClick={() => setMobileNavOpen(true)} onNavigate={goTo} user={user}
          onPassword={() => setPwOpen(true)} onMfa={() => setMfaOpen(true)} onLogout={logout} onRefresh={refresh} loadError={loadError}
        />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {route === "dashboard" && <Dashboard data={data} onOpenReport={setReportTab} onNavigate={goTo} />}
          {route === "approvals" && <ApprovalsView data={data} actions={actions} permit={permit} />}
          {route === "ranch" && <RanchView data={data} actions={actions} permit={permit} />}
          {route === "processing" && <ProcessingView data={data} actions={actions} permit={permit} />}
          {route === "inventory" && <InventoryView data={data} actions={actions} permit={permit} />}
          {route === "pos" && <POSView data={data} actions={actions} permit={permit} />}
          {route === "orders" && <OrdersView data={data} actions={actions} permit={permit} />}
          {route === "customers" && <CustomersView data={data} actions={actions} permit={permit} />}
          {route === "delivery" && <DeliveryView data={data} actions={actions} permit={permit} />}
          {route === "procurement" && <ProcurementView data={data} actions={actions} permit={permit} />}
          {route === "marketing" && <MarketingView data={data} actions={actions} permit={permit} />}
          {route === "reports" && <ReportsView data={data} notify={notify} />}
          {route === "setup" && <SetupView data={data} actions={actions} permit={permit} />}
          {route === "roadmap" && <RoadmapView />}
          {route === "admin" && <AdminView data={data} actions={actions} permit={permit} user={user} />}
        </main>
      </div>
    </div>
  );
}

/* ============================================================ splash / login */
function Splash({ error, onRetry, onLogout }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: C.cream }}>
      <div className="text-center">
        {error ? (
          <>
            <p className="f-body text-sm mb-4" style={{ color: C.danger }}>{error}</p>
            <div className="flex gap-2 justify-center">
              <Btn icon={RefreshCw} onClick={onRetry}>Try again</Btn>
              <Btn variant="ghost" onClick={onLogout}>Sign out</Btn>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 f-body text-sm" style={{ color: C.muted }}>
            <Loader2 size={16} className="animate-spin" /> Loading BladeOS…
          </div>
        )}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [busy, run] = useBusy();

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    run(async () => {
      try {
        const r = await api("/auth/login", { method: "POST", body: { email, password } });
        if (r.mfaRequired) { setTicket(r.ticket); setPassword(""); return; }
        onLogin(r.user);
      } catch (err) {
        setError(err.message);
      }
    });
  };

  const inputStyle = { background: C.charcoal, color: C.cream, border: `1px solid ${C.charcoal3}` };
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: C.charcoal }}>
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: `repeating-linear-gradient(45deg, ${C.gold} 0, ${C.gold} 1px, transparent 1px, transparent 40px)` }} />
      <div className="relative z-10 w-full max-w-md px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: C.burgundy }}>
              <Scissors size={20} color="#fff" />
            </div>
            <span className="f-display text-2xl tracking-wide" style={{ color: C.cream }}>BLADEOS</span>
          </div>
          <h1 className="f-display text-3xl mb-2" style={{ color: C.cream }}>Blades & Butchers</h1>
          <p className="f-body text-sm" style={{ color: C.mutedLight }}>Digital Operations Platform</p>
          <p className="f-display italic text-base mt-4" style={{ color: C.goldLight }}>"From Ranch to Retail. One Digital System."</p>
        </div>

        {ticket ? <MfaStep ticket={ticket} onDone={onLogin} onBack={() => setTicket(null)} /> : (
        <form onSubmit={submit} className="rounded-2xl p-6" style={{ background: C.charcoal2, border: `1px solid ${C.charcoal3}` }}>
          <label className="f-body text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: C.mutedLight }} htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 rounded-lg px-3.5 py-2.5 f-body text-sm outline-none focus:ring-2" style={{ ...inputStyle, "--tw-ring-color": C.gold }} />
          <label className="f-body text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: C.mutedLight }} htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-5 rounded-lg px-3.5 py-2.5 f-body text-sm outline-none focus:ring-2" style={{ ...inputStyle, "--tw-ring-color": C.gold }} />
          {error && <div className="f-body text-xs mb-4 rounded-lg px-3 py-2" style={{ background: "#3A1E20", color: "#F2B8B5" }}>{error}</div>}
          <button type="submit" disabled={busy} className="w-full f-body font-semibold rounded-lg py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: C.burgundy, color: "#fff" }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />} Sign In
          </button>
          <p className="f-body text-xs text-center mt-4" style={{ color: C.muted }}>Forgot your password? Ask your administrator to reset it.</p>
        </form>)}
        <p className="f-body text-center text-xs mt-6" style={{ color: C.muted }}>Digital Web Oracle ICT · Abuja, Nigeria</p>
      </div>
    </div>
  );
}

function PasswordForm({ onDone }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, run] = useBusy();
  const mismatch = confirm && next !== confirm;
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await api("/auth/password", { method: "POST", body: { current, next } });
        onDone();
      } catch (err) { setError(err.message); }
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
      <Field label="New password" hint={`At least ${PASSWORD_MIN} characters. A short phrase is easier to remember than random symbols.`}><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={PASSWORD_MIN} /></Field>
      <Field label="Confirm new password" error={mismatch ? "Passwords don't match" : null}><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
      {error && <div className="f-body text-xs" style={{ color: C.danger }}>{error}</div>}
      <Btn type="submit" icon={KeyRound} full busy={busy} disabled={!current || next.length < PASSWORD_MIN || next !== confirm || next === current}>Save Password</Btn>
    </form>
  );
}

/* ============================================================ sidebar + topbar */
function Sidebar({ route, setRoute, mobileOpen, onClose, user, onLogout, badges = {} }) {
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => allowed(user.roles, i.id)) })).filter((s) => s.items.length);
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-[65] lg:hidden" style={{ background: "rgba(28,24,21,0.55)" }} onClick={onClose} />}
      <aside
        className={`w-72 sm:w-64 shrink-0 flex flex-col h-screen fixed lg:sticky top-0 inset-y-0 left-0 z-[70] lg:z-auto transition-transform duration-200 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        style={{ background: C.charcoal }}
      >
        <div className="px-5 py-5 flex items-center gap-2.5 border-b shrink-0" style={{ borderColor: C.charcoal3 }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: C.burgundy }}>
            <Scissors size={16} color="#fff" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="f-display text-base leading-tight" style={{ color: C.cream }}>BLADEOS</div>
            <div className="f-body text-[10px] uppercase tracking-wide truncate" style={{ color: C.mutedLight }}>Blades & Butchers</div>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="lg:hidden w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all shrink-0">
            <X size={15} color={C.mutedLight} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {sections.map((sec) => (
            <div key={sec.section} className="mb-4">
              <div className="f-body text-[10px] font-semibold uppercase tracking-widest px-3 mb-1.5" style={{ color: C.muted }}>{sec.section}</div>
              {sec.items.map((it) => {
                const active = route === it.id;
                return (
                  <button key={it.id} onClick={() => setRoute(it.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 f-body text-sm transition-all duration-150 hover:bg-white/5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1"
                    style={{ background: active ? C.burgundy : "transparent", color: active ? "#fff" : C.mutedLight, "--tw-ring-color": C.gold }}>
                    <it.icon size={15} className="shrink-0" />
                    <span className="truncate flex-1 text-left">{it.label}</span>
                    {badges[it.id] > 0 && <span className="f-mono text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center" style={{ background: C.gold, color: "#fff" }}>{badges[it.id]}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-4 py-4 border-t shrink-0" style={{ borderColor: C.charcoal3 }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center f-mono text-xs font-semibold shrink-0" style={{ background: C.gold, color: "#fff" }}>{initials(user.name)}</div>
            <div className="min-w-0 flex-1">
              <div className="f-body text-xs font-semibold truncate" style={{ color: C.cream }}>{user.name}</div>
              <div className="f-body text-[10px] truncate" style={{ color: C.mutedLight }} title={user.roles.join(" + ")}>{user.roles.join(" + ")}</div>
            </div>
            <button onClick={onLogout} aria-label="Sign out" title="Sign out" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all shrink-0">
              <LogOut size={15} color={C.mutedLight} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

const TONE = { warn: C.warn, gold: C.gold, burgundy: C.burgundy, danger: C.danger, muted: C.muted, ok: C.ok };

function TopBar({ notifications = [], canAI, setAiOpen, onMenuClick, onNavigate, user, onPassword, onMfa, onLogout, onRefresh, loadError }) {
  const [open, setOpen] = useState(null); // "notif" | "user" | null
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <header className="h-16 shrink-0 flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-5 lg:px-8 border-b sticky top-0 z-30" style={{ borderColor: C.border, background: "#fff" }}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button onClick={onMenuClick} aria-label="Open menu" className="lg:hidden w-9 h-9 shrink-0 rounded-lg flex items-center justify-center hover:bg-stone-100 active:scale-95 transition-all">
          <Menu size={18} style={{ color: C.ink }} />
        </button>
        {loadError && <span className="f-body text-xs truncate" style={{ color: C.danger }}>Offline — showing last loaded data</span>}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 relative shrink-0" ref={ref}>
        <button onClick={onRefresh} aria-label="Refresh data" title="Refresh" className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-stone-100 active:scale-95 transition-all">
          <RefreshCw size={15} style={{ color: C.muted }} />
        </button>
        {canAI && <Btn variant="gold" icon={Sparkles} small onClick={() => setAiOpen(true)}><span className="hidden sm:inline">ButcherAI</span></Btn>}
        <button onClick={() => setOpen(open === "notif" ? null : "notif")} aria-label="Notifications" className="relative w-9 h-9 rounded-lg flex items-center justify-center hover:bg-stone-100 active:scale-95 transition-all">
          <Bell size={16} style={{ color: C.ink }} />
          {notifications.length > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full f-mono text-[9px] font-bold flex items-center justify-center" style={{ background: C.danger, color: "#fff" }}>{notifications.length}</span>}
        </button>
        <button onClick={() => setOpen(open === "user" ? null : "user")} aria-label="Account" className="w-9 h-9 rounded-full flex items-center justify-center f-mono text-xs font-semibold active:scale-95 transition-all" style={{ background: C.gold, color: "#fff" }}>
          {initials(user.name)}
        </button>

        {open === "notif" && (
          <div className="absolute right-0 top-11 w-[calc(100vw-1.5rem)] max-w-96 rounded-xl shadow-2xl z-40 overflow-hidden" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
            <div className="px-4 py-3 border-b f-body text-sm font-semibold" style={{ borderColor: C.line, color: C.ink }}>Notifications</div>
            {notifications.length === 0 && <div className="px-4 py-6 f-body text-xs text-center" style={{ color: C.muted }}>All clear — nothing needs attention.</div>}
            {notifications.map((n, i) => {
              const Icon = ICONS[n.icon] || Bell;
              return (
                <button key={i} onClick={() => { onNavigate(n.route); setOpen(null); }}
                  className="w-full text-left flex gap-3 px-4 py-3 border-b last:border-0 hover:bg-stone-50 transition-colors" style={{ borderColor: C.rowLine }}>
                  <Icon size={15} style={{ color: TONE[n.tone] || C.muted, marginTop: 2, flexShrink: 0 }} />
                  <span className="f-body text-xs" style={{ color: C.ink }}>{n.text}</span>
                </button>
              );
            })}
          </div>
        )}
        {open === "user" && (
          <div className="absolute right-0 top-11 w-60 rounded-xl shadow-2xl z-40 overflow-hidden" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: C.line }}>
              <div className="f-body text-sm font-semibold truncate" style={{ color: C.ink }}>{user.name}</div>
              <div className="f-body text-xs truncate" style={{ color: C.muted }}>{user.email}</div>
              <div className="f-body text-[10px] uppercase tracking-wide mt-1" style={{ color: C.gold }}>{user.roles.join(" + ")}</div>
            </div>
            <button onClick={() => { setOpen(null); onPassword(); }} className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 f-body text-sm hover:bg-stone-50" style={{ color: C.ink }}>
              <KeyRound size={14} /> Change password
            </button>
            {!user.mfaEnabled && (
              <button onClick={() => { setOpen(null); onMfa(); }} className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 f-body text-sm hover:bg-stone-50" style={{ color: C.ink }}>
                <ShieldCheck size={14} /> Turn on two-step sign-in
              </button>
            )}
            <button onClick={onLogout} className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 f-body text-sm hover:bg-stone-50" style={{ color: C.danger }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
