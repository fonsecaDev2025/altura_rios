/**
 * Descarga historico (?page=historico&tiempo=365) y guarda registros en SQLite (nuevo archivo en data/).
 *
 * Uso:
 *   node scripts/importHistorico.js
 *   ID=130 TIEMPO=365 node scripts/importHistorico.js
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { parseHistoricoHtml } = require("../lib/historicoParser");

const BASE =
  process.env.HISTORICO_BASE ||
  "https://contenidosweb.prefecturanaval.gob.ar/alturas/";

async function main() {
  const id = process.env.ID || process.argv[2] || "130";
  const tiempo = process.env.TIEMPO || process.argv[3] || "365";
  const url = `${BASE}?id=${encodeURIComponent(id)}&page=historico&tiempo=${encodeURIComponent(tiempo)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AlturaRiosHistorico/1.0; +local import)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al obtener ${url}`);
  }
  const html = await res.text();
  const rows = parseHistoricoHtml(html);

  if (!rows.length) {
    throw new Error(
      "No se encontraron filas en table.fpTable. ¿Cambió el HTML del sitio?"
    );
  }

  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, `historico_${id}_${tiempo}.sqlite`);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const scrapedAt = new Date().toISOString();
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      registro_mts REAL NOT NULL,
      scraped_at TEXT NOT NULL,
      UNIQUE (fecha, hora)
    );
    CREATE INDEX idx_registros_fecha ON registros (fecha);
  `);

  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  insMeta.run("fuente_url", url);
  insMeta.run("puerto_id", String(id));
  insMeta.run("tiempo_dias", String(tiempo));
  insMeta.run("rows_importados", String(rows.length));
  insMeta.run("scraped_at", scrapedAt);

  const ins = db.prepare(`
    INSERT INTO registros (orden, fecha, hora, registro_mts, scraped_at)
    VALUES (@orden, @fecha, @hora, @registro_mts, @scraped_at)
    ON CONFLICT(fecha, hora) DO UPDATE SET
      orden = excluded.orden,
      registro_mts = excluded.registro_mts,
      scraped_at = excluded.scraped_at
  `);

  const tx = db.transaction((list) => {
    for (const r of list) {
      ins.run({
        orden: r.orden,
        fecha: r.fecha,
        hora: r.hora,
        registro_mts: r.registro_mts,
        scraped_at: scrapedAt,
      });
    }
  });
  tx(rows);

  db.close();

  console.log(`Base creada: ${dbPath}`);
  console.log(`Registros: ${rows.length} (URL tiempo=${tiempo} días)`);
  console.log(`Muestra: ${rows[0].fecha} ${rows[0].hora} → ${rows[0].registro_mts} m`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
