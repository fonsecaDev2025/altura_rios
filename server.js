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
 *  [6] gracefulShutdown   — cierre ordenado
 *  [7] BIND_HOST          — bind solo a localhost en dev
 *  [8] static headers     — X-Frame-Options, nosniff, etc.
 */

const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { initDb, initDbParaguay, maintenanceAlturas, maintenanceParaguay } = require("./db");
const { initDbPasos, maintenancePasos } = require("./dbPasos");
const { wantsRefresh } = require("./lib/snapshots");
const { apiCacheControl } = require("./lib/apiCacheControl");

const dataRoutes = require("./routes/data");
const cronRoutes = require("./routes/cron");
const authRoutes = require("./routes/auth");
const pasosRoutes = require("./routes/pasos");

const app = express();

const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set(
    "trust proxy",
    /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY
  );
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

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

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Demasiadas peticiones. Reintentá en un minuto.",
  },
});
app.use("/api/", apiLimiter);

const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Límite de actualizaciones por minuto alcanzado.",
  },
  skip: (req) => !wantsRefresh(req),
});
app.use("/api/data", scrapeLimiter);
app.use("/api/rio-paraguay-dmh", scrapeLimiter);

app.use(apiCacheControl);

const BASE_PORT = Number(process.env.PORT) || 3000;
const PORT_TRY_LIMIT = 15;

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

const IS_VERCEL = Boolean(process.env.VERCEL);
const MAINTENANCE_INTERVAL_MS =
  Number(process.env.MAINTENANCE_INTERVAL_MS) || 30 * 60 * 1000;

async function runDbMaintenance() {
  try {
    await maintenanceAlturas();
    await maintenanceParaguay();
    const r = await maintenancePasos();
    if (r && r.sessionsRemoved > 0) {
      console.log(
        `[mantenimiento] ${r.sessionsRemoved} sesiones vencidas purgadas.`
      );
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

app.use("/api", dataRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/pasos", pasosRoutes);

module.exports = app;

const IS_SERVERLESS = Boolean(process.env.VERCEL);

if (!IS_SERVERLESS) {
  const server = http.createServer(app);

  server.timeout = 35_000;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

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
      console.log(
        `Conexiones máx: ${MAX_CONNECTIONS} | Timeout: ${server.timeout / 1000}s`
      );
    });
  }

  listenWithFallback(BASE_PORT, PORT_TRY_LIMIT);
}
