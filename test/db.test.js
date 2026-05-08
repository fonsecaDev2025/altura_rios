const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TEST_DATA_DIR = path.join(__dirname, "..", "data", "_test_tmp");
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "test_alturas.sqlite");
const TEST_PY_PATH = path.join(TEST_DATA_DIR, "test_paraguay.sqlite");

before(() => {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  // Apuntar las rutas a archivos temporales
  process.env.SQLITE_PATH = TEST_DB_PATH;
  process.env.PARAGUAY_SQLITE_PATH = TEST_PY_PATH;
});

after(() => {
  // Limpiar archivos de test
  try { fs.unlinkSync(TEST_DB_PATH); } catch (_e) { /* ok */ }
  try { fs.unlinkSync(TEST_PY_PATH); } catch (_e) { /* ok */ }
  try { fs.rmdirSync(TEST_DATA_DIR); } catch (_e) { /* ok */ }
});

// Requiere db.js DESPUÉS de establecer env vars
let db;
function loadDb() {
  if (!db) {
    delete require.cache[require.resolve("../db")];
    db = require("../db");
  }
  return db;
}

describe("initDb (alturas.sqlite)", () => {
  it("crea la base de datos sin error", () => {
    const { initDb } = loadDb();
    const database = initDb();
    assert.ok(database);
    assert.ok(fs.existsSync(TEST_DB_PATH));
  });

  it("es idempotente (llamar dos veces no falla)", () => {
    const { initDb } = loadDb();
    assert.doesNotThrow(() => initDb());
  });
});

describe("saveUltimaExtraccionDelDia", () => {
  it("guarda filas correctamente", () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      { puerto: "Santa Fe", altura: "3.20", variacion: "+0.05", estado: "Crece", alturaAnterior: "3.15" },
      { puerto: "Rosario", altura: "4.10", variacion: "-0.02", estado: "Baja", alturaAnterior: "4.12" },
    ];
    const result = saveUltimaExtraccionDelDia(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 2);
    assert.ok(result.fechaDia);
    assert.ok(result.dbPath);
  });

  it("sobrescribe datos del mismo dia y puerto (upsert)", () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      { puerto: "Santa Fe", altura: "3.30", variacion: "+0.10", estado: "Crece", alturaAnterior: "3.20" },
    ];
    const result = saveUltimaExtraccionDelDia(items, "2026-05-08T18:00:00Z");
    assert.equal(result.rowsSaved, 1);
  });

  it("ignora filas sin puerto", () => {
    const { saveUltimaExtraccionDelDia } = loadDb();
    const items = [
      { puerto: "", altura: "1.00", variacion: "0", estado: "", alturaAnterior: "" },
    ];
    const result = saveUltimaExtraccionDelDia(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 0);
  });
});

describe("initDbParaguay (paraguay_dmh.sqlite)", () => {
  it("crea la base de datos Paraguay sin error", () => {
    const { initDbParaguay } = loadDb();
    const database = initDbParaguay();
    assert.ok(database);
    assert.ok(fs.existsSync(TEST_PY_PATH));
  });
});

describe("saveParaguayExtraccion", () => {
  it("guarda estaciones correctamente", () => {
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
    const result = saveParaguayExtraccion(items, "2026-05-08T15:00:00Z");
    assert.equal(result.rowsSaved, 1);
    assert.ok(result.dbPath);
  });

  it("actualiza registros existentes (mismo fecha+localidad)", () => {
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
    const result = saveParaguayExtraccion(items, "2026-05-08T20:00:00Z");
    assert.equal(result.rowsSaved, 1);
  });

  it("ignora filas sin localidad o fecha", () => {
    const { saveParaguayExtraccion } = loadDb();
    const items = [
      { localidad: "", fecha: "08-05-2026", nivelDelDia: "1.0" },
      { localidad: "Test", fecha: "", nivelDelDia: "1.0" },
    ];
    const result = saveParaguayExtraccion(items, "2026-05-08T12:00:00Z");
    assert.equal(result.rowsSaved, 0);
  });
});
