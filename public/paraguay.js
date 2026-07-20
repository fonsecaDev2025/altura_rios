/**
 * Vista Río Paraguay: GET /api/rio-paraguay-dmh + /api/series
 */

function apiParaguayUrl(forceRefresh = false) {
  const base = UI.apiUrl("/api/rio-paraguay-dmh");
  if (!forceRefresh) return base;
  return base + (base.includes("?") ? "&" : "?") + "refresh=1";
}

const el = {
  statusPanel: document.getElementById("status-panel"),
  statusText: document.getElementById("status-text"),
  btnRefresh: document.getElementById("btn-refresh"),
  metaSection: document.getElementById("meta-section"),
  metaTime: document.getElementById("meta-time"),
  metaCount: document.getElementById("meta-count"),
  metaDbChip: document.getElementById("meta-db-chip"),
  metaDb: document.getElementById("meta-db"),
  warningsBlock: document.getElementById("warnings-block"),
  warningsList: document.getElementById("warnings-list"),
  toolbar: document.getElementById("toolbar"),
  filterInput: document.getElementById("filter-input"),
  tableRoot: document.getElementById("table-root"),
};

let lastItems = [];
let seriesByLoc = {};
const coldStart = UI.createColdStartWatcher(el.statusText, 8000);
const FETCH_MS = 60000;

function setLoading(on) {
  el.btnRefresh.disabled = on;
  el.statusPanel.classList.toggle("status--loading", on);
  if (on) {
    el.statusText.textContent = "Obteniendo datos…";
    el.tableRoot.innerHTML = UI.skeletonRows(8, 9);
    coldStart.start();
  } else {
    coldStart.clear();
  }
}

function setError(msg) {
  el.statusPanel.classList.add("status--error");
  el.statusText.textContent = msg;
}

function clearError() {
  el.statusPanel.classList.remove("status--error");
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function renderWarnings(list) {
  if (!list || !list.length) {
    el.warningsBlock.hidden = true;
    el.warningsList.innerHTML = "";
    return;
  }
  el.warningsBlock.hidden = false;
  el.warningsList.innerHTML = list.map((w) => `<li>${UI.escapeHtml(w)}</li>`).join("");
}

function tendenciaFromVariacion(v) {
  const n = UI.parseNum(v);
  if (n == null) return { label: "—", cls: "estado estado--neutral" };
  if (n > 0) return { label: "Crece", cls: "estado estado--crece" };
  if (n < 0) return { label: "Baja", cls: "estado estado--baja" };
  return { label: "Estacionario", cls: "estado estado--estac" };
}

/** "20-07-2026" → "2026-07-20" */
function fechaDmYToIso(fecha) {
  const m = String(fecha || "")
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Variación DMH suele venir en cm ("-1 cm"); devolver metros. */
function parseVariacionMetros(variacion) {
  const s = String(variacion || "").trim();
  const n = UI.parseNum(s);
  if (n == null) return null;
  if (/\bcm\b/i.test(s)) return n / 100;
  return n;
}

function formatAlturaM(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const t = Math.round(n * 100) / 100;
  return `${t.toFixed(2)} m`;
}

/** Preferir el registro del día previo en serie; fallback: altura − variación (cm→m). */
function alturaAnteriorFor(row) {
  const fechaIso = fechaDmYToIso(row.fecha);
  const pts = seriesByLoc[row.localidad] || [];
  if (pts.length && fechaIso) {
    let prev = null;
    for (const p of pts) {
      if (p.fecha && p.fecha < fechaIso) prev = p;
    }
    if (prev && prev.altura) return String(prev.altura).trim();
  } else if (pts.length >= 2) {
    const ant = pts[pts.length - 2];
    if (ant && ant.altura) return String(ant.altura).trim();
  }

  const h = UI.parseNum(row.nivelDelDia);
  const v = parseVariacionMetros(row.variacionDiaria);
  if (h == null || v == null) return "—";
  return formatAlturaM(h - v);
}

function renderTable() {
  const q = (el.filterInput.value || "").trim().toLowerCase();
  const items = lastItems.filter((row) => {
    if (!q) return true;
    return String(row.localidad || "")
      .toLowerCase()
      .includes(q);
  });

  if (!lastItems.length) {
    el.tableRoot.innerHTML =
      '<p class="empty">No hay filas para Río Paraguay.</p>';
    el.toolbar.hidden = true;
    return;
  }

  el.toolbar.hidden = false;

  const head = `
    <table class="data-table">
      <caption class="sr-only">Niveles del Río Paraguay (DMH)</caption>
      <thead>
        <tr>
          <th scope="col">Puerto</th>
          <th scope="col">Río</th>
          <th scope="col">Altura</th>
          <th scope="col">Variación</th>
          <th scope="col">Tendencia</th>
          <th scope="col">Umbral</th>
          <th scope="col">Evolución</th>
          <th scope="col">Alt. anterior</th>
          <th scope="col">Histórico</th>
        </tr>
      </thead>
      <tbody>`;

  const body = items
    .map((row) => {
      const t = tendenciaFromVariacion(row.variacionDiaria);
      const level = "sin-dato";
      const spark = UI.sparklineSvg(seriesByLoc[row.localidad] || []);
      const altAnt = alturaAnteriorFor(row);
      const hist = row.verMasUrl
        ? `<a href="${UI.escapeHtml(row.verMasUrl)}" target="_blank" rel="noopener noreferrer" class="link-hist">Ver histórico de ${UI.escapeHtml(row.localidad)}</a>`
        : "—";
      return `
        <tr>
          <td data-label="Puerto" class="col-puerto">${UI.escapeHtml(row.localidad)}</td>
          <td data-label="Río">Paraguay</td>
          <td data-label="Altura" class="num">${UI.escapeHtml(row.nivelDelDia)}</td>
          <td data-label="Variación" class="num">${UI.escapeHtml(row.variacionDiaria)}</td>
          <td data-label="Tendencia"><span class="${t.cls}">${t.label}</span></td>
          <td data-label="Umbral"><span class="umbral umbral--${level}" title="Sin umbrales (DMH no publica alerta/evacuación)">${UI.umbralLabel(level)}</span></td>
          <td data-label="Evolución">${spark}</td>
          <td data-label="Alt. ant." class="num">${UI.escapeHtml(altAnt)}</td>
          <td data-label="Histórico">${hist}</td>
        </tr>`;
    })
    .join("");

  const emptyFilter =
    items.length === 0 && q
      ? `<p class="empty empty--inline">Ningún resultado para «${UI.escapeHtml(q)}».</p>`
      : "";

  el.tableRoot.innerHTML = `<div class="table-scroll">${head}${body}</tbody></table></div>${emptyFilter}`;
}

async function fetchSeries() {
  try {
    const res = await UI.fetchWithTimeout(
      UI.apiUrl("/api/series?source=paraguay&dias=14"),
      {},
      20000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.series) {
      seriesByLoc = data.series;
      return true;
    }
  } catch (e) {
    console.warn("[series paraguay]", e);
  }
  return false;
}

async function load(forceRefresh = false) {
  setLoading(true);
  clearError();
  try {
    const [dataRes] = await Promise.all([
      UI.fetchWithTimeout(apiParaguayUrl(forceRefresh), {}, FETCH_MS),
      fetchSeries(),
    ]);
    const data = await dataRes.json().catch(() => ({}));
    if (!dataRes.ok || data.ok === false) {
      setError(
        data.error ||
          (typeof formatApiHttpError !== "undefined"
            ? formatApiHttpError(dataRes.status, "/api/rio-paraguay-dmh")
            : `Error HTTP ${dataRes.status}`)
      );
      el.metaSection.hidden = true;
      el.toolbar.hidden = true;
      el.tableRoot.innerHTML = "";
      renderWarnings([]);
      return;
    }
    if (data.cached) {
      const mins = Math.max(0, Math.round((data.cacheAgeMs || 0) / 60000));
      const sourceFail =
        data.stale ||
        (Array.isArray(data.warnings) &&
          data.warnings.some((w) => /No se pudo actualizar/.test(String(w))));
      el.statusText.textContent = sourceFail
        ? `Fuente no disponible. Mostrando datos en caché (hace ~${mins} min).`
        : `Datos en caché (hace ~${mins} min). Tocá «Actualizar» para refrescar.`;
    } else {
      el.statusText.textContent = "Datos actualizados correctamente.";
    }
    el.metaSection.hidden = false;
    el.metaTime.textContent = formatWhen(data.scrapedAt);
    el.metaCount.textContent = String(data.count ?? 0);
    if (data.dbSaved && data.dbSaved.rowsSaved > 0) {
      el.metaDbChip.hidden = false;
      el.metaDb.textContent = `${data.dbSaved.rowsSaved} filas → data/paraguay_dmh.sqlite`;
    } else {
      el.metaDbChip.hidden = true;
    }
    lastItems = Array.isArray(data.items) ? data.items : [];
    renderWarnings(data.warnings);
    renderTable();
  } catch (e) {
    console.error(e);
    if (e.name === "AbortError") {
      setError("Tiempo de espera agotado. El servidor puede estar despertando; volvé a intentar.");
    } else {
      setError("No se pudo conectar al servidor. Si está en Render, puede tardar ~30–60 s al despertar.");
    }
    el.metaSection.hidden = true;
    el.toolbar.hidden = true;
    el.tableRoot.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

el.btnRefresh.addEventListener("click", () => load(true));
el.filterInput.addEventListener(
  "input",
  UI.debounce(() => renderTable(), 180)
);
document.addEventListener("DOMContentLoaded", () => load(false));
