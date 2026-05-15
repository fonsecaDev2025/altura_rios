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
  saveUltimaExtraccionDelDia,
  initDbParaguay,
  saveParaguayExtraccion,
} = require("./db");
const { parseRioParaguay } = require("./lib/paraguayConvencional");
const { parseFichAlturas } = require("./lib/fichHtmlParser");

const PARAGUAY_DMH_URL =
  "https://www.meteorologia.gov.py/nivel-rio/indexconvencional.php";

const app = express();

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

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

// 5 req / min para endpoints que disparan scraping externo
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Límite de actualizaciones por minuto alcanzado." },
});
app.use("/api/data", scrapeLimiter);
app.use("/api/rio-paraguay-dmh", scrapeLimiter);

// ─── Configuración de puertos ─────────────────────────────────────────────────
const BASE_PORT = Number(process.env.PORT) || 3000;
const PORT_TRY_LIMIT = 15;

const TARGET_URL = "http://wfich1.unl.edu.ar/cim/rios/parana/alturas";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
const FETCH_RETRIES = Math.max(1, Number(process.env.FETCH_RETRIES) || 2);

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

// ─── Inicializar SQLite ───────────────────────────────────────────────────────
try {
  initDb();
} catch (e) {
  console.warn("[db alturas] No se pudo inicializar SQLite:", e.message);
}
try {
  initDbParaguay();
} catch (e) {
  console.warn("[db paraguay] No se pudo inicializar SQLite:", e.message);
}

// ─── Rutas API ────────────────────────────────────────────────────────────────
app.get("/api/data", async (req, res) => {
  try {
    const data = await fetchAlturas();
    let dbSaved = null;
    if (data.items && data.items.length > 0) {
      try {
        dbSaved = saveUltimaExtraccionDelDia(data.items, data.scrapedAt);
      } catch (dbErr) {
        console.error("[db]", dbErr);
        data.warnings.push(`SQLite: ${dbErr.message}`);
      }
    }
    res.json({ ok: true, ...data, dbSaved });
  } catch (err) {
    console.error("[/api/data]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Error interno al obtener datos",
      scrapedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/rio-paraguay-dmh", async (_req, res) => {
  try {
    const data = await fetchRioParaguayDmh();
    let dbSaved = null;
    if (data.items && data.items.length > 0) {
      try {
        dbSaved = saveParaguayExtraccion(data.items, data.scrapedAt);
        if (dbSaved && dbSaved.rowsSaved > 0) {
          console.log(`[db paraguay] ${dbSaved.rowsSaved} filas en ${dbSaved.dbPath}`);
        }
      } catch (dbErr) {
        console.error("[db paraguay]", dbErr);
        data.warnings.push(`SQLite Paraguay: ${dbErr.message}`);
      }
    }
    res.json({ ok: true, ...data, dbSaved });
  } catch (err) {
    console.error("[/api/rio-paraguay-dmh]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Error al obtener datos DMH",
      scrapedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "altura-rios-dashboard" });
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── [4] Timeouts de servidor ────────────────────────────────────────────────
server.timeout = 35_000;          // cierra request si tarda > 35 s
server.keepAliveTimeout = 65_000; // evita que proxies dejen conexiones colgadas
server.headersTimeout = 70_000;   // debe ser > keepAliveTimeout

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

  // Timeout en sockets inactivos: 30 s
  socket.setTimeout(30_000);
  socket.on("timeout", () => socket.destroy());
  socket.on("close", () => connectionCount--);
  socket.on("error", () => connectionCount--);
});

// ─── [6] Shutdown ordenado ───────────────────────────────────────────────────
function gracefulShutdown(code = 1, reason = "desconocida") {
  console.log(`[shutdown] Razón: ${reason}. Cerrando servidor…`);
  server.close(() => {
    console.log("[shutdown] Servidor cerrado correctamente.");
    process.exit(code);
  });
  // Si el cierre tarda más de 8 s, forzar salida
  setTimeout(() => {
    console.error("[shutdown] Timeout forzado.");
    process.exit(code);
  }, 8000).unref();
}

process.on("SIGTERM", () => gracefulShutdown(0, "SIGTERM"));
process.on("SIGINT", () => gracefulShutdown(0, "SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  // Solo log; no cerramos para no interrumpir otras requests activas
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message, err.stack);
  gracefulShutdown(1, "uncaughtException");
});

// ─── [7] Bind seguro ─────────────────────────────────────────────────────────
// En dev: 127.0.0.1 (solo localhost). En prod: 0.0.0.0 (todas las interfaces).
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