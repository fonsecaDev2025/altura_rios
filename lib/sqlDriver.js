/**
 * Driver SQL unificado:
 *  - Con TURSO_DATABASE_URL → @libsql/client (Vercel / cloud)
 *  - Sin Turso → better-sqlite3 en archivos locales (dev / Render)
 */

const fs = require("fs");
const path = require("path");

function useTurso() {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

let tursoClient = null;
const sqliteDbs = new Map(); // name -> Database

function getTurso() {
  if (!tursoClient) {
    const { createClient } = require("@libsql/client");
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("Falta TURSO_DATABASE_URL");
    tursoClient = createClient({ url, authToken });
  }
  return tursoClient;
}

function getSqlite(filePath) {
  if (sqliteDbs.has(filePath)) return sqliteDbs.get(filePath);
  const Database = require("better-sqlite3");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  sqliteDbs.set(filePath, db);
  return db;
}

function defaultPaths() {
  const dir = path.join(__dirname, "..", "data");
  return {
    alturas: process.env.SQLITE_PATH || path.join(dir, "alturas.sqlite"),
    paraguay:
      process.env.PARAGUAY_SQLITE_PATH || path.join(dir, "paraguay_dmh.sqlite"),
    pasos: process.env.PASOS_SQLITE_PATH || path.join(dir, "pasos.sqlite"),
  };
}

/** En Turso hay una sola DB; en local/Render cada archivo es un "namespace". */
function resolveFile(namespace) {
  const p = defaultPaths();
  if (namespace === "paraguay") return p.paraguay;
  if (namespace === "pasos") return p.pasos;
  return p.alturas;
}

async function exec(namespace, sql) {
  if (useTurso()) {
    await getTurso().executeMultiple(sql);
    return;
  }
  getSqlite(resolveFile(namespace)).exec(sql);
}

async function run(namespace, sql, args = []) {
  if (useTurso()) {
    const result = await getTurso().execute({ sql, args: normalizeArgs(args) });
    return {
      changes: Number(result.rowsAffected || 0),
      lastInsertRowid: Number(result.lastInsertRowid || 0),
    };
  }
  const info = getSqlite(resolveFile(namespace)).prepare(sql).run(...toSqliteArgs(args));
  return {
    changes: info.changes,
    lastInsertRowid: Number(info.lastInsertRowid),
  };
}

async function get(namespace, sql, args = []) {
  if (useTurso()) {
    const result = await getTurso().execute({ sql, args: normalizeArgs(args) });
    if (!result.rows.length) return undefined;
    return rowToObject(result);
  }
  return getSqlite(resolveFile(namespace)).prepare(sql).get(...toSqliteArgs(args));
}

async function all(namespace, sql, args = []) {
  if (useTurso()) {
    const result = await getTurso().execute({ sql, args: normalizeArgs(args) });
    return result.rows.map((_, i) => rowToObject(result, i));
  }
  return getSqlite(resolveFile(namespace)).prepare(sql).all(...toSqliteArgs(args));
}

/** Ejecuta varios statements en secuencia (mejor esfuerzo de atomicidad). */
async function batch(namespace, items) {
  if (useTurso()) {
    const client = getTurso();
    await client.batch(
      items.map((it) => ({
        sql: it.sql,
        args: normalizeArgs(it.args || []),
      })),
      "write"
    );
    return;
  }
  const db = getSqlite(resolveFile(namespace));
  const tx = db.transaction((list) => {
    for (const it of list) {
      db.prepare(it.sql).run(...toSqliteArgs(it.args || []));
    }
  });
  tx(items);
}

function normalizeArgs(args) {
  if (Array.isArray(args)) return args;
  if (args && typeof args === "object") {
    // better-sqlite3 named params → libsql positional via object values in order is unsafe;
    // callers should pass arrays for Turso path. Support both:
    return args;
  }
  return [];
}

function toSqliteArgs(args) {
  if (Array.isArray(args)) return args;
  if (args && typeof args === "object") return [args];
  return [];
}

function rowToObject(result, index = 0) {
  const row = result.rows[index];
  if (!row) return undefined;
  // @libsql/client Row is array-like with .columns
  if (typeof row === "object" && !Array.isArray(row)) {
    return { ...row };
  }
  const obj = {};
  const cols = result.columns || [];
  for (let i = 0; i < cols.length; i += 1) {
    obj[cols[i]] = row[i];
  }
  return obj;
}

const SCHEMA_ALTURAS = `
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
CREATE TABLE IF NOT EXISTS snapshots (
  source TEXT NOT NULL,
  scraped_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (source, scraped_at)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_time
  ON snapshots (source, scraped_at DESC);
`;

const SCHEMA_PARAGUAY = `
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
`;

const SCHEMA_PASOS = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS pasos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  puerto TEXT NOT NULL,
  altura TEXT,
  paso TEXT,
  profundidad TEXT,
  ancho TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pasos_user ON pasos (user_id, fecha DESC, id DESC);
`;

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  if (useTurso()) {
    // Una sola DB remota: todas las tablas juntas.
    await exec("alturas", SCHEMA_ALTURAS + SCHEMA_PARAGUAY + SCHEMA_PASOS);
  } else {
    await exec("alturas", SCHEMA_ALTURAS);
    await exec("paraguay", SCHEMA_PARAGUAY);
    await exec("pasos", SCHEMA_PASOS);
  }
  schemaReady = true;
}

function backendLabel() {
  return useTurso() ? "turso" : "sqlite-file";
}

module.exports = {
  useTurso,
  ensureSchema,
  exec,
  run,
  get,
  all,
  batch,
  backendLabel,
  defaultPaths,
};
