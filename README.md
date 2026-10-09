# BladeOS — Blades & Butchers

Digital operations platform: ranch → processing → cold room → POS → delivery → reports.

**Stack:** React 18 + Vite + Tailwind (frontend) · Node 20+/Express (API) · PostgreSQL via `pg` with SQL migrations.
One Railway service serves both the API (`/api`) and the app.

## Deploy to Railway

1. Push this folder to GitHub. In Railway: **New Project → Deploy from GitHub repo**.
2. In the same project: **+ New → Database → PostgreSQL**.
3. On the BladeOS service → **Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | output of `openssl rand -hex 32` |
| `ADMIN_EMAIL` | the Owner's email |
| `ADMIN_PASSWORD` | 8+ characters — temporary: BladeOS makes the Owner choose a new one at first sign-in |
| `ADMIN_NAME` | e.g. `Jeffrey` |

Do **not** set `NODE_ENV` — the start script sets it, and setting it at build time skips Vite.

4. **Settings → Networking → Generate Domain.** On boot the server runs migrations,
   creates reference data and the Owner account, then listens. `/health` checks the database.

### First sign-in checklist
A new install has only the starting catalogue: 11 products, 6 storage locations and 2 ranches.
The dashboard shows a *Getting started* card that ticks these off:
1. Sign in — BladeOS asks the Owner to replace the temporary `ADMIN_PASSWORD`, then to turn on two-step sign-in
   (scan the QR code with Google Authenticator / Microsoft Authenticator / Authy) and save the 10 recovery codes.
2. *Business Setup*: check every price and cost, add products, rename locations and ranches to match the site.
3. *Suppliers*: add suppliers and any balance you already owe (as an invoice).
4. *Inventory → Receive / Adjust*: opening stock per location.
5. *Livestock → Add Animal*: the herd.
6. *Administration → Add User*: staff accounts. Each person gets a temporary password and must choose their own at first sign-in.

## Local development

```bash
cp .env.example .env        # fill in DATABASE_URL etc.
npm install
npm run dev:api             # API on :3000 (auto-restarts)
npm run dev                 # app on :5173, proxies /api
```
Scripts: `npm run db:migrate`, `npm run db:seed` (reference data + Owner).

## How it works

- **Auth:** email + password (bcrypt), 12-hour JWT in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Mutations must be JSON
  (CSRF guard). 10 failed logins per 15 min → locked out temporarily. Passwords are 10+ characters; any password set by
  someone else is temporary and must be replaced at first sign-in. Idle sessions sign out after 30 minutes (shared tills).
- **Roles & controls** (`src/shared/permissions.js`, enforced by the API, mirrored in the menu):
  - *Least privilege:* 10 roles; staff covering two jobs get extra roles on one account (leadership roles stand alone).
    Only an Owner can grant Owner, Managing Director or Administrator.
  - *Administrator is a system role:* staff accounts, locations/ranches, audit trail — no prices, money or sales.
  - *Cost visibility:* cost prices, stock value at cost and livestock purchase costs only reach Owner, MD and Operations Manager.
    Ranch staff register animals without a cost; management records it (flagged until done).
  - *Maker-checker* (`server/controls.js`): write-offs, count corrections and refunds are requests; a different manager
    approves on the **Approvals** screen. Nobody approves their own. Owner/MD post directly (recorded). Storekeepers can
    receive (with a delivery reference) and transfer stock, but never write off or correct it.
  - *Refunds:* item-level, with reason codes. Delivered orders can't be cancelled — only refunded. Food safety: returned meat
    is written off; only a same-day counter sale rung up in error goes back into stock. All revenue figures are net of refunds.
- **Operations controls** (`server/operations.js`):
  - *Two-step sign-in* (TOTP, `server/totp.js`): mandatory for Owner, MD and Administrator; optional for staff. Secrets are
    AES-256-GCM encrypted (key from `JWT_SECRET` — rotating it means re-enrolling). Codes can't be replayed; 10 single-use
    recovery codes. The Owner/Administrator resets a lost phone under *Staff Accounts*; break-glass for the last Owner:
    set `RESET_MFA_FOR=<email>`, redeploy, sign in, then remove the variable.
  - *Batches & use-by:* every unit of stock belongs to a lot (processing batch, supplier delivery). Sales take the counter
    first, then the earliest use-by date; expired stock can't be sold. *Trace Batch* lists where a batch is and every
    customer who bought it, with a recall CSV. Shelf life per product in Business Setup.
  - *Till cash-up:* sales need an open till (float counted in). Cash taken and cash refunds are tracked to the drawer.
    Closing is a blind count; a different manager signs off, with an explanation for any variance.
    Delivery Managers use the same flow as a cash bag for cash on delivery.
  - *Cold chain:* safe range per location; readings out of range need a corrective action; alerts for breaches and
    checks overdue by 12 hours.
  - *Blind stock counts:* managers schedule; the counter never sees system figures; differences become correction
    requests for approval.
  - *Approval limits* (Business Setup → Controls, Owner/MD): what an Operations Manager may approve for write-offs,
    refunds and till variances; above that, Owner or MD.
- **Stock** is held per product *per location*, broken down by lot. Every change writes a `stock_movements` row.
  Sales, transfers, adjustments, processing and cancellations run in transactions with row locks,
  and the database refuses negative stock — concurrent tills can't oversell.
  Cancelling or a rung-up-in-error refund puts stock back into the exact lots it came from.
- **Processing** only accepts animals marked *Ready for Processing*; outputs can't exceed live weight.
  Cattle cuts go to the beef SKUs; goat → Goat Meat; sheep → Ram Meat.
- **Dashboards, reports, notifications, ButcherAI** are computed from live data in Lagos time
  (`server/state.js`).
- **Business Setup** (Owner, MD, Administrator): products, storage locations and ranches. Nothing is deleted — items are *retired*,
  which hides them from pickers while history keeps them. A product retires once its stock is zero; a location once it's
  empty; a ranch once its animals are moved or processed. The 8 products that receive processing output can be renamed and
  repriced but not retired. A product's unit locks once stock has moved. The starting catalogue is created once,
  so renames and retirements survive redeploys.
- **Suppliers:** a ledger of invoices and payments per supplier (balance, invoiced and paid this year, last 10 entries).
  Operations Managers can add suppliers and record invoices; only Owner/MD/Administrator can record payments, and never more than is owed.
- **Marketing:** campaigns (spend, leads, orders, revenue → ROAS, feeding Reports and ButcherAI) and a dated content calendar.
- **POS counter:** locations ticked *POS sells first* (Business Setup → Storage Locations) are drawn from before any
  other location, so renaming the shop counter doesn't change where sales come from.
- **Audit trail** records sign-ins, sales, price changes, transfers, batches, order and user changes.

## Layout
```
server/   index.js · routes.js (writes) · controls.js (approvals, refunds) · operations.js (tills, temps, counts, trace, limits)
          state.js (reads/KPIs) · stock.js (lots, FEFO) · auth.js + totp.js (sign-in) · seed.js · migrate.js
migrations/  numbered .sql files, applied once each on boot
src/      App.jsx (shell) · views/ · components/ · lib/ · shared/permissions.js
```

## Operations
- **Backups:** enable Railway's Postgres backups, or run `pg_dump "$DATABASE_URL" > bladeos-$(date +%F).sql` on a schedule.
- **Schema changes:** add `migrations/002_*.sql`; it runs automatically on next deploy.
- **Forgotten password / lost phone:** an Owner/Administrator resets it under *Administration → Staff Accounts*
  (Administrators can't reset leadership accounts — only the Owner can).
- **Daily routine:** open tills with a float; log cold-room and freezer temperatures twice a day; close tills at end of
  day and sign off cash-ups; write off anything past its use-by date; run a blind count per location each week.
