/**
 * Servidor Express + API REST: scraping de alturas de ríos (PNA).
 * Fuente: Prefectura Naval Argentina — Registro público de alturas.
 */

const path = require("path");
const http = require("http");
const express = require("express");
const puppeteer = require("puppeteer");
const {
  initDb,
  saveUltimaExtraccionDelDia,
  initDbParaguay,
  saveParaguayExtraccion,
} = require("./db");
const { parseRioParaguay } = require("./lib/paraguayConvencional");

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

const TARGET_URL = "https://contenidosweb.prefecturanaval.gob.ar/alturas/";
const SITE_ORIGIN = "https://contenidosweb.prefecturanaval.gob.ar";
const SCRAPE_RETRIES = Math.max(1, Number(process.env.SCRAPE_RETRIES) || 2);
const SCRAPE_NAV_TIMEOUT_MS = Math.max(
  20000,
  Number(process.env.SCRAPE_NAV_TIMEOUT_MS) || 90000
);
const SCRAPE_SELECTOR_TIMEOUT_MS = Math.max(
  15000,
  Number(process.env.SCRAPE_SELECTOR_TIMEOUT_MS) || 60000
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrae filas de table.fpTable (estructura HTML del sitio oficial).
 * Cierra el navegador en finally para no dejar procesos colgados.
 */
async function fetchRioParaguayDmh() {
  const res = await fetch(PARAGUAY_DMH_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-PY,es;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`DMH Paraguay: HTTP ${res.status}`);
  }
  const html = await res.text();
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

async function scrapeAlturasOnce() {
  let browser = null;

  try {
    const launchOpts = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(launchOpts);

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(45000);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    /**
     * networkidle2 suele colgarse en sitios con analytics o peticiones largas.
     * domcontentloaded + espera explícita a la tabla es más fiable.
     * Opcional: no descargar imágenes/fuentes para acelerar y reducir ruido de red.
     */
    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const t = req.resourceType();
        if (t === "image" || t === "font" || t === "media") {
          req.abort().catch(() => {});
        } else {
          req.continue().catch(() => {});
        }
      });
    } catch {
      /* seguir sin interceptar */
    }

    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: SCRAPE_NAV_TIMEOUT_MS,
    });

    await page.waitForSelector("table.fpTable tbody tr", {
      timeout: SCRAPE_SELECTOR_TIMEOUT_MS,
    });

    const items = await page.evaluate((origin) => {
      const T = (el) =>
        el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";

      const trs = Array.from(document.querySelectorAll("table.fpTable tbody tr"));
      const out = [];

      for (const tr of trs) {
        const cells = tr.querySelectorAll(":scope > th, :scope > td");
        if (cells.length < 13) continue;

        let href = cells[12]?.querySelector("a")?.getAttribute("href") || "";
        href = href.replace(/\r/g, "").trim();
        if (href.startsWith("/")) href = origin + href;
        else if (href && !/^https?:/i.test(href)) href = origin + "/" + href.replace(/^\//, "");

        const row = {
          puerto: T(cells[0]),
          rio: T(cells[1]),
          ultimoRegistro: T(cells[2]),
          variacion: T(cells[3]),
          periodo: T(cells[4]),
          fechaHora: T(cells[5]),
          estado: T(cells[6]),
          registroAnterior: T(cells[8]),
          fechaAnterior: T(cells[9]),
          alerta: T(cells[10]),
          evacuacion: T(cells[11]),
          historicoHref: href || null,
        };

        if (row.puerto || row.rio) out.push(row);
      }
      return out;
    }, SITE_ORIGIN);

    return {
      source: TARGET_URL,
      scrapedAt: new Date().toISOString(),
      count: items.length,
      items,
      warnings: [],
    };
  } catch (err) {
    throw new Error(`Scraping fallido: ${err.message || String(err)}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function scrapeAlturas() {
  let lastError = null;
  for (let attempt = 1; attempt <= SCRAPE_RETRIES; attempt += 1) {
    try {
      const data = await scrapeAlturasOnce();
      if (!data.items.length) {
        data.warnings.push(
          "No se obtuvieron filas. Comprueba que table.fpTable siga existiendo en la página."
        );
      }
      if (attempt > 1) {
        data.warnings.push(`Scraping recuperado en intento ${attempt}/${SCRAPE_RETRIES}.`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < SCRAPE_RETRIES) {
        const delay = 1500 * attempt;
        await sleep(delay);
      }
    }
  }
  throw lastError || new Error("Scraping fallido: error desconocido.");
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
    const data = await scrapeAlturas();
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
