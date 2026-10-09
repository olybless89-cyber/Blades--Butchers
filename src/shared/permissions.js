// Shared between server (enforcement) and client (navigation/visibility).
//
// Design principles (standard internal-control practice for retail and food businesses):
//   • Least privilege — each role gets only what its job needs.
//   • Segregation of duties — whoever handles goods or cash can't also approve losses or refunds
//     against them; system administration is kept apart from commercial authority.
//   • Maker-checker — write-offs, stock corrections and refunds are requested by one person and
//     approved by another. Nobody can approve their own request. Only Owner/MD post directly.

export const ROLES = [
  "Owner",
  "Managing Director",
  "Operations Manager",
  "Ranch Manager",
  "Production Manager",
  "Storekeeper",
  "Cashier",
  "Delivery Manager",
  "Marketing Manager",
  "Administrator",
];

/** Roles that can't be combined with others, and that only an Owner can grant. */
export const LEADERSHIP_ROLES = ["Owner", "Managing Director", "Administrator"];
/** Roles that can be held together on one account (e.g. Cashier + Storekeeper). */
export const COMBINABLE_ROLES = ROLES.filter((r) => !LEADERSHIP_ROLES.includes(r));

const EXEC = ["Owner", "Managing Director"];           // commercial authority
const MGMT = [...EXEC, "Operations Manager"];          // + day-to-day management

export const PERMISSIONS = {
  // Overview
  "dashboard.view":         MGMT,
  "reports.view":           MGMT,
  "ai.use":                 MGMT,
  "costs.view":             MGMT,   // cost prices, stock value at cost, livestock purchase cost, margins

  // Ranch & processing
  "ranch.view":             [...MGMT, "Ranch Manager", "Production Manager"],
  "ranch.edit":             [...MGMT, "Ranch Manager"],
  "processing.view":        [...MGMT, "Production Manager", "Ranch Manager", "Storekeeper"],
  "processing.edit":        [...MGMT, "Production Manager"],

  // Inventory
  "inventory.view":         [...MGMT, "Storekeeper", "Production Manager", "Cashier"],
  "stock.receive":          [...MGMT, "Storekeeper"],                  // goods received, with a delivery reference
  "stock.transfer":         [...MGMT, "Storekeeper"],
  "stock.adjust.request":   ["Operations Manager", "Storekeeper"],     // request a write-off / count correction
  "stock.adjust.approve":   MGMT,                                      // never your own request
  "stock.adjust.direct":    EXEC,                                      // post without a second approver
  "products.edit":          EXEC,                                      // products, prices, costs, shelf life
  "temps.record":           [...MGMT, "Storekeeper", "Production Manager"], // cold-chain readings
  "counts.schedule":        MGMT,                                      // schedule blind stock counts
  "counts.perform":         [...MGMT, "Storekeeper"],                  // count without seeing the system figure
  "trace.view":             MGMT,                                      // batch recall trace (shows customers)

  // Sales
  "pos.use":                [...MGMT, "Cashier"],
  "till.use":               [...MGMT, "Cashier", "Delivery Manager"],  // open/close own till or cash bag
  "till.review":            MGMT,                                      // sign off other people's cash-ups
  "orders.view":            [...MGMT, "Cashier", "Delivery Manager", "Marketing Manager"],
  "orders.edit":            [...MGMT, "Cashier", "Delivery Manager"],  // status, paid, cancel before delivery
  "refunds.request":        ["Operations Manager", "Cashier"],
  "refunds.approve":        MGMT,                                      // never your own request
  "refunds.direct":         EXEC,
  "customers.view":         [...MGMT, "Cashier", "Delivery Manager", "Marketing Manager"],
  "customers.edit":         [...MGMT, "Cashier", "Marketing Manager"],
  "delivery.view":          [...MGMT, "Delivery Manager"],

  // Procurement
  "procurement.view":       MGMT,
  "procurement.edit":       MGMT,     // suppliers and their invoices
  "payables.pay":           EXEC,     // the person recording invoices can't also pay them

  // Marketing
  "marketing.view":         [...EXEC, "Marketing Manager"],
  "marketing.edit":         [...EXEC, "Marketing Manager"],

  // System
  "setup.manage":           [...EXEC, "Administrator"],               // locations, ranches (products need products.edit)
  "users.manage":           ["Owner", "Administrator"],
  "audit.view":             [...EXEC, "Administrator"],
  "controls.manage":        EXEC,                                      // approval limits
};

/** `roles` may be one role or an array of roles; any of them granting `perm` is enough. */
export function can(roles, perm) {
  const list = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const allowed = PERMISSIONS[perm] || [];
  return list.some((r) => allowed.includes(r));
}

export const canAny = (roles, perms) => perms.some((p) => can(roles, p));

export const APPROVAL_PERMS = ["stock.adjust.request", "stock.adjust.approve", "stock.adjust.direct", "refunds.request", "refunds.approve", "refunds.direct", "till.review"];

// Which permission (or any of a list) unlocks each screen in the app. null = everyone.
export const ROUTE_PERMS = {
  dashboard: "dashboard.view",
  approvals: APPROVAL_PERMS,
  ranch: "ranch.view",
  processing: "processing.view",
  inventory: "inventory.view",
  pos: "pos.use",
  orders: "orders.view",
  customers: "customers.view",
  delivery: "delivery.view",
  procurement: "procurement.view",
  marketing: "marketing.view",
  reports: "reports.view",
  setup: "setup.manage",
  roadmap: null,
  admin: ["audit.view", "users.manage"],
};

export const routeAllowed = (roles, route) => {
  const p = ROUTE_PERMS[route];
  if (p === undefined) return false;
  if (p === null) return true;
  return Array.isArray(p) ? canAny(roles, p) : can(roles, p);
};

export const ORDER_FLOW = ["New", "Confirmed", "Processing", "Out for Delivery", "Delivered"];

// Processing batches write into these products, so they can be renamed and repriced but never retired.
export const PROCESSING_SKUS = ["PB-BEEF", "STEW-BEEF", "BL-BEEF", "MINCE-BEEF", "OTH-BEEF", "GOAT-MEAT", "RAM-MEAT", "KPOMO"];

export const CONTENT_STATUSES = ["Draft", "Pending Approval", "Approved", "Scheduled", "Published"];

// Reason codes keep write-offs and refunds analysable.
export const WASTAGE_REASONS = ["Spoilage / expired", "Trim loss", "Damaged packaging", "Temperature breach", "Theft / unexplained loss"];
export const CORRECTION_REASONS = ["Stock count variance", "Data entry error", "Unrecorded delivery"];
// Food safety: meat that has left the shop is never resold. Only goods that never left the counter go back into stock.
export const RESTOCK_REASON = "Rung up in error — goods never left the counter";
export const REFUND_REASONS = [RESTOCK_REASON, "Quality complaint", "Short weight / overcharged", "Wrong item supplied", "Late or failed delivery"];

export const PASSWORD_MIN = 10;

/** Two-step sign-in is mandatory for these roles. */
export const MFA_REQUIRED_ROLES = LEADERSHIP_ROLES;
export const EXPIRY_WARN_DAYS = 2;
