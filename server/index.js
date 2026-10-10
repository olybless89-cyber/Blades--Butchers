import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { bootstrap } from "./seed.js";
import { apiRouter } from "./routes.js";
import { errorHandler } from "./util.js";
import { startScheduler } from "./backup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Railway sits behind one proxy — needed for real client IPs and secure cookies.

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'self'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "object-src": ["'none'"],
      "worker-src": ["'self'"],
      "manifest-src": ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.set("Cache-Control", "no-store").json({ status: "ok", db: "ok", uptime: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

app.use("/api", apiRouter());

if (fs.existsSync(path.join(DIST, "index.html"))) {
  app.use("/assets", express.static(path.join(DIST, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  // The service worker and manifest must always be re-checked, or tills would keep running an old version.
  app.get(["/sw.js", "/manifest.webmanifest"], (req, res) => {
    res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" }).sendFile(path.join(DIST, req.path.slice(1)));
  });
  app.use(express.static(DIST, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => {
    res.set("Cache-Control", "no-cache").sendFile(path.join(DIST, "index.html"));
  });
} else {
  console.warn("dist/ not found — API only. Run `npm run build` to serve the app.");
}

app.use(errorHandler);

async function start() {
  await migrate();
  await bootstrap();
  const server = app.listen(PORT, "0.0.0.0", () => console.log(`BladeOS running on port ${PORT}`));
  startScheduler(); // daily off-site backup + monthly restore test (when BACKUP_* variables are set)
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
