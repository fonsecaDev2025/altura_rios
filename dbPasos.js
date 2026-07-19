/**
 * Pasos y profundidades (multiusuario).
 * Local/Render: data/pasos.sqlite. Vercel: Turso (TURSO_DATABASE_URL).
 */

const path = require("path");
const crypto = require("crypto");
const sql = require("./lib/sqlDriver");

const dbDir = path.join(__dirname, "data");
const pasosDbPath =
  process.env.PASOS_SQLITE_PATH || path.join(dbDir, "pasos.sqlite");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function initDbPasos() {
  await sql.ensureSchema();
  return { backend: sql.backendLabel(), dbPath: pasosDbPath };
}

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

async function createUser(username, password) {
  await sql.ensureSchema();
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
  const exists = await sql.get(
    "pasos",
    "SELECT 1 AS ok FROM users WHERE username = ? COLLATE NOCASE",
    [name]
  );
  if (exists) {
    throw new Error("Ese nombre de usuario ya está registrado.");
  }
  const { salt, hash } = hashPassword(pass);
  const now = new Date().toISOString();
  const info = await sql.run(
    "pasos",
    `INSERT INTO users (username, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?)`,
    [name, hash, salt, now]
  );
  return { id: info.lastInsertRowid, username: name };
}

async function authenticate(username, password) {
  await sql.ensureSchema();
  const name = String(username || "").trim();
  const row = await sql.get(
    "pasos",
    "SELECT id, username, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE",
    [name]
  );
  if (!row) return null;
  if (!verifyPassword(password, row.password_salt, row.password_hash)) {
    return null;
  }
  return { id: row.id, username: row.username };
}

async function createSession(userId) {
  await sql.ensureSchema();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  await sql.run(
    "pasos",
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [token, userId, createdAt, expiresAt]
  );
  return { token, expiresAt };
}

async function getUserBySession(token) {
  if (!token) return null;
  await sql.ensureSchema();
  const row = await sql.get(
    "pasos",
    `SELECT s.token, s.expires_at, u.id AS id, u.username AS username
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [String(token)]
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await sql.run("pasos", "DELETE FROM sessions WHERE token = ?", [row.token]);
    return null;
  }
  return { id: row.id, username: row.username };
}

async function deleteSession(token) {
  if (!token) return false;
  await sql.ensureSchema();
  const info = await sql.run("pasos", "DELETE FROM sessions WHERE token = ?", [
    String(token),
  ]);
  return info.changes > 0;
}

async function cleanupExpiredSessions() {
  await sql.ensureSchema();
  const info = await sql.run(
    "pasos",
    "DELETE FROM sessions WHERE expires_at <= ?",
    [new Date().toISOString()]
  );
  return info.changes;
}

async function maintenancePasos() {
  const removed = await cleanupExpiredSessions();
  return { sessionsRemoved: removed };
}

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

async function listPasos(userId) {
  await sql.ensureSchema();
  return sql.all(
    "pasos",
    `SELECT id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at
     FROM pasos WHERE user_id = ?
     ORDER BY fecha DESC, id DESC`,
    [Number(userId)]
  );
}

async function getPaso(id, userId) {
  await sql.ensureSchema();
  const row = await sql.get(
    "pasos",
    `SELECT id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at
     FROM pasos WHERE id = ? AND user_id = ?`,
    [Number(id), Number(userId)]
  );
  return row || null;
}

async function createPaso(userId, input) {
  await sql.ensureSchema();
  const p = normalizePaso(input);
  const now = new Date().toISOString();
  const info = await sql.run(
    "pasos",
    `INSERT INTO pasos (user_id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(userId),
      p.fecha,
      p.puerto,
      p.altura,
      p.paso,
      p.profundidad,
      p.ancho,
      now,
      now,
    ]
  );
  return getPaso(info.lastInsertRowid, userId);
}

async function updatePaso(id, userId, input) {
  await sql.ensureSchema();
  if (!(await getPaso(id, userId))) return null;
  const p = normalizePaso(input);
  const now = new Date().toISOString();
  await sql.run(
    "pasos",
    `UPDATE pasos SET
       fecha = ?, puerto = ?, altura = ?,
       paso = ?, profundidad = ?, ancho = ?,
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      p.fecha,
      p.puerto,
      p.altura,
      p.paso,
      p.profundidad,
      p.ancho,
      now,
      Number(id),
      Number(userId),
    ]
  );
  return getPaso(id, userId);
}

async function deletePaso(id, userId) {
  await sql.ensureSchema();
  const info = await sql.run(
    "pasos",
    "DELETE FROM pasos WHERE id = ? AND user_id = ?",
    [Number(id), Number(userId)]
  );
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
  cleanupExpiredSessions,
  maintenancePasos,
  listPasos,
  getPaso,
  createPaso,
  updatePaso,
  deletePaso,
};
