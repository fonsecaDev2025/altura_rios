/**
 * Persistencia alturas + paraguay.
 * Local/Render: archivos SQLite. Vercel: Turso (TURSO_DATABASE_URL).
 */

const path = require("path");
const sql = require("./lib/sqlDriver");

const dbDir = path.join(__dirname, "data");
const dbPath = process.env.SQLITE_PATH || path.join(dbDir, "alturas.sqlite");
const paraguayDbPath =
  process.env.PARAGUAY_SQLITE_PATH || path.join(dbDir, "paraguay_dmh.sqlite");

function fechaDiaArgentina(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function fechaDmYToIso(fecha) {
  const p = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(fecha || "").trim());
  if (!p) return null;
  return `${p[3]}-${p[2]}-${p[1]}`;
}

async function initDb() {
  await sql.ensureSchema();
  return { backend: sql.backendLabel(), dbPath };
}

async function initDbParaguay() {
  await sql.ensureSchema();
  return { backend: sql.backendLabel(), dbPath: paraguayDbPath };
}

async function maintenanceAlturas() {
  return null;
}

async function maintenanceParaguay() {
  return null;
}

async function saveSnapshot(source, scrapedAtIso, payload) {
  await sql.ensureSchema();
  await sql.run(
    "alturas",
    `INSERT INTO snapshots (source, scraped_at, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT(source, scraped_at) DO UPDATE SET
       payload_json = excluded.payload_json`,
    [source, scrapedAtIso, JSON.stringify(payload)]
  );

  await sql.run(
    "alturas",
    `DELETE FROM snapshots
     WHERE source = ?
       AND scraped_at NOT IN (
         SELECT scraped_at FROM snapshots
         WHERE source = ?
         ORDER BY scraped_at DESC
         LIMIT 10
       )`,
    [source, source]
  );

  return { source, scrapedAt: scrapedAtIso };
}

async function getLatestSnapshot(source) {
  await sql.ensureSchema();
  const row = await sql.get(
    "alturas",
    `SELECT scraped_at, payload_json FROM snapshots
     WHERE source = ?
     ORDER BY scraped_at DESC
     LIMIT 1`,
    [source]
  );
  if (!row) return null;
  try {
    return { scrapedAt: row.scraped_at, payload: JSON.parse(row.payload_json) };
  } catch {
    return null;
  }
}

async function saveUltimaExtraccionDelDia(items, scrapedAtIso) {
  await sql.ensureSchema();
  const fechaDia = fechaDiaArgentina(new Date(scrapedAtIso));
  const extractedAt = scrapedAtIso;
  const batch = [];

  for (const row of items || []) {
    const puerto = (row.puerto || "").trim();
    if (!puerto) continue;
    const altura = row.altura ?? row.ultimoRegistro ?? "";
    const altAnt = row.alturaAnterior ?? row.registroAnterior ?? "";
    batch.push({
      sql: `INSERT INTO extracciones_dia (
          fecha_dia, puerto, ultimo_registro, variacion, estado, registro_anterior, extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fecha_dia, puerto) DO UPDATE SET
          ultimo_registro = excluded.ultimo_registro,
          variacion = excluded.variacion,
          estado = excluded.estado,
          registro_anterior = excluded.registro_anterior,
          extracted_at = excluded.extracted_at`,
      args: [
        fechaDia,
        puerto,
        altura != null ? String(altura) : "",
        row.variacion != null ? String(row.variacion) : "",
        row.estado != null ? String(row.estado) : "",
        altAnt != null ? String(altAnt) : "",
        extractedAt,
      ],
    });
  }

  if (batch.length) await sql.batch("alturas", batch);
  return {
    fechaDia,
    rowsSaved: batch.length,
    dbPath: sql.useTurso() ? "turso" : dbPath,
  };
}

async function saveParaguayExtraccion(items, scrapedAtIso) {
  await sql.ensureSchema();
  const batch = [];

  for (const row of items || []) {
    const localidad = (row.localidad || "").trim();
    const fecha = (row.fecha || "").trim();
    if (!localidad || !fecha) continue;
    const fechaIso = fechaDmYToIso(fecha);
    batch.push({
      sql: `INSERT INTO rio_paraguay_dmh (
          fecha, fecha_iso, localidad, nivel_del_dia, variacion_diaria,
          minimo_historico, maximo_historico, ver_mas_url, extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fecha, localidad) DO UPDATE SET
          fecha_iso = excluded.fecha_iso,
          nivel_del_dia = excluded.nivel_del_dia,
          variacion_diaria = excluded.variacion_diaria,
          minimo_historico = excluded.minimo_historico,
          maximo_historico = excluded.maximo_historico,
          ver_mas_url = excluded.ver_mas_url,
          extracted_at = excluded.extracted_at`,
      args: [
        fecha,
        fechaIso,
        localidad,
        row.nivelDelDia != null ? String(row.nivelDelDia) : "",
        row.variacionDiaria != null ? String(row.variacionDiaria) : "",
        row.minimoHistoricoFecha != null ? String(row.minimoHistoricoFecha) : "",
        row.maximoHistoricoFecha != null ? String(row.maximoHistoricoFecha) : "",
        row.verMasUrl != null ? String(row.verMasUrl) : "",
        scrapedAtIso,
      ],
    });
  }

  if (batch.length) await sql.batch("paraguay", batch);
  return {
    rowsSaved: batch.length,
    dbPath: sql.useTurso() ? "turso" : paraguayDbPath,
  };
}

async function getSeriesAlturas(dias = 14) {
  await sql.ensureSchema();
  const n = Math.max(1, Math.min(90, Number(dias) || 14));
  const rows = await sql.all(
    "alturas",
    `SELECT puerto, fecha_dia AS fecha, ultimo_registro AS altura
     FROM extracciones_dia
     WHERE fecha_dia >= date('now', ?)
     ORDER BY puerto ASC, fecha_dia ASC`,
    [`-${n} days`]
  );
  const out = {};
  for (const r of rows) {
    const key = (r.puerto || "").trim();
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push({ fecha: r.fecha, altura: r.altura || "" });
  }
  return out;
}

async function getSeriesParaguay(dias = 14) {
  await sql.ensureSchema();
  const n = Math.max(1, Math.min(90, Number(dias) || 14));
  const rows = await sql.all(
    "paraguay",
    `SELECT localidad AS puerto, fecha_iso AS fecha, nivel_del_dia AS altura
     FROM rio_paraguay_dmh
     WHERE fecha_iso IS NOT NULL
       AND fecha_iso >= date('now', ?)
     ORDER BY localidad ASC, fecha_iso ASC`,
    [`-${n} days`]
  );
  const out = {};
  for (const r of rows) {
    const key = (r.puerto || "").trim();
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push({ fecha: r.fecha, altura: r.altura || "" });
  }
  return out;
}

module.exports = {
  initDb,
  maintenanceAlturas,
  maintenanceParaguay,
  saveUltimaExtraccionDelDia,
  saveSnapshot,
  getLatestSnapshot,
  dbPath,
  initDbParaguay,
  saveParaguayExtraccion,
  paraguayDbPath,
  getSeriesAlturas,
  getSeriesParaguay,
};
