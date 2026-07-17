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
    el.tableRoot.innerHTML = UI.skeletonRows(8, 6);
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
          <th scope="col">Localidad</th>
          <th scope="col">Fecha</th>
          <th scope="col">Nivel del día</th>
          <th scope="col">Variación</th>
          <th scope="col">Tendencia</th>
          <th scope="col">Evolución</th>
          <th scope="col">Detalle</th>
        </tr>
      </thead>
      <tbody>`;

  const body = items
    .map((row) => {
      const t = tendenciaFromVariacion(row.variacionDiaria);
      const spark = UI.sparklineSvg(seriesByLoc[row.localidad] || []);
      const link = row.verMasUrl
        ? `<a class="link-more" href="${UI.escapeHtml(row.verMasUrl)}" target="_blank" rel="noopener noreferrer">Ver histórico de ${UI.escapeHtml(row.localidad)}</a>`
        : "—";
      return `
        <tr>
          <td data-label="Localidad" class="col-localidad">${UI.escapeHtml(row.localidad)}</td>
          <td data-label="Fecha" class="num">${UI.escapeHtml(row.fecha)}</td>
          <td data-label="Nivel" class="num">${UI.escapeHtml(row.nivelDelDia)}</td>
          <td data-label="Variación" class="num">${UI.escapeHtml(row.variacionDiaria)}</td>
          <td data-label="Tendencia"><span class="${t.cls}">${t.label}</span></td>
          <td data-label="Evolución">${spark}</td>
          <td data-label="Detalle">${link}</td>
        </tr>`;
    })
    .join("");

  const emptyFilter =
    items.length === 0 && q
      ? `<p class="empty empty--inline">Ningún resultado para «${UI.escapeHtml(q)}».</p>`
      : "";

  el.tableRoot.innerHTML = `<div class="table-scroll">${head}${body}</tbody></table></div>${emptyFilter}`;
}

async function loadSeries() {
  try {
    const res = await UI.fetchWithTimeout(
      UI.apiUrl("/api/series?source=paraguay&dias=14"),
      {},
      20000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.series) {
      seriesByLoc = data.series;
      if (lastItems.length) renderTable();
    }
  } catch (e) {
    console.warn("[series paraguay]", e);
  }
}

async function load(forceRefresh = false) {
  setLoading(true);
  clearError();
  try {
    const res = await UI.fetchWithTimeout(apiParaguayUrl(forceRefresh), {}, FETCH_MS);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setError(
        data.error ||
          (typeof formatApiHttpError !== "undefined"
            ? formatApiHttpError(res.status, "/api/rio-paraguay-dmh")
            : `Error HTTP ${res.status}`)
      );
      el.metaSection.hidden = true;
      el.toolbar.hidden = true;
      el.tableRoot.innerHTML = "";
      renderWarnings([]);
      return;
    }
    if (data.cached) {
      const mins = Math.max(0, Math.round((data.cacheAgeMs || 0) / 60000));
      el.statusText.textContent = data.stale
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
    loadSeries();
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
el.filterInput.addEventListener("input", () => renderTable());
document.addEventListener("DOMContentLoaded", () => load(false));
