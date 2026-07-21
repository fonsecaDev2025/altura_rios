/**
 * Caché en memoria + utilidades de snapshot (API solo-lectura).
 */

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 24 * 60 * 60 * 1000;

const memSnapshots = new Map(); // source -> { scrapedAt, payload }
const inFlightSync = new Map(); // source -> Promise

function snapshotAgeMs(scrapedAtIso) {
  const t = Date.parse(scrapedAtIso);
  return Number.isNaN(t) ? Infinity : Date.now() - t;
}

function wantsRefresh(req) {
  const v = req.query.refresh;
  return v === "1" || v === "true";
}

function setCachedSnapshot(source, scrapedAt, payload) {
  memSnapshots.set(source, { scrapedAt, payload });
}

function getMemSnapshot(source) {
  return memSnapshots.get(source) || null;
}

/** Ejecuta fn una sola vez por source mientras esté en vuelo. */
function withSingleFlight(source, fn) {
  const existing = inFlightSync.get(source);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (inFlightSync.get(source) === promise) inFlightSync.delete(source);
    });
  inFlightSync.set(source, promise);
  return promise;
}

function jsonFromSnapshot(res, snap, extras = {}) {
  const age = snapshotAgeMs(snap.scrapedAt);
  return res.json({
    ok: true,
    ...(snap.payload || {}),
    cached: true,
    cacheAgeMs: age,
    cacheFresh: age < CACHE_TTL_MS,
    ...extras,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  CACHE_TTL_MS,
  memSnapshots,
  snapshotAgeMs,
  wantsRefresh,
  setCachedSnapshot,
  getMemSnapshot,
  withSingleFlight,
  jsonFromSnapshot,
  sleep,
};
