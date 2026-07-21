const express = require("express");
const { getSeriesAlturas, getSeriesParaguay } = require("../db");
const {
  syncParanaToDb,
  syncParaguayToDb,
  serveSnapshotOrRefresh,
  snapshotHealthInfo,
} = require("../lib/syncSources");
const { getLastCronStatus } = require("../lib/cronStatus");
const { CACHE_TTL_MS } = require("../lib/snapshots");

const router = express.Router();

router.get("/health", async (_req, res) => {
  try {
    const [parana, paraguay, lastCron] = await Promise.all([
      snapshotHealthInfo("parana"),
      snapshotHealthInfo("paraguay"),
      getLastCronStatus(),
    ]);
    const snapshotsOk = parana.available && paraguay.available;
    const cronOk = !lastCron || lastCron.ok !== false;
    res.json({
      ok: snapshotsOk && cronOk,
      service: "altura-rios-dashboard",
      backend: process.env.TURSO_DATABASE_URL ? "turso" : "sqlite-file",
      cacheTtlMs: CACHE_TTL_MS,
      snapshots: { parana, paraguay },
      lastCron,
    });
  } catch (err) {
    console.error("[/api/health]", err);
    res.status(500).json({
      ok: false,
      service: "altura-rios-dashboard",
      error: err.message || "Error en health",
    });
  }
});

router.get("/data", async (req, res) => {
  await serveSnapshotOrRefresh(req, res, {
    source: "parana",
    syncFn: syncParanaToDb,
    logTag: "/api/data",
  });
});

router.get("/rio-paraguay-dmh", async (req, res) => {
  await serveSnapshotOrRefresh(req, res, {
    source: "paraguay",
    syncFn: syncParaguayToDb,
    logTag: "/api/rio-paraguay-dmh",
  });
});

router.get("/series", async (req, res) => {
  try {
    const source = String(req.query.source || "parana").toLowerCase();
    const dias = Math.max(1, Math.min(90, Number(req.query.dias) || 14));
    const series =
      source === "paraguay"
        ? await getSeriesParaguay(dias)
        : await getSeriesAlturas(dias);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ ok: true, source, dias, series });
  } catch (err) {
    console.error("[/api/series]", err);
    res.status(500).json({
      ok: false,
      error: err.message || "No se pudieron leer las series",
    });
  }
});

module.exports = router;
