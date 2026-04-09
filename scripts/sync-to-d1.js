/**
 * Sincroniza datos de alturas (FICH + Paraguay DMH) a Cloudflare D1.
 * Se ejecuta una vez al día desde Render (cron job).
 *
 * Variables de entorno requeridas:
 *   CF_API_TOKEN        — Token de Cloudflare con permisos D1 edit
 *   CF_ACCOUNT_ID       — Account ID de Cloudflare
 *   CF_D1_DATABASE_ID   — UUID de la base D1
 *   API_BASE_URL        — URL base del backend (default: https://altura-rios.onrender.com)
 */

const API_BASE = (process.env.API_BASE_URL || "https://altura-rios.onrender.com").replace(/\/$/, "");
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "d9499103cc4d4926c16b60e7aaa9fa3e";
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID || "46b6e6ad-0671-4fa4-bf4d-6d1d30af3db3";

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;

if (!CF_API_TOKEN) {
  console.error("Falta CF_API_TOKEN. Crea un token en https://dash.cloudflare.com/profile/api-tokens con permiso D1 edit.");
  process.exit(1);
}

async function d1Query(sql, params = []) {
  const res = await fetch(D1_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join("; ") || "D1 query failed";
    throw new Error(`D1: ${msg}`);
  }
  return json.result;
}

async function d1Batch(statements) {
  const res = await fetch(D1_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch: statements }),
  });
  const json = await res.json();
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join("; ") || "D1 batch failed";
    throw new Error(`D1 batch: ${msg}`);
  }
  return json.result;
}

async function createTables() {
  await d1Batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS alturas_parana (
        fecha_sync TEXT NOT NULL,
        puerto TEXT NOT NULL,
        rio TEXT,
        altura TEXT,
        variacion TEXT,
        estado TEXT,
        altura_anterior TEXT,
        alerta TEXT,
        evacuacion TEXT,
        historico_href TEXT,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (fecha_sync, puerto)
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS rio_paraguay_dmh (
        fecha TEXT NOT NULL,
        localidad TEXT NOT NULL,
        nivel_del_dia TEXT,
        variacion_diaria TEXT,
        minimo_historico TEXT,
        maximo_historico TEXT,
        ver_mas_url TEXT,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (fecha, localidad)
      )`,
    },
  ]);
  console.log("[D1] Tablas verificadas/creadas.");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchEndpoint(path) {
  const url = `${API_BASE}${path}`;
  console.log(`[fetch] ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `ok=false en ${path}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function syncAlturas() {
  const data = await fetchEndpoint("/api/data");
  if (!data.items || !data.items.length) {
    console.log("[alturas] Sin items, nada que sincronizar.");
    return 0;
  }

  const fechaSync = todayISO();
  const syncedAt = new Date().toISOString();

  const stmts = data.items.map((row) => ({
    sql: `INSERT INTO alturas_parana (fecha_sync, puerto, rio, altura, variacion, estado, altura_anterior, alerta, evacuacion, historico_href, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fecha_sync, puerto) DO UPDATE SET
            rio=excluded.rio, altura=excluded.altura, variacion=excluded.variacion,
            estado=excluded.estado, altura_anterior=excluded.altura_anterior,
            alerta=excluded.alerta, evacuacion=excluded.evacuacion,
            historico_href=excluded.historico_href, synced_at=excluded.synced_at`,
    params: [
      fechaSync,
      row.puerto || "",
      row.rio || "",
      row.altura || "",
      row.variacion || "",
      row.estado || "",
      row.alturaAnterior || "",
      row.alerta || "",
      row.evacuacion || "",
      row.historicoHref || "",
      syncedAt,
    ],
  }));

  const BATCH_SIZE = 50;
  let total = 0;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const chunk = stmts.slice(i, i + BATCH_SIZE);
    await d1Batch(chunk);
    total += chunk.length;
    console.log(`[alturas] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} filas`);
  }

  return total;
}

async function syncParaguay() {
  const data = await fetchEndpoint("/api/rio-paraguay-dmh");
  if (!data.items || !data.items.length) {
    console.log("[paraguay] Sin items, nada que sincronizar.");
    return 0;
  }

  const syncedAt = new Date().toISOString();

  const stmts = data.items.map((row) => ({
    sql: `INSERT INTO rio_paraguay_dmh (fecha, localidad, nivel_del_dia, variacion_diaria, minimo_historico, maximo_historico, ver_mas_url, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fecha, localidad) DO UPDATE SET
            nivel_del_dia=excluded.nivel_del_dia, variacion_diaria=excluded.variacion_diaria,
            minimo_historico=excluded.minimo_historico, maximo_historico=excluded.maximo_historico,
            ver_mas_url=excluded.ver_mas_url, synced_at=excluded.synced_at`,
    params: [
      row.fecha || "",
      row.localidad || "",
      row.nivelDelDia || "",
      row.variacionDiaria || "",
      row.minimoHistoricoFecha || "",
      row.maximoHistoricoFecha || "",
      row.verMasUrl || "",
      syncedAt,
    ],
  }));

  await d1Batch(stmts);
  return stmts.length;
}

async function main() {
  console.log(`=== sync-to-d1 — ${new Date().toISOString()} ===`);
  console.log(`API: ${API_BASE}`);
  console.log(`D1: ${CF_D1_DATABASE_ID}`);

  await createTables();

  let alturasCount = 0;
  let paraguayCount = 0;

  try {
    alturasCount = await syncAlturas();
    console.log(`[alturas] ${alturasCount} filas sincronizadas a D1.`);
  } catch (e) {
    console.error("[alturas] ERROR:", e.message);
  }

  try {
    paraguayCount = await syncParaguay();
    console.log(`[paraguay] ${paraguayCount} filas sincronizadas a D1.`);
  } catch (e) {
    console.error("[paraguay] ERROR:", e.message);
  }

  console.log(`=== Fin: alturas=${alturasCount}, paraguay=${paraguayCount} ===`);

  if (alturasCount === 0 && paraguayCount === 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
