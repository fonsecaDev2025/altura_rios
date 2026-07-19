/**
 * Crea el esquema en Turso.
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrateTurso.js
 */
const { ensureSchema, backendLabel, useTurso } = require("../lib/sqlDriver");

async function main() {
  if (!useTurso()) {
    throw new Error("Definí TURSO_DATABASE_URL (y TURSO_AUTH_TOKEN) antes de migrar.");
  }
  console.log(`Migrando esquema → ${backendLabel()}`);
  await ensureSchema();
  console.log("OK: tablas creadas (alturas, paraguay, pasos/users/sessions).");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
