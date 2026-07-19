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
    // Upsert por username (no por id local): evita perder usuarios si Turso
    // ya tiene otras filas con esos ids (p. ej. usuarios de prueba).
    const users = dbPasos.prepare("SELECT * FROM users").all();
    const idMap = new Map(); // localUserId -> tursoUserId
    let nU = 0;
    for (const u of users) {
      const existing = await client.execute({
        sql: "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
        args: [u.username],
      });
      if (existing.rows.length) {
        const tursoId = Number(existing.rows[0].id);
        await client.execute({
          sql: `UPDATE users SET password_hash = ?, password_salt = ?, created_at = ?
                WHERE id = ?`,
          args: [u.password_hash, u.password_salt, u.created_at, tursoId],
        });
        idMap.set(u.id, tursoId);
      } else {
        const ins = await client.execute({
          sql: `INSERT INTO users (username, password_hash, password_salt, created_at)
                VALUES (?, ?, ?, ?)`,
          args: [u.username, u.password_hash, u.password_salt, u.created_at],
        });
        idMap.set(u.id, Number(ins.lastInsertRowid));
      }
      nU += 1;
    }

    // Sesiones locales suelen estar vencidas; no las importamos.
    const pasos = dbPasos.prepare("SELECT * FROM pasos").all();
    let nP = 0;
    for (const p of pasos) {
      const tursoUserId = idMap.get(p.user_id);
      if (!tursoUserId) continue;
      const r = await client.execute({
        sql: `INSERT OR IGNORE INTO pasos
          (user_id, fecha, puerto, altura, paso, profundidad, ancho, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          tursoUserId,
          p.fecha,
          p.puerto,
          p.altura,
          p.paso,
          p.profundidad,
          p.ancho,
          p.created_at,
          p.updated_at,
        ],
      });
      nP += Number(r.rowsAffected || 0);
    }
    console.log(`pasos: ${nU} users sincronizados, ${nP} pasos`);
    dbPasos.close();
  }

  console.log("OK: import local → Turso terminado.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
