/**
 * SQLite: guarda la última extracción del día por puerto (solo campos acordados).
 * Ruta del archivo: data/alturas.sqlite o SQLITE_PATH.
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbDir = path.join(__dirname, "data");
const dbPath = process.env.SQLITE_PATH || path.join(dbDir, "alturas.sqlite");

let db;

/** Día calendario en Argentina (YYYY-MM-DD) para agrupar “última extracción del día”. */
function fechaDiaArgentina(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function initDb() {
  if (db) return db;
  fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS extracciones_dia (
      fecha_dia TEXT NOT NULL,
      puerto TEXT NOT NULL,
      ultimo_registro TEXT,
      variacion TEXT,
      estado TEXT,
      registro_anterior TEXT,
      extracted_at TEXT NOT NULL,
      PRIMARY KEY (fecha_dia, puerto)
    );
  `);
  return db;
}

/**
 * items: objetos del scraper con puerto, ultimoRegistro, variacion, estado, registroAnterior.
 * Misma fecha_día + mismo puerto → se sobrescribe (queda la última extracción del día).
 */
function saveUltimaExtraccionDelDia(items, scrapedAtIso) {
  const database = initDb();
  const fechaDia = fechaDiaArgentina(new Date(scrapedAtIso));
  const extractedAt = scrapedAtIso;

  const stmt = database.prepare(`
    INSERT INTO extracciones_dia (
      fecha_dia, puerto, ultimo_registro, variacion, estado, registro_anterior, extracted_at
    ) VALUES (
      @fecha_dia, @puerto, @ultimo_registro, @variacion, @estado, @registro_anterior, @extracted_at
    )
    ON CONFLICT(fecha_dia, puerto) DO UPDATE SET
      ultimo_registro = excluded.ultimo_registro,
      variacion = excluded.variacion,
      estado = excluded.estado,
      registro_anterior = excluded.registro_anterior,
      extracted_at = excluded.extracted_at
  `);

  let n = 0;
  const tx = database.transaction((rows) => {
    for (const row of rows) {
      const puerto = (row.puerto || "").trim();
      if (!puerto) continue;
      const altura = row.altura ?? row.ultimoRegistro ?? "";
      const altAnt = row.alturaAnterior ?? row.registroAnterior ?? "";
      stmt.run({
        fecha_dia: fechaDia,
        puerto,
        ultimo_registro: altura != null ? String(altura) : "",
        variacion: row.variacion != null ? String(row.variacion) : "",
        estado: row.estado != null ? String(row.estado) : "",
        registro_anterior: altAnt != null ? String(altAnt) : "",
        extracted_at: extractedAt,
      });
      n += 1;
    }
  });

  tx(items);
  return { fechaDia, rowsSaved: n, dbPath };
}

/** Base aparte: DMH Paraguay — Río Paraguay (convencionales). */
const paraguayDbPath =
  process.env.PARAGUAY_SQLITE_PATH || path.join(dbDir, "paraguay_dmh.sqlite");

let dbParaguay;

/** DD-MM-YYYY → YYYY-MM-DD para ordenar / consultar. */
function fechaDmYToIso(fecha) {
  const p = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(fecha || "").trim());
  if (!p) return null;
  return `${p[3]}-${p[2]}-${p[1]}`;
}

function initDbParaguay() {
  if (dbParaguay) return dbParaguay;
  fs.mkdirSync(dbDir, { recursive: true });
  dbParaguay = new Database(paraguayDbPath);
  dbParaguay.exec(`
    CREATE TABLE IF NOT EXISTS rio_paraguay_dmh (
      fecha TEXT NOT NULL,
      fecha_iso TEXT,
      localidad TEXT NOT NULL,
      nivel_del_dia TEXT,
      variacion_diaria TEXT,
      minimo_historico TEXT,
      maximo_historico TEXT,
      ver_mas_url TEXT,
      extracted_at TEXT NOT NULL,
      PRIMARY KEY (fecha, localidad)
    );
    CREATE INDEX IF NOT EXISTS idx_paraguay_fecha_iso ON rio_paraguay_dmh (fecha_iso);
  `);
  return dbParaguay;
}

/**
 * items: salida de parseRioParaguay (localidad, fecha, nivelDelDia, …).
 * Misma fecha + localidad → se actualiza (última extracción).
 */
function saveParaguayExtraccion(items, scrapedAtIso) {
  if (fs.existsSync(paraguayDbPath)) {
    try {
      fs.accessSync(paraguayDbPath, fs.constants.W_OK);
    } catch (e) {
      const err = new Error(
        `Sin permiso de escritura en ${paraguayDbPath} (${e.code || e.message}). Ej.: sudo chown "$USER:$USER" data/paraguay_dmh.sqlite`
      );
      err.code = e.code;
      throw err;
    }
  }
  const database = initDbParaguay();
  const extractedAt = scrapedAtIso;

  const stmt = database.prepare(`
    INSERT INTO rio_paraguay_dmh (
      fecha, fecha_iso, localidad, nivel_del_dia, variacion_diaria,
      minimo_historico, maximo_historico, ver_mas_url, extracted_at
    ) VALUES (
      @fecha, @fecha_iso, @localidad, @nivel_del_dia, @variacion_diaria,
      @minimo_historico, @maximo_historico, @ver_mas_url, @extracted_at
    )
    ON CONFLICT(fecha, localidad) DO UPDATE SET
      fecha_iso = excluded.fecha_iso,
      nivel_del_dia = excluded.nivel_del_dia,
      variacion_diaria = excluded.variacion_diaria,
      minimo_historico = excluded.minimo_historico,
      maximo_historico = excluded.maximo_historico,
      ver_mas_url = excluded.ver_mas_url,
      extracted_at = excluded.extracted_at
  `);

  let n = 0;
  const tx = database.transaction((rows) => {
    for (const row of rows) {
      const localidad = (row.localidad || "").trim();
      const fecha = (row.fecha || "").trim();
      if (!localidad || !fecha) continue;
      const fechaIso = fechaDmYToIso(fecha);
      stmt.run({
        fecha,
        fecha_iso: fechaIso,
        localidad,
        nivel_del_dia: row.nivelDelDia != null ? String(row.nivelDelDia) : "",
        variacion_diaria:
          row.variacionDiaria != null ? String(row.variacionDiaria) : "",
        minimo_historico:
          row.minimoHistoricoFecha != null ? String(row.minimoHistoricoFecha) : "",
        maximo_historico:
          row.maximoHistoricoFecha != null ? String(row.maximoHistoricoFecha) : "",
        ver_mas_url: row.verMasUrl != null ? String(row.verMasUrl) : "",
        extracted_at: extractedAt,
      });
      n += 1;
    }
  });

  tx(items);
  return { rowsSaved: n, dbPath: paraguayDbPath };
}

module.exports = {
  initDb,
  saveUltimaExtraccionDelDia,
  dbPath,
  initDbParaguay,
  saveParaguayExtraccion,
  paraguayDbPath,
};
