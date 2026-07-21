/**
 * Dashboard Paraná: GET /api/data + /api/series
 */

function apiDataUrl(forceRefresh = false) {
  return UI.withRefreshParam(UI.apiUrl("/api/data"), forceRefresh);
}

const el = {
  statusPanel: document.getElementById("status-panel"),
  statusText: document.getElementById("status-text"),
  ageBadge: document.getElementById("age-badge"),
  btnRefresh: document.getElementById("btn-refresh"),
  metaSection: document.getElementById("meta-section"),
  metaSource: document.getElementById("meta-source"),
  metaTime: document.getElementById("meta-time"),
  metaCount: document.getElementById("meta-count"),
  warningsBlock: document.getElementById("warnings-block"),
  warningsList: document.getElementById("warnings-list"),
  toolbar: document.getElementById("toolbar"),
  filterInput: document.getElementById("filter-input"),
  rioFilters: document.getElementById("rio-filters"),
  legend: document.getElementById("legend"),
  tableSection: document.getElementById("table-section"),
};

let lastItems = [];
let seriesByPuerto = {};
let activeRio = "";
const coldStart = UI.createColdStartWatcher(el.statusText, 8000);
const FETCH_MS = 60000;

function setLoading(loading) {
  el.btnRefresh.disabled = loading;
  el.statusPanel.classList.toggle("status--loading", loading);
  if (loading) {
    el.statusText.textContent = "Obteniendo datos…";
    if (el.ageBadge) el.ageBadge.innerHTML = "";
    el.tableSection.innerHTML = UI.skeletonRows(8, 9);
    coldStart.start();
  } else {
    coldStart.clear();
  }
}

function setError(message) {
  el.statusPanel.classList.add("status--error");
  el.statusText.textContent = message;
  if (el.ageBadge) el.ageBadge.innerHTML = "";
}

function clearErrorState() {
  el.statusPanel.classList.remove("status--error");
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function renderWarnings(warnings) {
  if (!warnings || !warnings.length) {
    el.warningsBlock.hidden = true;
    el.warningsList.innerHTML = "";
    return;
  }
  el.warningsBlock.hidden = false;
  el.warningsList.innerHTML = warnings
    .map((w) => `<li>${UI.escapeHtml(w)}</li>`)
    .join("");
}

function renderMeta(payload) {
  el.metaSection.hidden = false;
  el.metaSource.href = payload.source || "#";
  el.metaSource.textContent = payload.source || "—";
  el.metaTime.textContent = formatDate(payload.scrapedAt);
  el.metaCount.textContent = String(payload.count ?? payload.items?.length ?? 0);
}

function uniqueRios(items) {
  const set = new Set();
  for (const row of items) {
    const r = (row.rio || "").trim();
    if (r) set.add(r);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

function renderRioChips() {
  const rios = uniqueRios(lastItems);
  if (!rios.length) {
    el.rioFilters.innerHTML = "";
    return;
  }
  const allActive = !activeRio;
  el.rioFilters.innerHTML =
    `<button type="button" class="chip-filter${allActive ? " chip-filter--active" : ""}" data-rio="">Todos</button>` +
    rios
      .map((rio) => {
        const active = activeRio === rio ? " chip-filter--active" : "";
        return `<button type="button" class="chip-filter${active}" data-rio="${UI.escapeHtml(rio)}">${UI.escapeHtml(rio)}</button>`;
      })
      .join("");
}

function rowMatchesFilter(row, q) {
  if (activeRio && (row.rio || "").trim() !== activeRio) return false;
  if (!q) return true;
  const hay = [row.puerto, row.rio, row.estado, row.altura, row.alerta, row.evacuacion]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function renderTable({ updateChips = false } = {}) {
  const q = el.filterInput.value.trim().toLowerCase();
  const items = lastItems.filter((row) => rowMatchesFilter(row, q));

  if (!lastItems.length) {
    el.tableSection.innerHTML =
      '<p class="empty">No hay registros. Revisa la API.</p>';
    el.toolbar.hidden = true;
    el.legend.hidden = true;
    return;
  }

  el.toolbar.hidden = false;
  el.legend.hidden = false;
  if (updateChips) renderRioChips();

  const head = `
    <table class="data-table">
      <caption class="sr-only">Alturas hidrométricas de la cuenca del Paraná (orden aproximado río abajo según fuente)</caption>
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
      <tbody>
  `;

  const rows = items
    .map((row) => {
      const level = UI.nivelUmbral(row.altura, row.alerta, row.evacuacion);
      const umbralTitle = [
        row.alerta ? `Alerta: ${row.alerta}` : null,
        row.evacuacion ? `Evacuación: ${row.evacuacion}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const spark = UI.sparklineSvg(seriesByPuerto[row.puerto] || [], {
        stationKey: row.puerto,
      });
      const hist = row.historicoHref
        ? `<a href="${UI.escapeHtml(row.historicoHref)}" target="_blank" rel="noopener" class="link-hist">Ver histórico de ${UI.escapeHtml(row.puerto)}</a>`
        : "—";
      return `
        <tr>
          <td data-label="Puerto" class="col-puerto">${UI.escapeHtml(row.puerto)}</td>
          <td data-label="Río">${UI.escapeHtml(row.rio)}</td>
          <td data-label="Altura" class="num">${UI.escapeHtml(row.altura)}</td>
          <td data-label="Variación" class="num">${UI.escapeHtml(row.variacion)}</td>
          <td data-label="Tendencia"><span class="${UI.estadoClass(row.estado)}">${UI.escapeHtml(row.estado)}</span></td>
          <td data-label="Umbral"><span class="umbral umbral--${level}" title="${UI.escapeHtml(umbralTitle || "Sin umbrales")}">${UI.umbralLabel(level)}</span></td>
          <td data-label="Evolución">${spark}</td>
          <td data-label="Alt. ant." class="num">${UI.escapeHtml(row.alturaAnterior)}</td>
          <td data-label="Histórico">${hist}</td>
        </tr>`;
    })
    .join("");

  const emptyFilter =
    items.length === 0 && (q || activeRio)
      ? `<p class="empty empty--inline">Ningún resultado para el filtro actual.</p>`
      : "";

  el.tableSection.innerHTML = `<div class="table-scroll">${head}${rows}</tbody></table></div>${emptyFilter}`;
}

async function fetchSeries() {
  try {
    const res = await UI.fetchWithTimeout(
      UI.apiUrl("/api/series?source=parana&dias=30"),
      {},
      20000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.series) {
      seriesByPuerto = data.series;
      return true;
    }
  } catch (e) {
    console.warn("[series]", e);
  }
  return false;
}

async function fetchData(forceRefresh = false) {
  setLoading(true);
  clearErrorState();

  try {
    const [dataRes] = await Promise.all([
      UI.fetchWithTimeout(apiDataUrl(forceRefresh), {}, FETCH_MS),
      fetchSeries(),
    ]);
    const data = await dataRes.json().catch(() => ({}));

    if (!dataRes.ok || data.ok === false) {
      const msg =
        data.error ||
        (typeof formatApiHttpError !== "undefined"
          ? formatApiHttpError(dataRes.status, "/api/data")
          : `Error HTTP ${dataRes.status}`);
      setError(msg);
      el.metaSection.hidden = true;
      el.toolbar.hidden = true;
      el.legend.hidden = true;
      lastItems = [];
      el.tableSection.innerHTML = "";
      renderWarnings([]);
      return;
    }

    const cacheInfo = UI.describeCachePayload(data);
    el.statusText.textContent = cacheInfo.statusText;
    if (el.ageBadge) el.ageBadge.innerHTML = cacheInfo.badgeHtml;
    lastItems = Array.isArray(data.items) ? data.items : [];
    renderMeta(data);
    renderWarnings(data.warnings);
    renderTable({ updateChips: true });
  } catch (err) {
    console.error(err);
    setError(UI.connectionErrorMessage(err));
    el.metaSection.hidden = true;
    el.toolbar.hidden = true;
    el.legend.hidden = true;
    lastItems = [];
    el.tableSection.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

el.btnRefresh.addEventListener("click", () => {
  if (!UI.confirmForceRefresh()) return;
  fetchData(true);
});
el.filterInput.addEventListener(
  "input",
  UI.debounce(() => renderTable(), 180)
);
el.rioFilters.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-rio]");
  if (!btn) return;
  activeRio = btn.getAttribute("data-rio") || "";
  renderTable({ updateChips: true });
});

// Clicks en sparklines: series actualizadas
el.tableSection.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-station]");
  if (!btn) return;
  const key = btn.getAttribute("data-station");
  UI.openStationChart(key, seriesByPuerto[key] || []);
});
el.tableSection.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const btn = e.target.closest("[data-station]");
  if (!btn) return;
  e.preventDefault();
  const key = btn.getAttribute("data-station");
  UI.openStationChart(key, seriesByPuerto[key] || []);
});

document.addEventListener("DOMContentLoaded", () => {
  fetchData(false);
});
