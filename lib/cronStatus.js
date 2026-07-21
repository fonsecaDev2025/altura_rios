/**
 * Persistencia del último resultado de /api/cron/sync (vía snapshots).
 */

const { saveSnapshot, getLatestSnapshot } = require("../db");

const CRON_SOURCE = "cron_status";

async function recordCronRun(result) {
  const finishedAt = result.finishedAt || new Date().toISOString();
  try {
    await saveSnapshot(CRON_SOURCE, finishedAt, result);
  } catch (e) {
    console.warn("[cron_status] no se pudo guardar:", e.message);
  }
  return result;
}

async function getLastCronStatus() {
  try {
    const snap = await getLatestSnapshot(CRON_SOURCE);
    if (!snap || !snap.payload) return null;
    return {
      ...snap.payload,
      recordedAt: snap.scrapedAt,
    };
  } catch (e) {
    console.warn("[cron_status] lectura falló:", e.message);
    return null;
  }
}

module.exports = {
  CRON_SOURCE,
  recordCronRun,
  getLastCronStatus,
};
