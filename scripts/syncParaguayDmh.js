/**
 * Descarga DMH Paraguay (Río Paraguay) y guarda en AMBAS bases de datos:
 *   - data/paraguay_dmh.sqlite  (vía saveParaguayExtraccion)
 *   - data/alturas.sqlite       (vía saveUltimaExtraccionDelDia)
 *
 * Útil si no usas el navegador o para poblar las bases manualmente.
 * Se usa también desde croniter_daily.py con `npm run sync:paraguay`.
 *
 *   node scripts/syncParaguayDmh.js
 */

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
    outParaguay = saveParaguayExtraccion(items, scrapedAt);
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
    outAlturas = saveUltimaExtraccionDelDia(itemsAlturas, scrapedAt);
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
