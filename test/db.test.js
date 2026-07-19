const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TEST_DATA_DIR = path.join(__dirname, "..", "data", "_test_tmp");
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "test_alturas.sqlite");
const TEST_PY_PATH = path.join(TEST_DATA_DIR, "test_paraguay.sqlite");

before(() => {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.SQLITE_PATH = TEST_DB_PATH;
  process.env.PARAGUAY_SQLITE_PATH = TEST_PY_PATH;
});

after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch (_e) {
    /* ok */
  }
});

let db;
function loadDb() {
  if (!db) {
    delete require.cache[require.resolve("../lib/sqlDriver")];
    delete require.cache[require.resolve("../db")];
    db = require("../db");
  }
  return db;
}

describe("initDb (alturas.sqlite)", () => {
  it("crea la base de datos sin error", async () => {
    const { initDb } = loadDb();
    const database = await initDb();
    assert.ok(database);
    assert.ok(fs.existsSync(TEST_DB_PATH));
  });

  it("es idempotente (llamar dos veces no falla)", async () => {
    const { initDb } = loadDb();
    await assert.doesNotReject(() => initDb());
  });
});

describe("saveUltimaExtraccionDelDia", () => {
  it("guarda filas correctamente", async () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      {
        puerto: "Santa Fe",
        altura: "3.20",
        variacion: "+0.05",
        estado: "Crece",
        alturaAnterior: "3.15",
      },
      {
        puerto: "Rosario",
        altura: "4.10",
        variacion: "-0.02",
        estado: "Baja",
        alturaAnterior: "4.12",
      },
    ];
    const result = await saveUltimaExtraccionDelDia(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 2);
    assert.ok(result.fechaDia);
    assert.ok(result.dbPath);
  });

  it("sobrescribe datos del mismo dia y puerto (upsert)", async () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      {
        puerto: "Santa Fe",
        altura: "3.30",
        variacion: "+0.10",
        estado: "Crece",
        alturaAnterior: "3.20",
      },
    ];
    const result = await saveUltimaExtraccionDelDia(items, "2026-05-08T18:00:00Z");
    assert.equal(result.rowsSaved, 1);
  });

  it("ignora filas sin puerto", async () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      { puerto: "", altura: "1.00", variacion: "0", estado: "", alturaAnterior: "" },
    ];
    const result = await saveUltimaExtraccionDelDia(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 0);
  });
});

describe("snapshots (caché)", () => {
  it("guarda y recupera el último snapshot por fuente", async () => {
    const { saveSnapshot, getLatestSnapshot } = loadDb();
    const payload = { source: "x", count: 2, items: [{ a: 1 }, { b: 2 }] };
    await saveSnapshot("parana", "2026-05-08T12:00:00Z", payload);
    const snap = await getLatestSnapshot("parana");
    assert.ok(snap);
    assert.equal(snap.scrapedAt, "2026-05-08T12:00:00Z");
    assert.deepEqual(snap.payload, payload);
  });

  it("devuelve el snapshot más reciente cuando hay varios", async () => {
    const { saveSnapshot, getLatestSnapshot } = loadDb();
    await saveSnapshot("parana", "2026-05-08T18:00:00Z", { count: 9 });
    const snap = await getLatestSnapshot("parana");
    assert.equal(snap.scrapedAt, "2026-05-08T18:00:00Z");
    assert.equal(snap.payload.count, 9);
  });

  it("aísla snapshots por fuente y devuelve null si no hay", async () => {
    const { getLatestSnapshot } = loadDb();
    assert.equal(await getLatestSnapshot("inexistente"), null);
  });
});

describe("initDbParaguay (paraguay_dmh.sqlite)", () => {
  it("crea la base de datos Paraguay sin error", async () => {
    const { initDbParaguay } = loadDb();
    const database = await initDbParaguay();
    assert.ok(database);
    assert.ok(fs.existsSync(TEST_PY_PATH));
  });
});

describe("saveParaguayExtraccion", () => {
  it("guarda estaciones correctamente", async () => {
    const { saveParaguayExtraccion } = loadDb();
    const items = [
      {
        localidad: "Asunción",
        fecha: "08-05-2026",
        nivelDelDia: "2.50",
        variacionDiaria: "+0.10",
        minimoHistoricoFecha: "-0.42 (2020)",
        maximoHistoricoFecha: "8.90 (1983)",
        verMasUrl: "https://example.com/detalle",
      },
    ];
    const result = await saveParaguayExtraccion(items, "2026-05-08T15:00:00Z");
    assert.equal(result.rowsSaved, 1);
    assert.ok(result.dbPath);
  });

  it("actualiza registros existentes (mismo fecha+localidad)", async () => {
    const { saveParaguayExtraccion } = loadDb();
    const items = [
      {
        localidad: "Asunción",
        fecha: "08-05-2026",
        nivelDelDia: "2.60",
        variacionDiaria: "+0.20",
        minimoHistoricoFecha: "-0.42 (2020)",
        maximoHistoricoFecha: "8.90 (1983)",
        verMasUrl: null,
      },
    ];
    const result = await saveParaguayExtraccion(items, "2026-05-08T20:00:00Z");
    assert.equal(result.rowsSaved, 1);
  });

  it("ignora filas sin localidad o fecha", async () => {
    const { saveParaguayExtraccion } = loadDb();
    const items = [
      { localidad: "", fecha: "08-05-2026", nivelDelDia: "1.0" },
      { localidad: "Test", fecha: "", nivelDelDia: "1.0" },
    ];
    const result = await saveParaguayExtraccion(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 0);
  });
});
