/**
 * Descarga DMH Paraguay (Río Paraguay) y guarda en AMBAS bases de datos:
 *   - data/paraguay_dmh.sqlite  (vía saveParaguayExtraccion)
 *   - data/alturas.sqlite       (vía saveUltimaExtraccionDelDia)
 *
 * Con TURSO_* en .env/.env.local escribe en Turso (misma lógica que prod).
 *
 * Útil si no usas el navegador o para poblar las bases manualmente.
 * Se usa también desde croniter_daily.py con `npm run sync:paraguay`.
 *
 *   node scripts/syncParaguayDmh.js
 */

const fs = require("fs");
const path = require("path");

function unquote(val) {
  let v = String(val ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Carga .env y .env.local sin pisar variables ya definidas en el entorno. */
function loadEnvFiles() {
  const root = path.join(__dirname, "..");
  for (const name of [".env", ".env.local"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = unquote(trimmed.slice(eq + 1));
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) {
    if (process.env[key] !== undefined) process.env[key] = unquote(process.env[key]);
  }
}

loadEnvFiles();

const { parseRioParaguay } = require("../lib/paraguayConvencional");
const {
  saveParaguayExtraccion,
  saveUltimaExtraccionDelDia,
} = require("../db");

const URL =
  "https://www.meteorologia.gov.py/nivel-rio/indexconvencional.php";

async function main() {
  let res;
  try {
    res = await fetch(URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AlturaRiosSync/1.0)",
        Accept: "text/html",
      },
    });
  } catch (err) {
    throw new Error(`Error de red al contactar DMH: ${err.message}`, { cause: err });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let html;
  try {
    html = await res.text();
  } catch (err) {
    throw new Error(`Error leyendo respuesta DMH: ${err.message}`, { cause: err });
  }

  const items = parseRioParaguay(html);
  if (!items.length) {
    throw new Error("No se parsearon filas de Río Paraguay.");
  }
  const scrapedAt = new Date().toISOString();

  let outParaguay;
  try {
    outParaguay = await saveParaguayExtraccion(items, scrapedAt);
  } catch (err) {
    throw new Error(`Error guardando en paraguay_dmh.sqlite: ${err.message}`, { cause: err });
  }

  const itemsAlturas = items.map((row) => ({
    puerto: row.localidad,
    ultimoRegistro: row.nivelDelDia,
    variacion: row.variacionDiaria,
    estado: "",
    registroAnterior: "",
  }));

  let outAlturas;
  try {
    outAlturas = await saveUltimaExtraccionDelDia(itemsAlturas, scrapedAt);
  } catch (err) {
    throw new Error(`Error guardando en alturas.sqlite: ${err.message}`, { cause: err });
  }

  console.log(`Guardadas ${outParaguay.rowsSaved} filas en ${outParaguay.dbPath}`);
  console.log(`Guardadas ${outAlturas.rowsSaved} filas en ${outAlturas.dbPath}`);
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

main().catch((e) => {
  console.error(e.message || e);
  if (e.code === "SQLITE_READONLY" || e.code === "EACCES") {
    console.error(
      "\nPista: sin permiso de escritura en data/*.sqlite. Ejemplo:\n" +
        "  sudo chown \"$USER:$USER\" data/paraguay_dmh.sqlite data/alturas.sqlite\n" +
        "  chmod u+w data/paraguay_dmh.sqlite data/alturas.sqlite"
    );
  }
  process.exit(1);
});
