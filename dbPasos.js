/**
 * Base de datos multiusuario para "Pasos y profundidades".
 * Archivo: data/pasos.sqlite (o PASOS_SQLITE_PATH).
 *
 * Tablas:
 *  - users    : credenciales (hash scrypt + salt). Sin dependencias externas.
 *  - sessions : tokens de sesión (cookie httpOnly), con expiración.
 *  - pasos    : registros de cada usuario (user_id), aislados por dueño.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const dbDir = path.join(__dirname, "data");
const pasosDbPath =
  process.env.PASOS_SQLITE_PATH || path.join(dbDir, "pasos.sqlite");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

let db;

function initDbPasos() {
  if (db) return db;
  fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(pasosDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  `);
  return db;
}

// ─── Usuarios y contraseñas (scrypt nativo, sin dependencias) ─────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHashHex) {
  const hash = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHashHex, "hex");
  return (
    hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
  );
}

/** Valida usuario/clave y crea el usuario. Lanza Error con mensaje legible. */
function createUser(username, password) {
  const database = initDbPasos();
  const name = String(username || "").trim();
  const pass = String(password || "");
  if (name.length < 3 || name.length > 40) {
    throw new Error("El usuario debe tener entre 3 y 40 caracteres.");
  }
  if (!/^[a-zA-Z0-9._@-]+$/.test(name)) {
    throw new Error("El usuario solo admite letras, números y . _ - @");
  }
  if (pass.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }
  const exists = database
    .prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE")
    .get(name);
  if (exists) {
    throw new Error("Ese nombre de usuario ya está registrado.");
  }
  const { salt, hash } = hashPassword(pass);
  const now = new Date().toISOString();
  const info = database
    .prepare(
      `INSERT INTO users (username, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, hash, salt, now);
  return { id: info.lastInsertRowid, username: name };
}

/** Devuelve { id, username } si las credenciales son válidas, o null. */
function authenticate(username, password) {
  const database = initDbPasos();
  const name = String(username || "").trim();
  const row = database
    .prepare(
      "SELECT id, username, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE"
    )
    .get(name);
  if (!row) return null;
  if (!verifyPassword(password, row.password_salt, row.password_hash)) {
    return null;
  }
  return { id: row.id, username: row.username };
}

// ─── Sesiones ─────────────────────────────────────────────────────────────────

function createSession(userId) {
  const database = initDbPasos();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  database
    .prepare(
      `INSERT INTO sessions (token, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(token, userId, createdAt, expiresAt);
  return { token, expiresAt };
}

/** Devuelve { id, username } del dueño de un token válido y no vencido, o null. */
function getUserBySession(token) {
  if (!token) return null;
  const database = initDbPasos();
  const row = database
    .prepare(
      `SELECT s.token, s.expires_at, u.id AS id, u.username AS username
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(String(token));
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    database.prepare("DELETE FROM sessions WHERE token = ?").run(row.token);
    return null;
  }
  return { id: row.id, username: row.username };
}

function deleteSession(token) {
  if (!token) return false;
  const database = initDbPasos();
  const info = database
    .prepare("DELETE FROM sessions WHERE token = ?")
    .run(String(token));
  return info.changes > 0;
}

// ─── CRUD de pasos (siempre acotado al user_id dueño) ─────────────────────────

function normalizePaso(input) {
  const data = input || {};
  const str = (v) => (v == null ? "" : String(v).trim());
  const fecha = str(data.fecha);
  const puerto = str(data.puerto);
  if (!fecha) throw new Error("El campo «fecha» es obligatorio.");
  if (!puerto) throw new Error("El campo «puerto» es obligatorio.");
  return {
    fecha,
    puerto,
    altura: str(data.altura),
    paso: str(data.paso),
    profundidad: str(data.profundidad),
    ancho: str(data.ancho),
  };
}

function listPasos(userId) {
  const database = initDbPasos();
  return database
    .prepare(
      `SELECT id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at
       FROM pasos WHERE user_id = ?
       ORDER BY fecha DESC, id DESC`
    )
    .all(Number(userId));
}

function getPaso(id, userId) {
  const database = initDbPasos();
  const row = database
    .prepare(
      `SELECT id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at
       FROM pasos WHERE id = ? AND user_id = ?`
    )
    .get(Number(id), Number(userId));
  return row || null;
}

function createPaso(userId, input) {
  const database = initDbPasos();
  const p = normalizePaso(input);
  const now = new Date().toISOString();
  const info = database
    .prepare(
      `INSERT INTO pasos (user_id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at)
       VALUES (@user_id, @fecha, @puerto, @altura, @paso, @profundidad, @ancho, @created_at, @updated_at)`
    )
    .run({ ...p, user_id: Number(userId), created_at: now, updated_at: now });
  return getPaso(info.lastInsertRowid, userId);
}

function updatePaso(id, userId, input) {
  const database = initDbPasos();
  if (!getPaso(id, userId)) return null;
  const p = normalizePaso(input);
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE pasos SET
         fecha = @fecha, puerto = @puerto, altura = @altura,
         paso = @paso, profundidad = @profundidad, ancho = @ancho,
         updated_at = @updated_at
       WHERE id = @id AND user_id = @user_id`
    )
    .run({ ...p, updated_at: now, id: Number(id), user_id: Number(userId) });
  return getPaso(id, userId);
}

function deletePaso(id, userId) {
  const database = initDbPasos();
  const info = database
    .prepare("DELETE FROM pasos WHERE id = ? AND user_id = ?")
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = {
  initDbPasos,
  pasosDbPath,
  SESSION_TTL_MS,
  createUser,
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  listPasos,
  getPaso,
  createPaso,
  updatePaso,
  deletePaso,
};
