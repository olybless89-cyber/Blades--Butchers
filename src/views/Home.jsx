import React, { useEffect, useState } from "react";
import {
  Scissors, LogIn, ArrowRight, Download, Sprout, Factory, Warehouse, ShoppingCart, Truck, ClipboardCheck, Landmark,
  Thermometer, TrendingUp, Megaphone, ShieldCheck, Fingerprint, History, DatabaseBackup, Lock, UsersRound, WifiOff,
  Printer, ScanBarcode, Scale, Monitor, Beef, Receipt, Menu, X, RefreshCw,
} from "lucide-react";
import { C } from "../lib/theme.js";

/*
 * The BladeOS home page — what visitors see before signing in on an ordinary browser.
 * Tills and the installed app skip it and open straight on the sign-in screen.
 * It shows no business data: only what the system does, and the privacy notice the law asks for.
 */

const MODULES = [
  { icon: Sprout, title: "Ranch", text: "Every animal tagged and tracked — breed, weight, health checks and purchase cost, ready for processing when it's ready." },
  { icon: Factory, title: "Processing & yield", text: "Carcass to cuts with yield per animal, batch codes on every lot, and trim loss measured, not guessed." },
  { icon: Warehouse, title: "Inventory & cold chain", text: "Stock by location and lot, first-expiry-first-out, blind stock counts and cold-room temperature logs." },
  { icon: ShoppingCart, title: "Point of sale", text: "Fast, keyboard-and-scanner till with weighed items, split payments, held tickets, receipts and X/Z reports." },
  { icon: Truck, title: "Orders & delivery", text: "Phone, online and delivery orders from confirmation to doorstep, with cash bags tracked for each rider." },
  { icon: ClipboardCheck, title: "Purchasing", text: "Purchase orders, approval limits and three-way match: what was ordered, what arrived and what was invoiced." },
  { icon: Landmark, title: "Payments", text: "Transfers and card takings matched to bank and terminal statements, with differences sent for review." },
  { icon: Thermometer, title: "Food safety", text: "HACCP opening, closing and cleaning checklists, verified by a manager, with batch recall in one search." },
  { icon: TrendingUp, title: "Reports", text: "Live dashboard, margins, wastage by reason, till variances and an assistant that answers questions about the numbers." },
  { icon: Megaphone, title: "Marketing", text: "Plan, approve and schedule campaigns and posts, with customer records kept to what the business needs." },
];

const CONTROLS = [
  { icon: UsersRound, title: "Right person, right job", text: "Ten roles, 49 separate permissions. Cashiers sell, storekeepers receive, managers approve — nobody holds every key." },
  { icon: ShieldCheck, title: "Maker and checker", text: "Write-offs, stock corrections, refunds and discounts above the limit need a second person. Nobody approves their own request." },
  { icon: History, title: "A permanent audit trail", text: "Every sign-in, price change, approval and correction is recorded with who and when — and the record can't be edited or deleted." },
  { icon: Fingerprint, title: "Two-step sign-in", text: "Owners, directors and administrators confirm every sign-in with an authenticator app. Idle screens sign out on their own." },
  { icon: DatabaseBackup, title: "Encrypted off-site backups", text: "A full encrypted copy leaves the building every night, and a restore is test-run every month to prove it works." },
  { icon: Lock, title: "Your customers' data, protected", text: "Kept only for running the business, visible only to roles that need it, and erased on request." },
];

const HARDWARE = [
  { icon: Monitor, label: "Touch-screen terminal" },
  { icon: Printer, label: "80 mm receipt printer" },
  { icon: ScanBarcode, label: "Barcode scanner" },
  { icon: Scale, label: "Weighing scale & scale labels" },
  { icon: Receipt, label: "Cash drawer" },
  { icon: Monitor, label: "Customer display" },
];

const DAY = [
  ["06:30", "Opening checks", "Cold-room temperatures and the HACCP opening checklist, before a single cut is sold."],
  ["07:00", "Goods in", "Deliveries received against the purchase order; anything short or over is flagged on the spot."],
  ["08:00", "Doors open", "The till opens with a counted float. Weighed cuts, scanned packs and quick keys at the counter."],
  ["All day", "Orders go out", "Delivery orders packed, dispatched and paid, every rider's cash bag accounted for."],
  ["19:00", "Cash-up", "Blind count of the drawer, Z report printed, variances over the limit go to a manager."],
  ["02:00", "Night backup", "The day's records are encrypted and copied off-site automatically."],
];

const NAV_LINKS = [["#modules", "What's inside"], ["#controls", "Controls"], ["#offline", "Offline"], ["#privacy", "Privacy"]];

export function HomePage({ onSignIn }) {
  const [profile, setProfile] = useState(null);
  const [installable, setInstallable] = useState(!!window.__bladeosInstall);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    fetch("/api/public/profile").then((r) => (r.ok ? r.json() : null)).then(setProfile).catch(() => {});
    const on = () => setInstallable(!!window.__bladeosInstall);
    window.addEventListener("bladeos-installable", on);
    document.title = "BladeOS — Blades & Butchers";
    return () => window.removeEventListener("bladeos-installable", on);
  }, []);

  const name = profile?.name || "Blades & Butchers";
  const contact = [profile?.email, profile?.phone].filter(Boolean);

  return (
    <div className="min-h-screen f-body" style={{ background: C.cream, color: C.ink }} data-home>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:px-3 focus:py-2 focus:rounded-lg" style={{ background: "#fff", color: C.ink }}>Skip to content</a>

      {/* ---- top bar */}
      <header className="sticky top-0 z-40 border-b" style={{ background: "rgba(28,24,21,0.94)", borderColor: C.charcoal3, backdropFilter: "blur(8px)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <a href="#top" className="flex items-center gap-2.5 mr-auto" aria-label="BladeOS home">
            <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: C.burgundy }}><Scissors size={16} color="#fff" /></span>
            <span className="leading-tight">
              <span className="f-display text-base block" style={{ color: C.cream }}>BLADEOS</span>
              <span className="text-[10px] uppercase tracking-wide block" style={{ color: C.mutedLight }}>Blades & Butchers</span>
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-6 mr-4" aria-label="Sections">
            {NAV_LINKS.map(([href, label]) => <a key={href} href={href} className="text-sm hover:underline underline-offset-4" style={{ color: C.mutedLight }}>{label}</a>)}
          </nav>
          {installable && (
            <button onClick={() => window.__bladeosInstall?.()} className="hidden sm:flex items-center gap-1.5 text-sm font-semibold rounded-lg px-3 py-2" style={{ color: C.cream, border: `1px solid ${C.charcoal3}` }}>
              <Download size={15} /> Install app
            </button>
          )}
          <button onClick={onSignIn} className="flex items-center gap-1.5 text-sm font-semibold rounded-lg px-4 py-2" style={{ background: C.burgundy, color: "#fff" }}>
            <LogIn size={15} /> Sign in
          </button>
          <button onClick={() => setMenu(!menu)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} style={{ color: C.cream }}>
            {menu ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        {menu && (
          <nav className="md:hidden px-4 pb-4 flex flex-col gap-1" aria-label="Sections">
            {NAV_LINKS.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)} className="py-2 text-sm" style={{ color: C.cream }}>{label}</a>)}
            {installable && <button onClick={() => window.__bladeosInstall?.()} className="py-2 text-sm text-left flex items-center gap-1.5" style={{ color: C.goldLight }}><Download size={15} /> Install app</button>}
          </nav>
        )}
      </header>

      <main id="main">
        {/* ---- hero */}
        <section id="top" className="relative overflow-hidden" style={{ background: C.charcoal }}>
          <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: `repeating-linear-gradient(45deg, ${C.gold} 0, ${C.gold} 1px, transparent 1px, transparent 40px)` }} />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-4" style={{ color: C.goldLight }}>{name} · Operating system</p>
              <h1 className="f-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mb-5" style={{ color: C.cream }}>
                From ranch to retail.<br /><span style={{ color: C.goldLight }}>One digital system.</span>
              </h1>
              <p className="text-base sm:text-lg leading-relaxed mb-8 max-w-xl" style={{ color: C.mutedLight }}>
                BladeOS runs the whole of {name} on one live record — the animals on the ranch, the cutting room,
                the cold rooms, the shop counter and the delivery van. Every kilo is accounted for, every naira reconciled.
              </p>
              <div className="flex flex-wrap gap-3">
                <button onClick={onSignIn} className="flex items-center gap-2 font-semibold rounded-lg px-5 py-3" style={{ background: C.burgundy, color: "#fff" }}>
                  <LogIn size={16} /> Staff sign in
                </button>
                <a href="#modules" className="flex items-center gap-2 font-semibold rounded-lg px-5 py-3" style={{ color: C.cream, border: `1px solid ${C.charcoal3}` }}>
                  What's inside <ArrowRight size={16} />
                </a>
              </div>
            </div>
            <FlowCard />
          </div>
          <div className="relative border-t" style={{ borderColor: C.charcoal3 }}>
            <dl className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
              {[["10", "modules, one record"], ["49", "permission controls"], ["72 h", "of selling with no internet"], ["Nightly", "encrypted off-site backup"]].map(([n, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="f-display text-2xl sm:text-3xl" style={{ color: C.cream }}>{n}</dd>
                  <dd className="text-xs sm:text-sm" style={{ color: C.mutedLight }}>{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---- modules */}
        <Section id="modules" eyebrow="What's inside" title="Every part of the business, connected">
          <p className="max-w-2xl mb-10 text-base leading-relaxed" style={{ color: C.muted }}>
            A sale at the counter takes the kilos out of the display chiller, a delivery note puts them into the cold room,
            and the yield from yesterday's processing shows up in this morning's margin. No re-typing between spreadsheets.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {MODULES.map((m) => (
              <article key={m.title} className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
                <span className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: "#F3E4E6" }}><m.icon size={18} color={C.burgundy} /></span>
                <h3 className="font-semibold mb-1.5">{m.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{m.text}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* ---- a day */}
        <Section eyebrow="A day on BladeOS" title="From the first temperature check to the night backup" tint>
          <ol className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DAY.map(([t, h, d]) => (
              <li key={h} className="rounded-2xl p-5 flex gap-4" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
                <span className="f-mono text-sm font-semibold shrink-0 w-14" style={{ color: C.burgundy }}>{t}</span>
                <span>
                  <span className="font-semibold block mb-1">{h}</span>
                  <span className="text-sm leading-relaxed block" style={{ color: C.muted }}>{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---- controls */}
        <Section id="controls" eyebrow="Controls" title="Built the way auditors expect">
          <p className="max-w-2xl mb-10 text-base leading-relaxed" style={{ color: C.muted }}>
            Least privilege, segregation of duties and maker-checker approvals are switched on from day one —
            the same internal-control principles retailers and food businesses are audited against worldwide.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CONTROLS.map((m) => (
              <article key={m.title} className="rounded-2xl p-5 flex gap-4" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
                <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#F6EEDD" }}><m.icon size={18} color={C.gold} /></span>
                <span>
                  <h3 className="font-semibold mb-1.5">{m.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{m.text}</p>
                </span>
              </article>
            ))}
          </div>
        </Section>

        {/* ---- offline + hardware */}
        <section id="offline" className="scroll-mt-16" style={{ background: C.charcoal }}>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid lg:grid-cols-2 gap-12">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: C.goldLight }}>Works when the internet doesn't</p>
              <h2 className="f-display text-3xl sm:text-4xl mb-5" style={{ color: C.cream }}>The till keeps selling</h2>
              <ul className="space-y-4">
                {[
                  [Download, "Installs like an app", "BladeOS installs on the till, office PCs and phones with its own icon, and opens straight to sign-in."],
                  [WifiOff, "Sells offline", "When the line drops, sales, held tickets and food-safety checklists are saved on the till with their own receipt numbers."],
                  [RefreshCw, "Uploads itself", "When the internet returns, everything uploads in order, keeps the time it happened, and anything unusual is flagged for a manager."],
                  [Lock, "Stays safe", "Offline sign-in uses a personal PIN, and a till that's been offline too long stops and asks to reconnect."],
                ].map(([Icon, h, d]) => (
                  <li key={h} className="flex gap-3">
                    <Icon size={18} color={C.goldLight} className="shrink-0 mt-0.5" />
                    <span><span className="font-semibold block" style={{ color: C.cream }}>{h}</span><span className="text-sm leading-relaxed" style={{ color: C.mutedLight }}>{d}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: C.goldLight }}>At the counter</p>
              <h2 className="f-display text-3xl sm:text-4xl mb-5" style={{ color: C.cream }}>Ready for the shop floor</h2>
              <div className="grid grid-cols-2 gap-3">
                {HARDWARE.map((h) => (
                  <div key={h.label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: C.charcoal2, border: `1px solid ${C.charcoal3}` }}>
                    <h.icon size={18} color={C.goldLight} className="shrink-0" />
                    <span className="text-sm" style={{ color: C.cream }}>{h.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm mt-4 leading-relaxed" style={{ color: C.mutedLight }}>
                Receipts print with the business's tax number and VAT, scale labels scan straight into the basket,
                and the customer sees every line and their change on their own screen.
              </p>
            </div>
          </div>
        </section>

        {/* ---- staff access */}
        <Section eyebrow="For staff" title="Getting in" tint>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              ["New to the team?", "Your manager creates your account and gives you a temporary password. You choose your own the first time you sign in."],
              ["Forgot your password?", "Ask your administrator to reset it. For your security, passwords are never sent by email or text."],
              ["Lost your authenticator phone?", "Use one of your recovery codes, or ask the Owner to reset two-step sign-in for you."],
            ].map(([h, d]) => (
              <div key={h} className="rounded-2xl p-5" style={{ background: "#fff", border: `1px solid ${C.border}` }}>
                <h3 className="font-semibold mb-1.5">{h}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <button onClick={onSignIn} className="inline-flex items-center gap-2 font-semibold rounded-lg px-5 py-3" style={{ background: C.burgundy, color: "#fff" }}>
              <LogIn size={16} /> Sign in to BladeOS
            </button>
          </div>
        </Section>

        {/* ---- privacy */}
        <Section id="privacy" eyebrow="Privacy notice" title="How customer information is handled">
          <div className="grid lg:grid-cols-2 gap-x-10 gap-y-6 text-sm leading-relaxed max-w-5xl" style={{ color: C.ink }}>
            <PrivacyItem h="Who is responsible">
              {name}{profile?.address ? `, ${profile.address}` : ""}, is the data controller for information held in BladeOS,
              in line with the Nigeria Data Protection Act 2023.
            </PrivacyItem>
            <PrivacyItem h="What we keep">
              For customers: name, phone number, delivery area and what you bought. For staff: name, work email, role and a record of actions in the system.
              We do not store card numbers — card payments are taken on the bank's terminal.
            </PrivacyItem>
            <PrivacyItem h="Why">
              To take and deliver orders, issue receipts and refunds, trace a batch if food safety requires it, and keep the accounts the law requires.
              Marketing messages are only sent to customers who agree to them.
            </PrivacyItem>
            <PrivacyItem h="Who can see it">
              Only staff whose role needs it. Information is stored encrypted in transit and in backups, and is not sold or shared, except where the law requires.
            </PrivacyItem>
            <PrivacyItem h="How long">
              Sales and receipt records are kept for six years for tax purposes. Customer contact details are removed on request;
              the sale itself stays, without your name or number.
            </PrivacyItem>
            <PrivacyItem h="Your rights">
              You can ask to see, correct or delete your information, or to stop marketing messages
              {contact.length ? <> — contact <strong>{contact.join(" or ")}</strong></> : " — ask at the shop counter"}.
              You can also complain to the Nigeria Data Protection Commission.
            </PrivacyItem>
          </div>
        </Section>
      </main>

      <footer style={{ background: C.charcoal }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-4 sm:items-center justify-between text-xs" style={{ color: C.mutedLight }}>
          <div className="flex items-center gap-2"><Beef size={14} color={C.goldLight} /> <span>{name} · BladeOS</span></div>
          <div>{profile?.address && <span>{profile.address} · </span>}Built by Digital Web Oracle ICT, Abuja</div>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, eyebrow, title, tint, children }) {
  return (
    <section id={id} className="scroll-mt-16" style={{ background: tint ? C.cream2 : C.cream }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: C.burgundy }}>{eyebrow}</p>
        <h2 className="f-display text-3xl sm:text-4xl mb-5 max-w-3xl">{title}</h2>
        {children}
      </div>
    </section>
  );
}

const PrivacyItem = ({ h, children }) => (
  <div>
    <h3 className="font-semibold mb-1">{h}</h3>
    <p style={{ color: C.muted }}>{children}</p>
  </div>
);

/** The ranch-to-retail flow, drawn as a card. */
function FlowCard() {
  const steps = [
    [Sprout, "Ranch", "Tag BB-0412 · 412 kg"],
    [Factory, "Processing", "Batch PB-1024 · 61% yield"],
    [Thermometer, "Cold room", "2.8 °C · in range"],
    [ShoppingCart, "Counter", "1.5 kg prime beef sold"],
    [TrendingUp, "Dashboard", "Margin updated live"],
  ];
  return (
    <div className="rounded-2xl p-5 sm:p-6" style={{ background: C.charcoal2, border: `1px solid ${C.charcoal3}` }} aria-hidden="true">
      <div className="text-xs uppercase tracking-wide mb-4" style={{ color: C.mutedLight }}>One kilo, followed end to end</div>
      <ol className="relative">
        {steps.map(([Icon, h, d], i) => (
          <li key={h} className="flex items-center gap-4 relative pb-5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-5 top-10 bottom-0 w-px" style={{ background: C.charcoal3 }} />}
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative" style={{ background: i === 3 ? C.burgundy : C.charcoal3 }}>
              <Icon size={17} color={i === 3 ? "#fff" : C.goldLight} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold" style={{ color: C.cream }}>{h}</span>
              <span className="block text-xs f-mono truncate" style={{ color: C.mutedLight }}>{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
