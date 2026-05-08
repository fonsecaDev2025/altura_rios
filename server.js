/**
 * Servidor Express + API REST: alturas de ríos (PNA + DMH Paraguay).
 * Modo liviano: fetch + regex (sin Puppeteer/Chrome).
 */

const path = require("path");
const http = require("http");
const express = require("express");
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

/**
 * CORS: el front en Cloudflare (Pages / *.workers.dev) llama al API en otro servidor.
 * Opcional: CORS_ORIGIN=https://tu-app.workers.dev,https://tu-dominio.com
 * (sin espacios o con espacios tras coma). Si está vacío, se usa *.
 */
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

/** Puerto inicial; si está ocupado se prueba el siguiente (hasta +14). */
const BASE_PORT = Number(process.env.PORT) || 3000;
const PORT_TRY_LIMIT = 15;

const TARGET_URL = "http://wfich1.unl.edu.ar/cim/rios/parana/alturas";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
const FETCH_RETRIES = Math.max(1, Number(process.env.FETCH_RETRIES) || 2);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

app.use(express.static(path.join(__dirname, "public")));

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

/** Solo estaciones convencionales del Río Paraguay (DMH Paraguay). */
app.get("/api/rio-paraguay-dmh", async (_req, res) => {
  try {
    const data = await fetchRioParaguayDmh();
    let dbSaved = null;
    if (data.items && data.items.length > 0) {
      try {
        dbSaved = saveParaguayExtraccion(data.items, data.scrapedAt);
        if (dbSaved && dbSaved.rowsSaved > 0) {
          console.log(
            `[db paraguay] ${dbSaved.rowsSaved} filas en ${dbSaved.dbPath}`
          );
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

const server = http.createServer(app);

function listenWithFallback(port, attemptsLeft) {
  if (attemptsLeft <= 0) {
    console.error(
      `No hay puerto libre entre ${BASE_PORT} y ${BASE_PORT + PORT_TRY_LIMIT - 1}.`
    );
    console.error(
      "Cierra el otro proceso (p. ej. otra ventana con npm start) o usa: PORT=3001 npm start"
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

  server.listen(port, () => {
    server.removeAllListeners("error");
    const addr = server.address();
    const p = addr && addr.port;
    console.log(`Servidor en http://localhost:${p}`);
    console.log(`API datos: http://localhost:${p}/api/data`);
    console.log(`Río Paraguay (DMH): http://localhost:${p}/paraguay.html`);
  });
}

listenWithFallback(BASE_PORT, PORT_TRY_LIMIT);

/* ─── Manejo global de errores no capturados ─── */
process.on("unhandledRejection", (reason, _promise) => {
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  // Cierre ordenado: dejar de aceptar conexiones y salir.
  server.close(() => {
    process.exit(1);
  });
  // Si el cierre tarda más de 5 s, forzar salida.
  setTimeout(() => process.exit(1), 5000).unref();
});
