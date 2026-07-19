/**
 * Servidor Express + API REST: alturas de ríos (PNA + DMH Paraguay).
 * Modo liviano: fetch + regex (sin Puppeteer/Chrome).
 *
 * SEGURIDAD aplicada:
 *  [1] helmet()           — headers HTTP seguros
 *  [2] express-rate-limit — límite de requests por IP
 *  [3] body limit         — previene payloads gigantes
 *  [4] server.timeout     — previene requests colgados
 *  [5] conn limit         — máx conexiones simultáneas
 *  [6] gracefulShutdown   — cierre ordenado de BD y servidor
 *  [7] BIND_HOST          — bind solo a localhost en dev
 *  [8] static headers     — X-Frame-Options, nosniff, etc.
 */

const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");                        // [1]
const rateLimit = require("express-rate-limit");         // [2]
const {
  initDb,
  maintenanceAlturas,
  maintenanceParaguay,
  saveUltimaExtraccionDelDia,
  saveSnapshot,
  getLatestSnapshot,
  initDbParaguay,
  saveParaguayExtraccion,
  getSeriesAlturas,
  getSeriesParaguay,
} = require("./db");
const {
  initDbPasos,
  createUser,
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  maintenancePasos,
  listPasos,
  createPaso,
  updatePaso,
  deletePaso,
  SESSION_TTL_MS,
} = require("./dbPasos");
const { parseRioParaguay } = require("./lib/paraguayConvencional");
const { parseFichAlturas } = require("./lib/fichHtmlParser");

const PARAGUAY_DMH_URL =
  "https://www.meteorologia.gov.py/nivel-rio/indexconvencional.php";

const app = express();

// ─── Trust proxy (detrás de CDN/Render) ───────────────────────────────────────
// Necesario para que express-rate-limit lea la IP real (X-Forwarded-For) y para
// que req.secure/protocolo sean correctos. TRUST_PROXY = nº de saltos de proxy
// (p. ej. "2" para Cloudflare → Render). En local queda desactivado.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set("trust proxy", /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}

// ─── [1] Headers de seguridad HTTP ───────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "'unsafe-inline'",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
      },
    },
    crossOriginEmbedderPolicy: false, // no interferir con fetch a APIs públicas
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const list = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length > 0) {
    if (origin && list.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// ─── [3] Límite de tamaño de body entrante ───────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ─── [2] Rate limiting ────────────────────────────────────────────────────────
// 60 req / min globales para cualquier ruta /api/*
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Demasiadas peticiones. Reintentá en un minuto." },
});
app.use("/api/", apiLimiter);

// 5 req / min para endpoints que disparan scraping externo.
// Las respuestas servidas desde caché fresca NO cuentan: no golpean la fuente.
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Límite de actualizaciones por minuto alcanzado." },
  skip: (req) => {
    if (wantsRefresh(req)) return false; // refresco forzado siempre cuenta
    try {
      const source = /paraguay/i.test(req.originalUrl) ? "paraguay" : "parana";
      // Solo memoria (sync): si no hay snap en RAM, no skipear.
      const snap = memSnapshots.get(source);
      return !!(snap && snapshotAgeMs(snap.scrapedAt) < CACHE_TTL_MS);
    } catch {
      return false;
    }
  },
});
app.use("/api/data", scrapeLimiter);
app.use("/api/rio-paraguay-dmh", scrapeLimiter);

// ─── Cache-Control para CDN / navegador ───────────────────────────────────────
// Clasifica las rutas /api: públicas cacheables vs. privadas (sesión/cookies).
// Un CDN (Cloudflare, etc.) respeta estas cabeceras y sirve desde el borde.
function apiCacheControl(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();

  // Rutas con sesión/cookies o cron: nunca cachear.
  if (
    req.path.startsWith("/api/auth") ||
    req.path.startsWith("/api/pasos") ||
    req.path.startsWith("/api/cron")
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return next();
  }

  // Endpoints públicos cacheables: solo GET sin refresco forzado.
  if (req.path === "/api/data" || req.path === "/api/rio-paraguay-dmh") {
    if (req.method === "GET" && !wantsRefresh(req)) {
      // s-maxage: caché del CDN; stale-while-revalidate: sirve viejo mientras
      // revalida; stale-if-error: sirve el último bueno si el origin falla.
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    return next();
  }

  // Resto de /api (health, etc.): no cachear.
  res.setHeader("Cache-Control", "no-store");
  next();
}
app.use(apiCacheControl);

// ─── Configuración de puertos ─────────────────────────────────────────────────
const BASE_PORT = Number(process.env.PORT) || 3000;
const PORT_TRY_LIMIT = 15;

const TARGET_URL = "http://wfich1.unl.edu.ar/cim/rios/parana/alturas";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
const FETCH_RETRIES = Math.max(1, Number(process.env.FETCH_RETRIES) || 2);

// ─── Caché de snapshots ───────────────────────────────────────────────────────
// TTL: si el último snapshot es más nuevo que esto, se sirve sin scrapear.
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 10 * 60 * 1000;

// Caché en memoria: evita leer SQLite en cada request (clave para alta concurrencia).
// El snapshot se carga de SQLite una sola vez por arranque y se refresca al scrapear.
const memSnapshots = new Map(); // source -> { scrapedAt, payload }

function snapshotAgeMs(scrapedAtIso) {
  const t = Date.parse(scrapedAtIso);
  return Number.isNaN(t) ? Infinity : Date.now() - t;
}

/** Devuelve el snapshot de una fuente desde memoria; si no está, lo carga de SQLite/Turso. */
async function getCachedSnapshot(source) {
  let snap = memSnapshots.get(source);
  if (!snap) {
    try {
      snap = await getLatestSnapshot(source);
    } catch (e) {
      console.warn(`[cache ${source}] lectura DB falló:`, e.message);
      snap = null;
    }
    if (snap) memSnapshots.set(source, snap);
  }
  return snap || null;
}

/** Actualiza la caché en memoria tras un scrapeo exitoso. */
function setCachedSnapshot(source, scrapedAt, payload) {
  memSnapshots.set(source, { scrapedAt, payload });
}

function wantsRefresh(req) {
  const v = req.query.refresh;
  return v === "1" || v === "true";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Fetch DMH Paraguay ──────────────────────────────────────────────────────
async function fetchRioParaguayDmh() {
  let res;
  try {
    res = await fetch(PARAGUAY_DMH_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-PY,es;q=0.9",
      },
    });
  } catch (err) {
    throw new Error(`DMH Paraguay: error de red – ${err.message}`, { cause: err });
  }
  if (!res.ok) {
    throw new Error(`DMH Paraguay: HTTP ${res.status}`);
  }

  // [8] Validar Content-Type antes de procesar
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("text/plain")) {
    throw new Error(`DMH Paraguay: Content-Type inesperado – ${ct}`);
  }

  let html;
  try {
    html = await res.text();
  } catch (err) {
    throw new Error(`DMH Paraguay: error leyendo cuerpo – ${err.message}`, { cause: err });
  }

  const items = parseRioParaguay(html);
  const warnings = [];
  if (!items.length) {
    warnings.push(
      "No se encontraron filas para Río Paraguay. ¿Cambió el HTML del sitio DMH?"
    );
  }
  return {
    source: PARAGUAY_DMH_URL,
    rio: "Río Paraguay",
    scrapedAt: new Date().toISOString(),
    count: items.length,
    items,
    warnings,
  };
}

// ─── Fetch FICH/UNL ──────────────────────────────────────────────────────────
async function fetchAlturasOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TARGET_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-AR,es;q=0.9",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`FICH HTTP ${res.status}`);

    // [8] Validar Content-Type
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) {
      throw new Error(`FICH: Content-Type inesperado – ${ct}`);
    }

    const html = await res.text();
    const items = parseFichAlturas(html);
    if (!items.length) {
      throw new Error("No se obtuvieron filas. ¿Cambió el HTML de FICH/UNL?");
    }
    return {
      source: TARGET_URL,
      scrapedAt: new Date().toISOString(),
      count: items.length,
      items,
      warnings: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAlturas() {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const data = await fetchAlturasOnce();
      if (attempt > 1) {
        data.warnings.push(`Recuperado en intento ${attempt}/${FETCH_RETRIES}.`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        await sleep(2000 * attempt);
      }
    }
  }
  throw lastError || new Error("No se pudo obtener datos de PNA.");
}

/** Scrapea Paraná, guarda extracciones + snapshot (Turso o SQLite). */
async function syncParanaToDb() {
  const SOURCE = "parana";
  const data = await fetchAlturas();
  let dbSaved = null;
  if (data.items && data.items.length > 0) {
    dbSaved = await saveUltimaExtraccionDelDia(data.items, data.scrapedAt);
  }
  try {
    await saveSnapshot(SOURCE, data.scrapedAt, data);
  } catch (snapErr) {
    console.warn("[cache parana] guardado falló:", snapErr.message);
  }
  setCachedSnapshot(SOURCE, data.scrapedAt, data);
  return {
    ok: true,
    count: (data.items && data.items.length) || 0,
    scrapedAt: data.scrapedAt,
    dbSaved,
    warnings: data.warnings || [],
  };
}

/** Scrapea Paraguay DMH y guarda en DB. */
async function syncParaguayToDb() {
  const SOURCE = "paraguay";
  const data = await fetchRioParaguayDmh();
  let dbSaved = null;
  if (data.items && data.items.length > 0) {
    dbSaved = await saveParaguayExtraccion(data.items, data.scrapedAt);
  }
  try {
    await saveSnapshot(SOURCE, data.scrapedAt, data);
  } catch (snapErr) {
    console.warn("[cache paraguay] guardado falló:", snapErr.message);
  }
  setCachedSnapshot(SOURCE, data.scrapedAt, data);
  return {
    ok: true,
    count: (data.items && data.items.length) || 0,
    scrapedAt: data.scrapedAt,
    dbSaved,
    warnings: data.warnings || [],
  };
}

function assertCronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: "CRON_SECRET no configurado" });
    return false;
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || String(req.query.secret || "");
  if (!token || token !== secret) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return false;
  }
  return true;
}

// ─── [8] Archivos estáticos con headers extra ────────────────────────────────
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
    },
  })
);

// ─── Inicializar DB (SQLite local o Turso) ────────────────────────────────────
const dbReady = Promise.all([initDb(), initDbParaguay(), initDbPasos()])
  .then(() => {
    console.log(
      `[db] backend=${process.env.TURSO_DATABASE_URL ? "turso" : "sqlite-file"}`
    );
  })
  .catch((e) => {
    console.warn("[db] No se pudo inicializar:", e.message);
  });

app.use(async (_req, _res, next) => {
  try {
    await dbReady;
  } catch {
    /* ya logueado */
  }
  next();
});

// ─── Mantenimiento periódico (solo proceso largo; no en Vercel serverless) ───
const IS_VERCEL = Boolean(process.env.VERCEL);
const MAINTENANCE_INTERVAL_MS =
  Number(process.env.MAINTENANCE_INTERVAL_MS) || 30 * 60 * 1000;

async function runDbMaintenance() {
  try {
    await maintenanceAlturas();
    await maintenanceParaguay();
    const r = await maintenancePasos();
    if (r && r.sessionsRemoved > 0) {
      console.log(`[mantenimiento] ${r.sessionsRemoved} sesiones vencidas purgadas.`);
    }
  } catch (e) {
    console.warn("[mantenimiento] falló:", e.message);
  }
}

if (!IS_VERCEL) {
  const maintenanceTimer = setInterval(() => {
    runDbMaintenance();
  }, MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref();
}

// ─── Rutas API ────────────────────────────────────────────────────────────────

/** Cron Vercel: scrapea fuentes oficiales y persiste en Turso/SQLite. */
app.get("/api/cron/sync", async (req, res) => {
  if (!assertCronAuth(req, res)) return;
  const startedAt = new Date().toISOString();
  const result = { ok: true, startedAt, backend: process.env.TURSO_DATABASE_URL ? "turso" : "sqlite-file" };
  try {
    result.parana = await syncParanaToDb();
  } catch (err) {
    console.error("[/api/cron/sync parana]", err);
    result.parana = { ok: false, error: err.message || String(err) };
    result.ok = false;
  }
  try {
    result.paraguay = await syncParaguayToDb();
  } catch (err) {
    console.error("[/api/cron/sync paraguay]", err);
    result.paraguay = { ok: false, error: err.message || String(err) };
    result.ok = false;
  }
  result.finishedAt = new Date().toISOString();
  res.status(result.ok ? 200 : 502).json(result);
});

app.get("/api/data", async (req, res) => {
  const SOURCE = "parana";

  // [1] Servir caché fresca (salvo que se pida ?refresh=1)
  if (!wantsRefresh(req)) {
    const snap = await getCachedSnapshot(SOURCE);
    if (snap && snapshotAgeMs(snap.scrapedAt) < CACHE_TTL_MS) {
      return res.json({
        ok: true,
        ...snap.payload,
        cached: true,
        cacheAgeMs: snapshotAgeMs(snap.scrapedAt),
      });
    }
  }

  // [2] Scrapeo en vivo
  try {
    const sync = await syncParanaToDb();
    const snap = memSnapshots.get(SOURCE);
    const data = (snap && snap.payload) || {};
    res.json({
      ok: true,
      ...data,
      dbSaved: sync.dbSaved,
      cached: false,
    });
  } catch (err) {
    console.error("[/api/data]", err);

    // [3] Fallback: último snapshot disponible aunque esté vencido
    try {
      const snap = await getCachedSnapshot(SOURCE);
      if (snap) {
        const ageMin = Math.round(snapshotAgeMs(snap.scrapedAt) / 60000);
        const payload = snap.payload || {};
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.slice()
          : [];
        warnings.push(
          `No se pudo actualizar desde la fuente (${err.message}). Mostrando datos cacheados de hace ~${ageMin} min.`
        );
        return res.json({
          ...payload,
          ok: true,
          warnings,
          cached: true,
          stale: true,
          cacheAgeMs: snapshotAgeMs(snap.scrapedAt),
        });
      }
    } catch (e) {
      console.warn("[cache parana] fallback falló:", e.message);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({
      ok: false,
      error: err.message || "Error interno al obtener datos",
      scrapedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/rio-paraguay-dmh", async (req, res) => {
  const SOURCE = "paraguay";

  // [1] Servir caché fresca (salvo que se pida ?refresh=1)
  if (!wantsRefresh(req)) {
    const snap = await getCachedSnapshot(SOURCE);
    if (snap && snapshotAgeMs(snap.scrapedAt) < CACHE_TTL_MS) {
      return res.json({
        ok: true,
        ...snap.payload,
        cached: true,
        cacheAgeMs: snapshotAgeMs(snap.scrapedAt),
      });
    }
  }

  // [2] Scrapeo en vivo
  try {
    const sync = await syncParaguayToDb();
    if (sync.dbSaved && sync.dbSaved.rowsSaved > 0) {
      console.log(`[db paraguay] ${sync.dbSaved.rowsSaved} filas en ${sync.dbSaved.dbPath}`);
    }
    const snap = memSnapshots.get(SOURCE);
    const data = (snap && snap.payload) || {};
    res.json({
      ok: true,
      ...data,
      dbSaved: sync.dbSaved,
      cached: false,
    });
  } catch (err) {
    console.error("[/api/rio-paraguay-dmh]", err);

    // [3] Fallback: último snapshot disponible aunque esté vencido
    try {
      const snap = await getCachedSnapshot(SOURCE);
      if (snap) {
        const ageMin = Math.round(snapshotAgeMs(snap.scrapedAt) / 60000);
        const payload = snap.payload || {};
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.slice()
          : [];
        warnings.push(
          `No se pudo actualizar desde la fuente (${err.message}). Mostrando datos cacheados de hace ~${ageMin} min.`
        );
        return res.json({
          ...payload,
          ok: true,
          warnings,
          cached: true,
          stale: true,
          cacheAgeMs: snapshotAgeMs(snap.scrapedAt),
        });
      }
    } catch (e) {
      console.warn("[cache paraguay] fallback falló:", e.message);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({
      ok: false,
      error: err.message || "Error al obtener datos DMH",
      scrapedAt: new Date().toISOString(),
    });
  }
});

// ─── Autenticación por sesión (cookie httpOnly) ───────────────────────────────
const SESSION_COOKIE = "pasos_session";

/** Parseo mínimo de cookies desde la cabecera (sin dependencias). */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/** Middleware: exige sesión válida y deja el usuario en req.user. */
async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const user = await getUserBySession(cookies[SESSION_COOKIE]);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Necesitás iniciar sesión." });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error("[auth]", err);
    res.status(500).json({ ok: false, error: "Error de autenticación." });
  }
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await createUser(username, password);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ ok: true, user: { username: user.username } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "No se pudo registrar." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await authenticate(username, password);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Usuario o contraseña incorrectos." });
    }
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { username: user.username } });
  } catch (err) {
    console.error("[login]", err);
    res.status(500).json({ ok: false, error: "Error al iniciar sesión." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    await deleteSession(cookies[SESSION_COOKIE]);
  } catch (err) {
    console.warn("[logout]", err.message);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const cookies = parseCookies(req);
  const user = await getUserBySession(cookies[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { username: user.username } });
});

// ─── CRUD: pasos / profundidades / alturas (por usuario autenticado) ──────────
app.get("/api/pasos", requireAuth, async (req, res) => {
  try {
    const items = await listPasos(req.user.id);
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error("[GET /api/pasos]", err);
    res.status(500).json({ ok: false, error: err.message || "Error al listar pasos" });
  }
});

app.post("/api/pasos", requireAuth, async (req, res) => {
  try {
    const item = await createPaso(req.user.id, req.body);
    res.status(201).json({ ok: true, item });
  } catch (err) {
    console.error("[POST /api/pasos]", err);
    res.status(400).json({ ok: false, error: err.message || "No se pudo crear el registro" });
  }
});

app.put("/api/pasos/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "ID inválido." });
  }
  try {
    const item = await updatePaso(id, req.user.id, req.body);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }
    res.json({ ok: true, item });
  } catch (err) {
    console.error("[PUT /api/pasos]", err);
    res.status(400).json({ ok: false, error: err.message || "No se pudo actualizar el registro" });
  }
});

app.delete("/api/pasos/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "ID inválido." });
  }
  try {
    const ok = await deletePaso(id, req.user.id);
    if (!ok) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error("[DELETE /api/pasos]", err);
    res.status(500).json({ ok: false, error: err.message || "No se pudo eliminar el registro" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "altura-rios-dashboard" });
});

/** Series temporales (sparklines): ?source=parana|paraguay&dias=14 */
app.get("/api/series", async (req, res) => {
  try {
    const source = String(req.query.source || "parana").toLowerCase();
    const dias = Math.max(1, Math.min(90, Number(req.query.dias) || 14));
    const series =
      source === "paraguay"
        ? await getSeriesParaguay(dias)
        : await getSeriesAlturas(dias);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ ok: true, source, dias, series });
  } catch (err) {
    console.error("[/api/series]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "No se pudieron leer las series",
    });
  }
});

// ─── Export app (Vercel serverless) / listen local ───────────────────────────
module.exports = app;

const IS_SERVERLESS = Boolean(process.env.VERCEL);

if (!IS_SERVERLESS) {
  const server = http.createServer(app);

  // ─── [4] Timeouts de servidor ────────────────────────────────────────────────
  server.timeout = 35_000;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  // ─── [5] Límite de conexiones simultáneas ────────────────────────────────────
  const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS) || 200;
  let connectionCount = 0;

  server.on("connection", (socket) => {
    connectionCount++;

    if (connectionCount > MAX_CONNECTIONS) {
      console.warn(
        `[security] Conexión rechazada: límite de ${MAX_CONNECTIONS} conexiones alcanzado`
      );
      socket.destroy();
      connectionCount--;
      return;
    }

    socket.setTimeout(30_000);
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => connectionCount--);
    socket.on("error", () => connectionCount--);
  });

  function gracefulShutdown(code = 1, reason = "desconocida") {
    console.log(`[shutdown] Razón: ${reason}. Cerrando servidor…`);
    server.close(() => {
      console.log("[shutdown] Servidor cerrado correctamente.");
      process.exit(code);
    });
    setTimeout(() => {
      console.error("[shutdown] Timeout forzado.");
      process.exit(code);
    }, 8000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown(0, "SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown(0, "SIGINT"));

  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err.message, err.stack);
    gracefulShutdown(1, "uncaughtException");
  });

  const BIND_HOST =
    process.env.BIND_HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

  function listenWithFallback(port, attemptsLeft) {
    if (attemptsLeft <= 0) {
      console.error(
        `No hay puerto libre entre ${BASE_PORT} y ${BASE_PORT + PORT_TRY_LIMIT - 1}.`
      );
      process.exit(1);
    }

    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`Puerto ${port} en uso, probando ${port + 1}…`);
        listenWithFallback(port + 1, attemptsLeft - 1);
      } else {
        console.error(err);
        process.exit(1);
      }
    });

    server.listen(port, BIND_HOST, () => {
      server.removeAllListeners("error");
      const addr = server.address();
      const p = addr && addr.port;
      console.log(`Servidor en http://${BIND_HOST}:${p}`);
      console.log(`API datos: http://${BIND_HOST}:${p}/api/data`);
      console.log(`Río Paraguay (DMH): http://${BIND_HOST}:${p}/paraguay.html`);
      console.log(`Conexiones máx: ${MAX_CONNECTIONS} | Timeout: ${server.timeout / 1000}s`);
    });
  }

  listenWithFallback(BASE_PORT, PORT_TRY_LIMIT);
}
