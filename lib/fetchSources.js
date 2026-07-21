/**
 * Fetch + parse de fuentes oficiales (FICH/UNL y DMH Paraguay).
 */

const { parseRioParaguay } = require("./paraguayConvencional");
const { parseFichAlturas } = require("./fichHtmlParser");
const { sleep } = require("./snapshots");

const TARGET_URL = "http://wfich1.unl.edu.ar/cim/rios/parana/alturas";
const PARAGUAY_DMH_URL =
  "https://www.meteorologia.gov.py/nivel-rio/indexconvencional.php";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
const FETCH_RETRIES = Math.max(1, Number(process.env.FETCH_RETRIES) || 2);

async function fetchRioParaguayDmh() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(PARAGUAY_DMH_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-PY,es;q=0.9",
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error(`DMH Paraguay: timeout tras ${FETCH_TIMEOUT_MS} ms`, {
          cause: err,
        });
      }
      throw new Error(`DMH Paraguay: error de red – ${err.message}`, {
        cause: err,
      });
    }
    if (!res.ok) {
      throw new Error(`DMH Paraguay: HTTP ${res.status}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) {
      throw new Error(`DMH Paraguay: Content-Type inesperado – ${ct}`);
    }

    let html;
    try {
      html = await res.text();
    } catch (err) {
      throw new Error(`DMH Paraguay: error leyendo cuerpo – ${err.message}`, {
        cause: err,
      });
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
  } finally {
    clearTimeout(timer);
  }
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

module.exports = {
  TARGET_URL,
  PARAGUAY_DMH_URL,
  FETCH_TIMEOUT_MS,
  FETCH_RETRIES,
  fetchAlturas,
  fetchRioParaguayDmh,
};
