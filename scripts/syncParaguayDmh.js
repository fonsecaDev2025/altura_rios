/**
 * Descarga DMH Paraguay (Río Paraguay) y guarda en data/paraguay_dmh.sqlite.
 * Útil si no usas el navegador o para poblar la base manualmente.
 *
 *   node scripts/syncParaguayDmh.js
 */

const { parseRioParaguay } = require("../lib/paraguayConvencional");
const { saveParaguayExtraccion } = require("../db");

const URL =
  "https://www.meteorologia.gov.py/nivel-rio/indexconvencional.php";

async function main() {
  const res = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AlturaRiosSync/1.0)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const items = parseRioParaguay(html);
  if (!items.length) {
    throw new Error("No se parsearon filas de Río Paraguay.");
  }
  const scrapedAt = new Date().toISOString();
  const out = saveParaguayExtraccion(items, scrapedAt);
  console.log(`Guardadas ${out.rowsSaved} filas en ${out.dbPath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  if (e.code === "SQLITE_READONLY" || e.code === "EACCES") {
    console.error(
      "\nPista: sin permiso de escritura en data/paraguay_dmh.sqlite. Ejemplo:\n" +
        "  sudo chown \"$USER:$USER\" data/paraguay_dmh.sqlite\n" +
        "  chmod u+w data/paraguay_dmh.sqlite"
    );
  }
  process.exit(1);
});
