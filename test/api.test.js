/**
 * Tests de API: solo-lectura, refresh flag, cron auth, health.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const fs = require("fs");

const { wantsRefresh, snapshotAgeMs, CACHE_TTL_MS } = require("../lib/snapshots");
const { assertCronAuth } = require("../routes/cron");

const testDir = path.join(__dirname, "_tmp_api");
const alturasPath = path.join(testDir, "alturas.sqlite");
const paraguayPath = path.join(testDir, "paraguay.sqlite");
const pasosPath = path.join(testDir, "pasos.sqlite");

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return res;
}

describe("snapshots helpers", () => {
  it("wantsRefresh detecta refresh=1 y refresh=true", () => {
    assert.equal(wantsRefresh({ query: { refresh: "1" } }), true);
    assert.equal(wantsRefresh({ query: { refresh: "true" } }), true);
    assert.equal(wantsRefresh({ query: {} }), false);
    assert.equal(wantsRefresh({ query: { refresh: "0" } }), false);
  });

  it("snapshotAgeMs calcula edad", () => {
    const past = new Date(Date.now() - 120000).toISOString();
    const age = snapshotAgeMs(past);
    assert.ok(age >= 110000 && age < 200000);
    assert.equal(snapshotAgeMs("no-es-fecha"), Infinity);
  });

  it("CACHE_TTL_MS es un número positivo", () => {
    assert.ok(Number.isFinite(CACHE_TTL_MS) && CACHE_TTL_MS > 0);
  });
});

describe("assertCronAuth", () => {
  const prev = process.env.CRON_SECRET;

  after(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it("503 si no hay CRON_SECRET", () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    const ok = assertCronAuth({ headers: {}, query: {} }, res);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 503);
  });

  it("401 con token incorrecto", () => {
    process.env.CRON_SECRET = "secreto-test";
    const res = mockRes();
    const ok = assertCronAuth(
      { headers: { authorization: "Bearer otro" }, query: {} },
      res
    );
    assert.equal(ok, false);
    assert.equal(res.statusCode, 401);
  });

  it("ok con Bearer correcto", () => {
    process.env.CRON_SECRET = "secreto-test";
    const res = mockRes();
    const ok = assertCronAuth(
      { headers: { authorization: "Bearer secreto-test" }, query: {} },
      res
    );
    assert.equal(ok, true);
  });
});

describe("API HTTP (health + data solo-lectura)", () => {
  let server;
  let baseUrl;
  let prevEnv;

  before(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    prevEnv = {
      SQLITE_PATH: process.env.SQLITE_PATH,
      PARAGUAY_SQLITE_PATH: process.env.PARAGUAY_SQLITE_PATH,
      PASOS_SQLITE_PATH: process.env.PASOS_SQLITE_PATH,
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      VERCEL: process.env.VERCEL,
      CRON_SECRET: process.env.CRON_SECRET,
      FETCH_TIMEOUT_MS: process.env.FETCH_TIMEOUT_MS,
      FETCH_RETRIES: process.env.FETCH_RETRIES,
    };
    process.env.SQLITE_PATH = alturasPath;
    process.env.PARAGUAY_SQLITE_PATH = paraguayPath;
    process.env.PASOS_SQLITE_PATH = pasosPath;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.VERCEL = "1";
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.FETCH_TIMEOUT_MS = "1500";
    process.env.FETCH_RETRIES = "1";

    delete require.cache[require.resolve("../lib/sqlDriver")];
    delete require.cache[require.resolve("../db")];
    delete require.cache[require.resolve("../dbPasos")];
    delete require.cache[require.resolve("../server")];
    delete require.cache[require.resolve("../routes/data")];
    delete require.cache[require.resolve("../routes/cron")];
    delete require.cache[require.resolve("../lib/syncSources")];
    delete require.cache[require.resolve("../lib/cronStatus")];
    delete require.cache[require.resolve("../lib/fetchSources")];
    delete require.cache[require.resolve("../lib/snapshots")];

    const { saveSnapshot, initDb, initDbParaguay } = require("../db");
    const { initDbPasos } = require("../dbPasos");
    await Promise.all([initDb(), initDbParaguay(), initDbPasos()]);
    await saveSnapshot("parana", new Date().toISOString(), {
      source: "test://parana",
      scrapedAt: new Date().toISOString(),
      count: 1,
      items: [{ puerto: "Test", rio: "Paraná", altura: "1.00" }],
      warnings: [],
    });

    const app = require("../server");
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [k, v] of Object.entries(prevEnv || {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("GET /api/health responde estructura enriquecida", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.service, "altura-rios-dashboard");
    assert.ok(data.backend === "sqlite-file" || data.backend === "turso");
    assert.ok(data.snapshots);
    assert.ok(data.snapshots.parana);
    assert.ok(data.snapshots.paraguay);
    assert.ok(Number.isFinite(data.cacheTtlMs));
  });

  it("GET /api/cron/sync sin auth → 401", async () => {
    const res = await fetch(`${baseUrl}/api/cron/sync`);
    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.ok, false);
  });

  it("GET /api/data sirve snapshot en caché (solo-lectura)", async () => {
    const res = await fetch(`${baseUrl}/api/data`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.cached, true);
    assert.ok(typeof data.cacheAgeMs === "number");
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items[0].puerto, "Test");
  });
});
