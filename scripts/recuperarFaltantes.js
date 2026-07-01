/**
 * Recupera (backfill) los días faltantes en las bases SQLite:
 *   - data/alturas.sqlite  (tabla extracciones_dia)
 *   - data/paraguay_dmh.sqlite (tabla rio_paraguay_dmh)
 *
 * Fuentes:
 *   - Puertos argentinos: histórico wfich (http://wfich1.unl.edu.ar/cim/rios/historico/<id>),
 *     con ~360 días. Los IDs salen del último snapshot `parana` en alturas.sqlite.
 *   - Paraguay (DMH): vermas_convencional.php?code=<code> — sólo últimos ~15 días por HTTP.
 *
 * No sobrescribe datos existentes (usa ON CONFLICT DO NOTHING). Es idempotente.
 *
 *   node scripts/recuperarFaltantes.js
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const { parseWfichHistorico } = require("../lib/wfichHistoricoParser");
const { parseVermasParaguay } = require("../lib/vermasParaguayParser");

const dbDir = path.join(__dirname, "..", "data");
const alturasPath =
  process.env.SQLITE_PATH || path.join(dbDir, "alturas.sqlite");
const paraguayPath =
  process.env.PARAGUAY_SQLITE_PATH || path.join(dbDir, "paraguay_dmh.sqlite");

const USER_AGENT = "Mozilla/5.0 (compatible; AlturaRiosRecupera/1.0)";
const REQ_TIMEOUT_MS = 45000;
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** fetch con reintentos ante errores transitorios de red. */
async function fetchText(url, intentos = 3) {
  let ultimoError;
  for (let i = 0; i < intentos; i += 1) {
    try {
      return await fetchTextOnce(url);
    } catch (e) {
      ultimoError = e;
      if (i < intentos - 1) await sleep(1500 * (i + 1));
    }
  }
  throw ultimoError;
}

/** Lista de fechas ISO entre min y max (inclusive). */
function rangoDeFechas(min, max) {
  const out = [];
  if (!min || !max) return out;
  const d = new Date(`${min}T00:00:00Z`);
  const end = new Date(`${max}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Descarga el histórico paginado de la DMH (vermas ?page=N, 15 por página,
 * más reciente primero) hasta cubrir hacia atrás la fecha `minNeededIso`.
 * El formulario "Desde/Hasta" de la DMH está roto, pero la paginación expone
 * todo el histórico server-side.
 */
async function fetchVermasHistorico(codeUrl, minNeededIso, maxPages = 20) {
  const all = [];
  const sep = codeUrl.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    let html;
    try {
      html = await fetchText(`${codeUrl}${sep}page=${page}`);
    } catch (e) {
      if (all.length) break;
      throw e;
    }
    const rows = parseVermasParaguay(html);
    if (!rows.length) break;
    all.push(...rows);
    const oldest = rows[rows.length - 1].fechaIso;
    if (oldest && oldest <= minNeededIso) break;
    await sleep(DELAY_MS);
  }
  return all;
}

/** Devuelve el set de fechas ISO faltantes dentro del rango [min, max]. */
function calcularFaltantes(fechasIso) {
  const present = new Set(fechasIso.filter(Boolean));
  if (present.size === 0) return { faltantes: [], min: null, max: null };
  const orden = [...present].sort();
  const min = orden[0];
  const max = orden[orden.length - 1];
  const faltantes = [];
  const d = new Date(`${min}T00:00:00Z`);
  const end = new Date(`${max}T00:00:00Z`);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (!present.has(iso)) faltantes.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { faltantes, min, max };
}

/** Deriva estado a partir de la variación (coma decimal). */
function estadoDesdeVariacion(variacion) {
  const s = String(variacion || "").trim();
  if (!s || s === "—" || s === "-") return "Estacionario";
  const num = parseFloat(s.replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(num)) return "Estacionario";
  if (num > 0) return "Crece";
  if (num < 0) return "Baja";
  return "Estacionario";
}

function normalizaEstado(estado, variacion) {
  const e = String(estado || "").trim();
  if (/^(Crece|Baja|Estacionario)$/i.test(e)) {
    return e.charAt(0).toUpperCase() + e.slice(1).toLowerCase();
  }
  return estadoDesdeVariacion(variacion);
}

function extractedAtFor(fechaIso, hora) {
  const h = /^\d{2}:\d{2}$/.test(String(hora || "").trim())
    ? `${hora}:00`
    : "12:00:00";
  return `${fechaIso}T${h}-03:00`;
}

async function main() {
  for (const p of [alturasPath, paraguayPath]) {
    if (!fs.existsSync(p)) throw new Error(`No existe la base: ${p}`);
    fs.accessSync(p, fs.constants.W_OK);
  }

  const dbA = new Database(alturasPath);
  const dbP = new Database(paraguayPath);
  dbA.pragma("busy_timeout = 5000");
  dbP.pragma("busy_timeout = 5000");

  // ---- Días faltantes actuales ----
  const alturasFechas = dbA
    .prepare("SELECT DISTINCT fecha_dia AS f FROM extracciones_dia")
    .all()
    .map((r) => r.f);
  const paraguayFechas = dbP
    .prepare("SELECT DISTINCT fecha_iso AS f FROM rio_paraguay_dmh WHERE fecha_iso IS NOT NULL")
    .all()
    .map((r) => r.f);

  const faltAlturas = calcularFaltantes(alturasFechas);
  const faltParaguay = calcularFaltantes(paraguayFechas);
  const setFaltParaguay = new Set(faltParaguay.faltantes);

  console.log(
    `alturas.sqlite   rango ${faltAlturas.min} -> ${faltAlturas.max}  faltan ${faltAlturas.faltantes.length}: ${faltAlturas.faltantes.join(", ") || "—"}`
  );
  console.log(
    `paraguay_dmh     rango ${faltParaguay.min} -> ${faltParaguay.max}  faltan ${faltParaguay.faltantes.length}: ${faltParaguay.faltantes.join(", ") || "—"}`
  );

  // ---- Statements de inserción (sin pisar) ----
  const insAltura = dbA.prepare(`
    INSERT INTO extracciones_dia (
      fecha_dia, puerto, ultimo_registro, variacion, estado, registro_anterior, extracted_at
    ) VALUES (
      @fecha_dia, @puerto, @ultimo_registro, @variacion, @estado, @registro_anterior, @extracted_at
    )
    ON CONFLICT(fecha_dia, puerto) DO NOTHING
  `);
  const insParaguay = dbP.prepare(`
    INSERT INTO rio_paraguay_dmh (
      fecha, fecha_iso, localidad, nivel_del_dia, variacion_diaria,
      minimo_historico, maximo_historico, ver_mas_url, extracted_at
    ) VALUES (
      @fecha, @fecha_iso, @localidad, @nivel_del_dia, @variacion_diaria,
      @minimo_historico, @maximo_historico, @ver_mas_url, @extracted_at
    )
    ON CONFLICT(fecha, localidad) DO NOTHING
  `);

  let insertAlturasCount = 0;
  let insertParaguayCount = 0;

  // Fechas existentes por puerto en alturas (para detectar huecos por puerto).
  const rangoAlturas = rangoDeFechas(faltAlturas.min, faltAlturas.max);
  const fechasPorPuerto = new Map();
  for (const row of dbA
    .prepare("SELECT puerto, fecha_dia FROM extracciones_dia")
    .all()) {
    if (!fechasPorPuerto.has(row.puerto)) fechasPorPuerto.set(row.puerto, new Set());
    fechasPorPuerto.get(row.puerto).add(row.fecha_dia);
  }
  const faltantesDePuerto = (puerto) => {
    const tiene = fechasPorPuerto.get(puerto) || new Set();
    return new Set(rangoAlturas.filter((d) => !tiene.has(d)));
  };

  // ===================================================================
  // 1) Puertos argentinos -> alturas.sqlite (histórico wfich)
  // ===================================================================
  {
    const snapRow = dbA
      .prepare(
        "SELECT payload_json FROM snapshots WHERE source='parana' ORDER BY scraped_at DESC LIMIT 1"
      )
      .get();

    let puertos = [];
    if (snapRow) {
      try {
        const payload = JSON.parse(snapRow.payload_json);
        for (const it of payload.items || []) {
          const m = /\/historico\/(\d+)/.exec(it.historicoHref || "");
          if (m && it.puerto) puertos.push({ puerto: it.puerto.trim(), id: m[1] });
        }
      } catch (e) {
        console.warn("No se pudo parsear snapshot parana:", e.message);
      }
    }
    console.log(`\nPuertos argentinos con histórico: ${puertos.length}`);

    for (const { puerto, id } of puertos) {
      const objetivo = faltantesDePuerto(puerto);
      if (objetivo.size === 0) continue;

      const url = `http://wfich1.unl.edu.ar/cim/rios/historico/${id}`;
      let html;
      try {
        html = await fetchText(url);
      } catch (e) {
        console.warn(`  [${puerto}] fallo al descargar histórico: ${e.message}`);
        await sleep(DELAY_MS);
        continue;
      }
      const rows = parseWfichHistorico(html);
      let n = 0;
      const tx = dbA.transaction((list) => {
        for (const r of list) {
          if (!objetivo.has(r.fechaIso)) continue;
          const info = insAltura.run({
            fecha_dia: r.fechaIso,
            puerto,
            ultimo_registro: r.altura || "",
            variacion: r.variacion || "",
            estado: normalizaEstado(r.estado, r.variacion),
            registro_anterior: r.alturaAnterior || "",
            extracted_at: extractedAtFor(r.fechaIso, r.hora),
          });
          n += info.changes;
        }
      });
      tx(rows);
      insertAlturasCount += n;
      if (n) console.log(`  [${puerto}] +${n} filas`);
      await sleep(DELAY_MS);
    }
  }

  // ===================================================================
  // 2) Localidades Paraguay -> paraguay_dmh.sqlite (+ alturas.sqlite)
  // ===================================================================
  const localidades = dbP
    .prepare(
      `SELECT localidad, ver_mas_url FROM rio_paraguay_dmh
       WHERE ver_mas_url <> '' GROUP BY localidad`
    )
    .all();
  console.log(`\nLocalidades Paraguay: ${localidades.length}`);

  const paraguayCubiertos = new Set();

  for (const { localidad, ver_mas_url } of localidades) {
    const objetivoLoc = faltantesDePuerto(localidad);
    const necesita = new Set([...setFaltParaguay, ...objetivoLoc]);
    if (necesita.size === 0) continue;
    const minNeeded = [...necesita].sort()[0];

    let rows;
    try {
      rows = await fetchVermasHistorico(ver_mas_url, minNeeded);
    } catch (e) {
      console.warn(`  [${localidad}] fallo al descargar vermas: ${e.message}`);
      await sleep(DELAY_MS);
      continue;
    }
    let nP = 0;
    let nA = 0;
    const tx = dbP.transaction((list) => {
      for (const r of list) {
        if (!setFaltParaguay.has(r.fechaIso)) continue;
        const info = insParaguay.run({
          fecha: r.fecha,
          fecha_iso: r.fechaIso,
          localidad,
          nivel_del_dia: r.nivel || "",
          variacion_diaria: "",
          minimo_historico: "",
          maximo_historico: "",
          ver_mas_url,
          extracted_at: extractedAtFor(r.fechaIso, null),
        });
        if (info.changes) {
          nP += info.changes;
          paraguayCubiertos.add(r.fechaIso);
        }
      }
    });
    tx(rows);

    // También rellenar la localidad en alturas.sqlite para días faltantes ahí.
    const txA = dbA.transaction((list) => {
      for (const r of list) {
        if (!objetivoLoc.has(r.fechaIso)) continue;
        const info = insAltura.run({
          fecha_dia: r.fechaIso,
          puerto: localidad,
          ultimo_registro: r.nivel || "",
          variacion: "",
          estado: "",
          registro_anterior: "",
          extracted_at: extractedAtFor(r.fechaIso, null),
        });
        nA += info.changes;
      }
    });
    txA(rows);

    insertParaguayCount += nP;
    insertAlturasCount += nA;
    if (nP || nA) console.log(`  [${localidad}] +${nP} paraguay, +${nA} alturas`);
    await sleep(DELAY_MS);
  }

  // ---- Resumen final ----
  const paraguayNoRecuperados = faltParaguay.faltantes.filter(
    (d) => !paraguayCubiertos.has(d)
  );

  const alturasFechas2 = dbA
    .prepare("SELECT DISTINCT fecha_dia AS f FROM extracciones_dia")
    .all()
    .map((r) => r.f);
  const paraguayFechas2 = dbP
    .prepare("SELECT DISTINCT fecha_iso AS f FROM rio_paraguay_dmh WHERE fecha_iso IS NOT NULL")
    .all()
    .map((r) => r.f);
  const faltA2 = calcularFaltantes(alturasFechas2);
  const faltP2 = calcularFaltantes(paraguayFechas2);

  dbA.pragma("wal_checkpoint(TRUNCATE)");
  dbP.pragma("wal_checkpoint(TRUNCATE)");
  dbA.close();
  dbP.close();

  console.log("\n================ RESUMEN ================");
  console.log(`Filas insertadas en alturas.sqlite:      ${insertAlturasCount}`);
  console.log(`Filas insertadas en paraguay_dmh.sqlite: ${insertParaguayCount}`);
  console.log(
    `alturas.sqlite   días faltantes ahora: ${faltA2.faltantes.length}: ${faltA2.faltantes.join(", ") || "—"}`
  );
  console.log(
    `paraguay_dmh     días faltantes ahora: ${faltP2.faltantes.length}: ${faltP2.faltantes.join(", ") || "—"}`
  );
  if (paraguayNoRecuperados.length) {
    console.log(
      `\nParaguay: días que la DMH no tiene en su histórico (no recuperables): ${paraguayNoRecuperados.join(", ")}`
    );
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});

main().catch((e) => {
  console.error(e.message || e);
  if (e.code === "SQLITE_READONLY" || e.code === "EACCES") {
    console.error(
      "\nPista: sin permiso de escritura en data/*.sqlite. Ej.:\n" +
        '  sudo chown "$USER:$USER" data/alturas.sqlite data/paraguay_dmh.sqlite\n' +
        "  chmod u+w data/alturas.sqlite data/paraguay_dmh.sqlite"
    );
  }
  process.exit(1);
});
