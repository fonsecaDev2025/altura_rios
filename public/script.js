/**
 * Dashboard: GET /api/data → tabla de alturas de ríos (FICH/UNL).
 * items: puerto, rio, altura, variacion, estado, alturaAnterior, alerta, evacuacion
 */

function apiDataUrl() {
  return typeof resolveApiUrl !== "undefined"
    ? resolveApiUrl("/api/data")
    : "/api/data";
}

const el = {
  statusPanel: document.getElementById("status-panel"),
  statusText: document.getElementById("status-text"),
  btnRefresh: document.getElementById("btn-refresh"),
  metaSection: document.getElementById("meta-section"),
  metaSource: document.getElementById("meta-source"),
  metaTime: document.getElementById("meta-time"),
  metaCount: document.getElementById("meta-count"),
  warningsBlock: document.getElementById("warnings-block"),
  warningsList: document.getElementById("warnings-list"),
  toolbar: document.getElementById("toolbar"),
  filterInput: document.getElementById("filter-input"),
  tableSection: document.getElementById("table-section"),
};

let lastItems = [];

function setLoading(loading) {
  el.btnRefresh.disabled = loading;
  el.statusPanel.classList.toggle("status--loading", loading);
  if (loading) {
    el.statusText.textContent = "Obteniendo datos…";
  }
}

function setError(message) {
  el.statusPanel.classList.add("status--error");
  el.statusText.textContent = message;
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
  el.warningsList.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function estadoClass(estado) {
  const e = (estado || "").toUpperCase();
  if (e.includes("BAJA")) return "estado estado--baja";
  if (e.includes("CRECE")) return "estado estado--crece";
  if (e.includes("ESTAC")) return "estado estado--estac";
  return "estado estado--neutral";
}

function renderMeta(payload) {
  el.metaSection.hidden = false;
  el.metaSource.href = payload.source || "#";
  el.metaSource.textContent = payload.source || "—";
  el.metaTime.textContent = formatDate(payload.scrapedAt);
  el.metaCount.textContent = String(payload.count ?? payload.items?.length ?? 0);
}

function rowMatchesFilter(row, q) {
  if (!q) return true;
  const hay = [row.puerto, row.rio, row.estado, row.altura]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function renderTable() {
  const q = el.filterInput.value.trim().toLowerCase();
  const items = lastItems.filter((row) => rowMatchesFilter(row, q));

  if (!lastItems.length) {
    el.tableSection.innerHTML =
      '<p class="empty">No hay registros. Revisa la API.</p>';
    el.toolbar.hidden = true;
    return;
  }

  el.toolbar.hidden = false;

  const head = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Puerto</th>
          <th>Río</th>
          <th>Altura</th>
          <th>Variación</th>
          <th>Estado</th>
          <th>Alt. anterior</th>
          <th>Alerta</th>
          <th>Evacuación</th>
          <th>Hist.</th>
        </tr>
      </thead>
      <tbody>
  `;

  const rows = items
    .map((row) => {
      const hist = row.historicoHref
        ? `<a href="${escapeHtml(row.historicoHref)}" target="_blank" rel="noopener" class="link-hist">Ver</a>`
        : "—";
      return `
        <tr>
          <td data-label="Puerto">${escapeHtml(row.puerto)}</td>
          <td data-label="Río">${escapeHtml(row.rio)}</td>
          <td data-label="Altura" class="num">${escapeHtml(row.altura)}</td>
          <td data-label="Variación" class="num">${escapeHtml(row.variacion)}</td>
          <td data-label="Estado"><span class="${estadoClass(row.estado)}">${escapeHtml(row.estado)}</span></td>
          <td data-label="Alt. ant." class="num">${escapeHtml(row.alturaAnterior)}</td>
          <td data-label="Alerta" class="num">${escapeHtml(row.alerta)}</td>
          <td data-label="Evac." class="num">${escapeHtml(row.evacuacion)}</td>
          <td data-label="Hist.">${hist}</td>
        </tr>`;
    })
    .join("");

  const foot = `</tbody></table>`;
  const emptyFilter =
    items.length === 0 && q
      ? `<p class="empty empty--inline">Ningún resultado para «${escapeHtml(q)}».</p>`
      : "";

  el.tableSection.innerHTML = `<div class="table-scroll">${head}${rows}${foot}</div>${emptyFilter}`;
}

const FETCH_MS = 60000;

async function fetchData() {
  setLoading(true);
  clearErrorState();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_MS);

  try {
    const res = await fetch(apiDataUrl(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
      const msg =
        data.error ||
        (typeof formatApiHttpError !== "undefined"
          ? formatApiHttpError(res.status, "/api/data")
          : `Error HTTP ${res.status}`);
      setError(msg);
      el.metaSection.hidden = true;
      el.toolbar.hidden = true;
      lastItems = [];
      el.tableSection.innerHTML = "";
      renderWarnings([]);
      return;
    }

    el.statusText.textContent = "Datos cargados correctamente.";
    lastItems = Array.isArray(data.items) ? data.items : [];
    renderMeta(data);
    renderWarnings(data.warnings);
    renderTable();
  } catch (err) {
    console.error(err);
    if (err.name === "AbortError") {
      setError("Tiempo de espera agotado. Vuelve a intentar.");
    } else {
      setError("No se pudo conectar al servidor.");
    }
    el.metaSection.hidden = true;
    el.toolbar.hidden = true;
    lastItems = [];
    el.tableSection.innerHTML = "";
  } finally {
    clearTimeout(timeoutId);
    setLoading(false);
  }
}

el.btnRefresh.addEventListener("click", fetchData);
el.filterInput.addEventListener("input", () => renderTable());

document.addEventListener("DOMContentLoaded", () => {
  fetchData();
});
