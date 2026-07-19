/**
 * Copia datos de los SQLite locales a Turso (una sola DB remota).
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run import:turso
 *
 * No borra filas remotas; usa INSERT OR IGNORE / OR REPLACE según tabla.
 */
const Database = require("better-sqlite3");
const { createClient } = require("@libsql/client");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "data");
const BATCH = 80;

function openLocal(name) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) {
    console.warn(`Omitido (no existe): ${p}`);
    return null;
  }
  return new Database(p, { readonly: true });
}

async function flush(client, sql, rows, mapArgs) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await client.batch(
      chunk.map((row) => ({ sql, args: mapArgs(row) })),
      "write"
    );
    n += chunk.length;
  }
  return n;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("Definí TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.");
  }

  const { ensureSchema } = require("../lib/sqlDriver");
  await ensureSchema();
  const client = createClient({ url, authToken });

  const dbA = openLocal("alturas.sqlite");
  if (dbA) {
    const extr = dbA.prepare("SELECT * FROM extracciones_dia").all();
    const n1 = await flush(
      client,
      `INSERT OR IGNORE INTO extracciones_dia
        (fecha_dia, puerto, ultimo_registro, variacion, estado, registro_anterior, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      extr,
      (r) => [
        r.fecha_dia,
        r.puerto,
        r.ultimo_registro,
        r.variacion,
        r.estado,
        r.registro_anterior,
        r.extracted_at,
      ]
    );
    const snaps = dbA.prepare("SELECT * FROM snapshots").all();
    const n2 = await flush(
      client,
      `INSERT OR REPLACE INTO snapshots (source, scraped_at, payload_json) VALUES (?, ?, ?)`,
      snaps,
      (r) => [r.source, r.scraped_at, r.payload_json]
    );
    console.log(`alturas: ${n1} extracciones_dia, ${n2} snapshots`);
    dbA.close();
  }

  const dbP = openLocal("paraguay_dmh.sqlite");
  if (dbP) {
    const rows = dbP.prepare("SELECT * FROM rio_paraguay_dmh").all();
    const n = await flush(
      client,
      `INSERT OR IGNORE INTO rio_paraguay_dmh
        (fecha, fecha_iso, localidad, nivel_del_dia, variacion_diaria,
         minimo_historico, maximo_historico, ver_mas_url, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rows,
      (r) => [
        r.fecha,
        r.fecha_iso,
        r.localidad,
        r.nivel_del_dia,
        r.variacion_diaria,
        r.minimo_historico,
        r.maximo_historico,
        r.ver_mas_url,
        r.extracted_at,
      ]
    );
    console.log(`paraguay: ${n} filas`);
    dbP.close();
  }

  const dbPasos = openLocal("pasos.sqlite");
  if (dbPasos) {
    const users = dbPasos.prepare("SELECT * FROM users").all();
    const nU = await flush(
      client,
      `INSERT OR IGNORE INTO users (id, username, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      users,
      (r) => [r.id, r.username, r.password_hash, r.password_salt, r.created_at]
    );
    const sessions = dbPasos.prepare("SELECT * FROM sessions").all();
    const nS = await flush(
      client,
      `INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      sessions,
      (r) => [r.token, r.user_id, r.created_at, r.expires_at]
    );
    const pasos = dbPasos.prepare("SELECT * FROM pasos").all();
    const nP = await flush(
      client,
      `INSERT OR IGNORE INTO pasos
        (id, user_id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pasos,
      (r) => [
        r.id,
        r.user_id,
        r.fecha,
        r.puerto,
        r.altura,
        r.paso,
        r.profundidad,
        r.ancho,
        r.created_at,
        r.updated_at,
      ]
    );
    console.log(`pasos: ${nU} users, ${nS} sessions, ${nP} pasos`);
    dbPasos.close();
  }

  console.log("OK: import local → Turso terminado.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
