/**
 * Recupera (backfill) los días faltantes:
 *   - Local/Render: data/alturas.sqlite + data/paraguay_dmh.sqlite
 *   - Vercel/Turso: misma lógica si hay TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)
 *
 * Fuentes:
 *   - Puertos argentinos: histórico wfich (.../historico/<id>), ~360 días.
 *   - Paraguay (DMH): vermas_convencional.php?code=...&page=N
 *
 * Detecta huecos por puerto/localidad. Idempotente (ON CONFLICT DO NOTHING).
 *
 *   npm run recuperar:faltantes
 *   FECHA=2026-07-16 npm run recuperar:faltantes
 *
 * Contra Turso (producción Vercel):
 *   npx vercel env pull .env.local
 *   npm run recuperar:faltantes
 *   # o: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run recuperar:faltantes
 */

const fs = require("fs");
const path = require("path");

loadEnvFiles();

const {
  useTurso,
  ensureSchema,
  all,
  get,
  run,
  backendLabel,
  defaultPaths,
} = require("../lib/sqlDriver");

const { parseWfichHistorico } = require("../lib/wfichHistoricoParser");
const { parseVermasParaguay } = require("../lib/vermasParaguayParser");

const USER_AGENT = "Mozilla/5.0 (compatible; AlturaRiosRecupera/1.0)";
const REQ_TIMEOUT_MS = 45000;
const DELAY_MS = 300;

const SQL_INS_ALTURA = `
  INSERT INTO extracciones_dia (
    fecha_dia, puerto, ultimo_registro, variacion, estado, registro_anterior, extracted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(fecha_dia, puerto) DO NOTHING
`;

const SQL_INS_PARAGUAY = `
  INSERT INTO rio_paraguay_dmh (
    fecha, fecha_iso, localidad, nivel_del_dia, variacion_diaria,
    minimo_historico, maximo_historico, ver_mas_url, extracted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(fecha, localidad) DO NOTHING
`;

function unquote(val) {
  let v = String(val ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Carga .env y .env.local sin pisar variables ya definidas en el entorno. */
function loadEnvFiles() {
  const root = path.join(__dirname, "..");
  for (const name of [".env", ".env.local"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = unquote(trimmed.slice(eq + 1));
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
  // Vercel env pull deja comillas; limpiar aunque ya estuvieran en process.env.
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "CRON_SECRET"]) {
    if (process.env[key] !== undefined) process.env[key] = unquote(process.env[key]);
  }
}

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

async function fetchVermasHistorico(codeUrl, minNeededIso, maxPages = 20) {
  const allRows = [];
  const sep = codeUrl.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    let html;
    try {
      html = await fetchText(`${codeUrl}${sep}page=${page}`);
    } catch (e) {
      if (allRows.length) break;
      throw e;
    }
    const rows = parseVermasParaguay(html);
    if (!rows.length) break;
    allRows.push(...rows);
    const oldest = rows[rows.length - 1].fechaIso;
    if (oldest && oldest <= minNeededIso) break;
    await sleep(DELAY_MS);
  }
  return allRows;
}

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

function parseFechaArg(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`Fecha inválida: ${s} (use YYYY-MM-DD o DD-MM-YYYY)`);
}

function assertLocalFilesWritable() {
  const paths = defaultPaths();
  for (const p of [paths.alturas, paths.paraguay]) {
    if (!fs.existsSync(p)) throw new Error(`No existe la base: ${p}`);
    fs.accessSync(p, fs.constants.W_OK);
  }
}

async function main() {
  const turso = useTurso();
  if (turso) {
    if (!process.env.TURSO_AUTH_TOKEN) {
      throw new Error(
        "TURSO_DATABASE_URL está definida pero falta TURSO_AUTH_TOKEN.\n" +
          "  npx vercel env pull .env.local\n" +
          "  npm run recuperar:faltantes"
      );
    }
  } else {
    assertLocalFilesWritable();
  }

  await ensureSchema();

  const fechaForzada = parseFechaArg(process.env.FECHA || process.argv[2] || "");
  if (fechaForzada) console.log(`Modo fecha forzada: ${fechaForzada}`);
  console.log(`Backend: ${backendLabel()}${turso ? " (producción Vercel)" : " (archivos locales)"}`);

  const alturasFechas = (
    await all("alturas", "SELECT DISTINCT fecha_dia AS f FROM extracciones_dia")
  ).map((r) => r.f);
  const paraguayFechas = (
    await all(
      "paraguay",
      "SELECT DISTINCT fecha_iso AS f FROM rio_paraguay_dmh WHERE fecha_iso IS NOT NULL"
    )
  ).map((r) => r.f);

  const faltAlturas = calcularFaltantes(alturasFechas);
  const faltParaguay = calcularFaltantes(paraguayFechas);
  const setFaltParaguayGlobal = new Set(faltParaguay.faltantes);
  if (fechaForzada) setFaltParaguayGlobal.add(fechaForzada);

  console.log(
    `alturas   rango ${faltAlturas.min} -> ${faltAlturas.max}  faltan ${faltAlturas.faltantes.length}: ${faltAlturas.faltantes.join(", ") || "—"}`
  );
  console.log(
    `paraguay  rango ${faltParaguay.min} -> ${faltParaguay.max}  faltan (globales) ${faltParaguay.faltantes.length}: ${faltParaguay.faltantes.join(", ") || "—"}`
  );

  let insertAlturasCount = 0;
  let insertParaguayCount = 0;

  const rangoAlturas = rangoDeFechas(faltAlturas.min, faltAlturas.max);
  const fechasPorPuerto = new Map();
  for (const row of await all(
    "alturas",
    "SELECT puerto, fecha_dia FROM extracciones_dia"
  )) {
    if (!fechasPorPuerto.has(row.puerto)) fechasPorPuerto.set(row.puerto, new Set());
    fechasPorPuerto.get(row.puerto).add(row.fecha_dia);
  }
  const faltantesDePuerto = (puerto) => {
    const tiene = fechasPorPuerto.get(puerto) || new Set();
    const faltan = rangoAlturas.filter((d) => !tiene.has(d));
    if (fechaForzada && !tiene.has(fechaForzada)) faltan.push(fechaForzada);
    return new Set(faltan);
  };

  // 1) Puertos argentinos (histórico wfich)
  {
    const snapRow = await get(
      "alturas",
      "SELECT payload_json FROM snapshots WHERE source='parana' ORDER BY scraped_at DESC LIMIT 1"
    );

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
      for (const r of rows) {
        if (!objetivo.has(r.fechaIso)) continue;
        const info = await run("alturas", SQL_INS_ALTURA, [
          r.fechaIso,
          puerto,
          r.altura || "",
          r.variacion || "",
          normalizaEstado(r.estado, r.variacion),
          r.alturaAnterior || "",
          extractedAtFor(r.fechaIso, r.hora),
        ]);
        if (info.changes) {
          n += info.changes;
          if (!fechasPorPuerto.has(puerto)) fechasPorPuerto.set(puerto, new Set());
          fechasPorPuerto.get(puerto).add(r.fechaIso);
        }
      }
      insertAlturasCount += n;
      if (n) console.log(`  [${puerto}] +${n} filas`);
      await sleep(DELAY_MS);
    }
  }

  // 2) Localidades Paraguay
  const rangoParaguay = rangoDeFechas(faltParaguay.min, faltParaguay.max);
  const fechasPorLocalidad = new Map();
  for (const row of await all(
    "paraguay",
    "SELECT localidad, fecha_iso FROM rio_paraguay_dmh WHERE fecha_iso IS NOT NULL"
  )) {
    if (!fechasPorLocalidad.has(row.localidad)) {
      fechasPorLocalidad.set(row.localidad, new Set());
    }
    fechasPorLocalidad.get(row.localidad).add(row.fecha_iso);
  }
  const faltantesDeLocalidad = (localidad) => {
    const tiene = fechasPorLocalidad.get(localidad) || new Set();
    const faltan = rangoParaguay.filter((d) => !tiene.has(d));
    if (fechaForzada && !tiene.has(fechaForzada)) faltan.push(fechaForzada);
    return new Set(faltan);
  };

  const localidades = await all(
    "paraguay",
    `SELECT localidad, ver_mas_url FROM rio_paraguay_dmh
     WHERE ver_mas_url <> '' GROUP BY localidad`
  );
  console.log(`\nLocalidades Paraguay: ${localidades.length}`);

  const paraguayCubiertos = new Set();
  let paraguayHuecosPorLoc = 0;

  for (const { localidad, ver_mas_url } of localidades) {
    const faltParaguayLoc = faltantesDeLocalidad(localidad);
    const objetivoLocAlturas = faltantesDePuerto(localidad);
    paraguayHuecosPorLoc += faltParaguayLoc.size;
    const necesita = new Set([...faltParaguayLoc, ...objetivoLocAlturas]);
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
    for (const r of rows) {
      if (faltParaguayLoc.has(r.fechaIso)) {
        const info = await run("paraguay", SQL_INS_PARAGUAY, [
          r.fecha,
          r.fechaIso,
          localidad,
          r.nivel || "",
          "",
          "",
          "",
          ver_mas_url,
          extractedAtFor(r.fechaIso, null),
        ]);
        if (info.changes) {
          nP += info.changes;
          paraguayCubiertos.add(r.fechaIso);
          if (!fechasPorLocalidad.has(localidad)) {
            fechasPorLocalidad.set(localidad, new Set());
          }
          fechasPorLocalidad.get(localidad).add(r.fechaIso);
        }
      }
      if (objetivoLocAlturas.has(r.fechaIso)) {
        const info = await run("alturas", SQL_INS_ALTURA, [
          r.fechaIso,
          localidad,
          r.nivel || "",
          "",
          "",
          "",
          extractedAtFor(r.fechaIso, null),
        ]);
        if (info.changes) {
          nA += info.changes;
          if (!fechasPorPuerto.has(localidad)) {
            fechasPorPuerto.set(localidad, new Set());
          }
          fechasPorPuerto.get(localidad).add(r.fechaIso);
        }
      }
    }

    insertParaguayCount += nP;
    insertAlturasCount += nA;
    if (nP || nA) console.log(`  [${localidad}] +${nP} paraguay, +${nA} alturas`);
    await sleep(DELAY_MS);
  }

  if (paraguayHuecosPorLoc) {
    console.log(
      `(paraguay: ${paraguayHuecosPorLoc} huecos localidad×día a rellenar antes de fetch)`
    );
  }

  const paraguayNoRecuperados = [...setFaltParaguayGlobal].filter(
    (d) => !paraguayCubiertos.has(d)
  );

  const alturasFechas2 = (
    await all("alturas", "SELECT DISTINCT fecha_dia AS f FROM extracciones_dia")
  ).map((r) => r.f);
  const paraguayFechas2 = (
    await all(
      "paraguay",
      "SELECT DISTINCT fecha_iso AS f FROM rio_paraguay_dmh WHERE fecha_iso IS NOT NULL"
    )
  ).map((r) => r.f);
  const faltA2 = calcularFaltantes(alturasFechas2);
  const faltP2 = calcularFaltantes(paraguayFechas2);

  const faltLocRestantes = [];
  const locsFinal = await all(
    "paraguay",
    `SELECT localidad FROM rio_paraguay_dmh WHERE ver_mas_url <> '' GROUP BY localidad`
  );
  for (const { localidad } of locsFinal) {
    const tiene = new Set(
      (
        await all(
          "paraguay",
          "SELECT fecha_iso FROM rio_paraguay_dmh WHERE localidad=? AND fecha_iso IS NOT NULL",
          [localidad]
        )
      ).map((r) => r.fecha_iso)
    );
    for (const d of rangoDeFechas(faltP2.min, faltP2.max)) {
      if (!tiene.has(d)) faltLocRestantes.push(`${localidad}:${d}`);
    }
  }

  const labelAlturas = turso ? "Turso/extracciones_dia" : "alturas.sqlite";
  const labelParaguay = turso ? "Turso/rio_paraguay_dmh" : "paraguay_dmh.sqlite";

  console.log("\n================ RESUMEN ================");
  console.log(`Filas insertadas en ${labelAlturas}:      ${insertAlturasCount}`);
  console.log(`Filas insertadas en ${labelParaguay}: ${insertParaguayCount}`);
  console.log(
    `alturas   días faltantes ahora: ${faltA2.faltantes.length}: ${faltA2.faltantes.join(", ") || "—"}`
  );
  console.log(
    `paraguay  días faltantes ahora (globales): ${faltP2.faltantes.length}: ${faltP2.faltantes.join(", ") || "—"}`
  );
  if (faltLocRestantes.length) {
    console.log(
      `paraguay  huecos localidad×día restantes: ${faltLocRestantes.length}`
    );
    console.log(
      `  (muestra) ${faltLocRestantes.slice(0, 12).join(", ")}${faltLocRestantes.length > 12 ? "…" : ""}`
    );
  } else {
    console.log("paraguay  huecos localidad×día restantes: 0");
  }

  if (paraguayNoRecuperados.length) {
    console.log(
      `\nParaguay: días globales que la DMH no entregó en esta corrida: ${paraguayNoRecuperados.join(", ")}`
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
