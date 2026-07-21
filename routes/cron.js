const express = require("express");
const { syncParanaToDb, syncParaguayToDb } = require("../lib/syncSources");
const { recordCronRun } = require("../lib/cronStatus");

const router = express.Router();

function assertCronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: "CRON_SECRET no configurado" });
    return false;
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || String(req.query.secret || "");
  if (!token || token !== secret) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return false;
  }
  return true;
}

router.get("/sync", async (req, res) => {
  if (!assertCronAuth(req, res)) return;
  const startedAt = new Date().toISOString();
  const result = {
    ok: true,
    startedAt,
    backend: process.env.TURSO_DATABASE_URL ? "turso" : "sqlite-file",
  };
  const [paranaSettled, paraguaySettled] = await Promise.allSettled([
    syncParanaToDb(),
    syncParaguayToDb(),
  ]);
  if (paranaSettled.status === "fulfilled") {
    result.parana = paranaSettled.value;
  } else {
    console.error("[/api/cron/sync parana]", paranaSettled.reason);
    result.parana = {
      ok: false,
      error:
        (paranaSettled.reason && paranaSettled.reason.message) ||
        String(paranaSettled.reason),
    };
    result.ok = false;
  }
  if (paraguaySettled.status === "fulfilled") {
    result.paraguay = paraguaySettled.value;
  } else {
    console.error("[/api/cron/sync paraguay]", paraguaySettled.reason);
    result.paraguay = {
      ok: false,
      error:
        (paraguaySettled.reason && paraguaySettled.reason.message) ||
        String(paraguaySettled.reason),
    };
    result.ok = false;
  }
  result.finishedAt = new Date().toISOString();
  await recordCronRun(result);
  res.status(result.ok ? 200 : 502).json(result);
});

module.exports = router;
module.exports.assertCronAuth = assertCronAuth;
