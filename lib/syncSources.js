/**
 * Sync scrape → DB + caché en memoria.
 */

const {
  saveUltimaExtraccionDelDia,
  saveSnapshot,
  getLatestSnapshot,
  saveParaguayExtraccion,
} = require("../db");
const { fetchAlturas, fetchRioParaguayDmh } = require("./fetchSources");
const {
  withSingleFlight,
  setCachedSnapshot,
  getMemSnapshot,
  snapshotAgeMs,
  jsonFromSnapshot,
  CACHE_TTL_MS,
  wantsRefresh,
} = require("./snapshots");

async function getCachedSnapshot(source) {
  let snap = getMemSnapshot(source);
  if (!snap) {
    try {
      snap = await getLatestSnapshot(source);
    } catch (e) {
      console.warn(`[cache ${source}] lectura DB falló:`, e.message);
      snap = null;
    }
    if (snap) setCachedSnapshot(source, snap.scrapedAt, snap.payload);
  }
  return snap || null;
}

async function syncParanaToDb() {
  const SOURCE = "parana";
  return withSingleFlight(SOURCE, async () => {
    const data = await fetchAlturas();
    let dbSaved = null;
    if (data.items && data.items.length > 0) {
      dbSaved = await saveUltimaExtraccionDelDia(data.items, data.scrapedAt);
    }
    try {
      await saveSnapshot(SOURCE, data.scrapedAt, data);
    } catch (snapErr) {
      console.warn("[cache parana] guardado falló:", snapErr.message);
    }
    setCachedSnapshot(SOURCE, data.scrapedAt, data);
    return {
      ok: true,
      count: (data.items && data.items.length) || 0,
      scrapedAt: data.scrapedAt,
      dbSaved,
      warnings: data.warnings || [],
    };
  });
}

async function syncParaguayToDb() {
  const SOURCE = "paraguay";
  return withSingleFlight(SOURCE, async () => {
    const data = await fetchRioParaguayDmh();
    let dbSaved = null;
    if (data.items && data.items.length > 0) {
      dbSaved = await saveParaguayExtraccion(data.items, data.scrapedAt);
    }
    try {
      await saveSnapshot(SOURCE, data.scrapedAt, data);
    } catch (snapErr) {
      console.warn("[cache paraguay] guardado falló:", snapErr.message);
    }
    setCachedSnapshot(SOURCE, data.scrapedAt, data);
    return {
      ok: true,
      count: (data.items && data.items.length) || 0,
      scrapedAt: data.scrapedAt,
      dbSaved,
      warnings: data.warnings || [],
    };
  });
}

/**
 * API solo-lectura: sirve snapshot de DB.
 * Scrape solo con ?refresh=1 (o cron). Si no hay snapshot, bootstrap scrape.
 */
async function serveSnapshotOrRefresh(req, res, { source, syncFn, logTag }) {
  if (wantsRefresh(req)) {
    try {
      const sync = await syncFn();
      if (sync.dbSaved && sync.dbSaved.rowsSaved > 0) {
        console.log(
          `[${logTag}] ${sync.dbSaved.rowsSaved} filas` +
            (sync.dbSaved.dbPath ? ` en ${sync.dbSaved.dbPath}` : "")
        );
      }
      const snap = getMemSnapshot(source);
      const data = (snap && snap.payload) || {};
      return res.json({
        ok: true,
        ...data,
        dbSaved: sync.dbSaved,
        cached: false,
      });
    } catch (err) {
      console.error(`[${logTag}] refresh`, err);
      try {
        const snap = await getCachedSnapshot(source);
        if (snap) {
          const ageMin = Math.round(snapshotAgeMs(snap.scrapedAt) / 60000);
          const payload = snap.payload || {};
          const warnings = Array.isArray(payload.warnings)
            ? payload.warnings.slice()
            : [];
          warnings.push(
            `No se pudo actualizar desde la fuente (${err.message}). Mostrando datos cacheados de hace ~${ageMin} min.`
          );
          return jsonFromSnapshot(res, snap, { warnings, stale: true });
        }
      } catch (e) {
        console.warn(`[cache ${source}] fallback falló:`, e.message);
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(500).json({
        ok: false,
        error: err.message || "Error al actualizar datos",
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  const snap = await getCachedSnapshot(source);
  if (snap) return jsonFromSnapshot(res, snap);

  try {
    const sync = await syncFn();
    const fresh = getMemSnapshot(source);
    const data = (fresh && fresh.payload) || {};
    return res.json({
      ok: true,
      ...data,
      dbSaved: sync.dbSaved,
      cached: false,
    });
  } catch (err) {
    console.error(`[${logTag}] bootstrap`, err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      ok: false,
      error:
        err.message ||
        "Sin datos en caché. Esperá el cron o usá ?refresh=1.",
      scrapedAt: new Date().toISOString(),
    });
  }
}

async function snapshotHealthInfo(source) {
  const snap = await getCachedSnapshot(source);
  if (!snap) {
    return { source, available: false, scrapedAt: null, ageMs: null, fresh: false };
  }
  const ageMs = snapshotAgeMs(snap.scrapedAt);
  return {
    source,
    available: true,
    scrapedAt: snap.scrapedAt,
    ageMs,
    fresh: ageMs < CACHE_TTL_MS,
    count: snap.payload && snap.payload.count,
  };
}

module.exports = {
  getCachedSnapshot,
  syncParanaToDb,
  syncParaguayToDb,
  serveSnapshotOrRefresh,
  snapshotHealthInfo,
};
