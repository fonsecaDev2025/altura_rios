/**
 * Vista independiente: GET /api/rio-paraguay-dmh
 */

function apiParaguayUrl() {
  return typeof resolveApiUrl !== "undefined"
    ? resolveApiUrl("/api/rio-paraguay-dmh")
    : "/api/rio-paraguay-dmh";
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
  tableRoot: document.getElementById("table-root"),
};

function setLoading(on) {
  el.btnRefresh.disabled = on;
  el.statusPanel.classList.toggle("status--loading", on);
  if (on) el.statusText.textContent = "Obteniendo datos…";
}

function setError(msg) {
  el.statusPanel.classList.add("status--error");
  el.statusText.textContent = msg;
}

function clearError() {
  el.statusPanel.classList.remove("status--error");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
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
  el.warningsList.innerHTML = list.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

function renderTable(items) {
  if (!items || !items.length) {
    el.tableRoot.innerHTML =
      '<p class="empty">No hay filas para Río Paraguay.</p>';
    return;
  }

  const head = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Localidad</th>
          <th>Fecha</th>
          <th>Nivel del día</th>
          <th>Variación diaria</th>
          <th>Mín. histórico</th>
          <th>Máx. histórico</th>
          <th></th>
        </tr>
      </thead>
      <tbody>`;

  const body = items
    .map((row) => {
      const link = row.verMasUrl
        ? `<a class="link-more" href="${escapeHtml(row.verMasUrl)}" target="_blank" rel="noopener noreferrer">Ver más</a>`
        : "—";
      return `
        <tr>
          <td class="col-localidad">${escapeHtml(row.localidad)}</td>
          <td class="num">${escapeHtml(row.fecha)}</td>
          <td class="num">${escapeHtml(row.nivelDelDia)}</td>
          <td class="num">${escapeHtml(row.variacionDiaria)}</td>
          <td>${escapeHtml(row.minimoHistoricoFecha)}</td>
          <td>${escapeHtml(row.maximoHistoricoFecha)}</td>
          <td>${link}</td>
        </tr>`;
    })
    .join("");

  el.tableRoot.innerHTML = `<div class="table-scroll">${head}${body}</tbody></table></div>`;
}

async function load() {
  setLoading(true);
  clearError();
  try {
    const res = await fetch(apiParaguayUrl(), {
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setError(
        data.error ||
          (typeof formatApiHttpError !== "undefined"
            ? formatApiHttpError(res.status, "/api/rio-paraguay-dmh")
            : `Error HTTP ${res.status}`)
      );
      el.metaSection.hidden = true;
      el.tableRoot.innerHTML = "";
      renderWarnings([]);
      return;
    }
    el.statusText.textContent = "Listo.";
    el.metaSection.hidden = false;
    el.metaTime.textContent = formatWhen(data.scrapedAt);
    el.metaCount.textContent = String(data.count ?? 0);
    if (data.dbSaved && data.dbSaved.rowsSaved > 0) {
      el.metaDbChip.hidden = false;
      el.metaDb.textContent = `${data.dbSaved.rowsSaved} filas → data/paraguay_dmh.sqlite`;
    } else {
      el.metaDbChip.hidden = true;
    }
    renderWarnings(data.warnings);
    renderTable(data.items);
  } catch (e) {
    console.error(e);
    setError("No se pudo conectar al servidor local.");
    el.metaSection.hidden = true;
    el.tableRoot.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

el.btnRefresh.addEventListener("click", load);
document.addEventListener("DOMContentLoaded", load);
