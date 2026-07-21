/**
 * Utilidades UI compartidas (Paraná, Paraguay, Pasos).
 */
(function (global) {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function parseNum(s) {
    if (s == null || s === "" || s === "—" || s === "-") return null;
    const cleaned = String(s)
      .replace(/m\b/gi, "")
      .replace(/[^\d,.+-]/g, "")
      .trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  /** normal | alerta | evacuacion | sin-dato */
  function nivelUmbral(altura, alerta, evacuacion) {
    const h = parseNum(altura);
    const a = parseNum(alerta);
    const e = parseNum(evacuacion);
    if (h == null) return "sin-dato";
    if (e != null && h >= e) return "evacuacion";
    if (a != null && h >= a) return "alerta";
    return "normal";
  }

  function umbralLabel(level) {
    if (level === "evacuacion") return "Evacuación";
    if (level === "alerta") return "Alerta";
    if (level === "normal") return "Normal";
    return "Sin dato";
  }

  function estadoClass(estado) {
    const e = (estado || "").toUpperCase();
    if (e.includes("BAJA")) return "estado estado--baja";
    if (e.includes("CRECE")) return "estado estado--crece";
    if (e.includes("ESTAC")) return "estado estado--estac";
    return "estado estado--neutral";
  }

  function sparklineSvg(points, opts) {
    const w = (opts && opts.width) || 72;
    const h = (opts && opts.height) || 28;
    const nums = (points || [])
      .map((p) => parseNum(typeof p === "object" ? p.altura : p))
      .filter((n) => n != null);
    if (nums.length < 2) {
      return `<span class="sparkline sparkline--empty" aria-hidden="true"></span>`;
    }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pad = 2;
    const coords = nums
      .map((n, i) => {
        const x = pad + (i / (nums.length - 1)) * (w - pad * 2);
        const y = h - pad - ((n - min) / span) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const last = nums[nums.length - 1];
    const first = nums[0];
    const trend = last > first ? "up" : last < first ? "down" : "flat";
    const clickable = opts && opts.stationKey;
    const btnAttrs = clickable
      ? ` role="button" tabindex="0" data-station="${escapeHtml(opts.stationKey)}" class="sparkline-btn" title="Ver gráfico histórico"`
      : "";
    return `<span${btnAttrs}><svg class="sparkline sparkline--${trend}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución reciente"><polyline fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" points="${coords}"/></svg></span>`;
  }

  /** Gráfico SVG grande para modal (puntos con fecha/altura). */
  function chartSvg(points, opts) {
    const w = (opts && opts.width) || 560;
    const h = (opts && opts.height) || 220;
    const padL = 44;
    const padR = 16;
    const padT = 16;
    const padB = 36;
    const rows = (points || [])
      .map((p) => ({
        fecha: typeof p === "object" ? p.fecha : "",
        n: parseNum(typeof p === "object" ? p.altura : p),
      }))
      .filter((p) => p.n != null);
    if (rows.length < 2) {
      return `<p class="chart-empty">No hay suficientes puntos para graficar.</p>`;
    }
    const nums = rows.map((r) => r.n);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const coords = rows
      .map((r, i) => {
        const x = padL + (i / (rows.length - 1)) * innerW;
        const y = padT + innerH - ((r.n - min) / span) * innerH;
        return { x, y, ...r };
      });
    const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const dots = coords
      .map(
        (c) =>
          `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="currentColor"><title>${escapeHtml(
            (c.fecha || "") + " · " + c.n
          )}</title></circle>`
      )
      .join("");
    const yLabels = [max, (max + min) / 2, min]
      .map((v, i) => {
        const y = padT + (i / 2) * innerH;
        return `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="chart-label">${v.toFixed(2)}</text>`;
      })
      .join("");
    const x0 = coords[0];
    const x1 = coords[coords.length - 1];
    const xLabels = `
      <text x="${x0.x}" y="${h - 10}" text-anchor="start" class="chart-label">${escapeHtml(x0.fecha || "")}</text>
      <text x="${x1.x}" y="${h - 10}" text-anchor="end" class="chart-label">${escapeHtml(x1.fecha || "")}</text>`;
    return `<svg class="chart-svg" width="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="Histórico de alturas">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="currentColor" opacity="0.2"/>
      <line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" stroke="currentColor" opacity="0.2"/>
      ${yLabels}${xLabels}
      <polyline fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" points="${poly}"/>
      ${dots}
    </svg>`;
  }

  function skeletonRows(n, cols) {
    const count = n || 6;
    const c = cols || 5;
    const cells = Array.from({ length: c }, () => '<td><span class="skel"></span></td>').join(
      ""
    );
    const rows = Array.from({ length: count }, () => `<tr>${cells}</tr>`).join("");
    return `<div class="table-scroll skeleton-wrap" aria-hidden="true"><table class="data-table data-table--skeleton"><tbody>${rows}</tbody></table></div>`;
  }

  function createColdStartWatcher(statusEl, delayMs) {
    let timer = null;
    return {
      start() {
        this.clear();
        timer = setTimeout(() => {
          if (statusEl) {
            statusEl.textContent =
              "La respuesta tarda más de lo habitual. Seguimos esperando…";
          }
        }, delayMs || 8000);
      },
      clear() {
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  }

  async function fetchWithTimeout(url, options, ms) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms || 60000);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { Accept: "application/json", ...(options && options.headers) },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function apiUrl(path) {
    return typeof resolveApiUrl !== "undefined" ? resolveApiUrl(path) : path;
  }

  function withRefreshParam(base, forceRefresh) {
    if (!forceRefresh) return base;
    return base + (base.includes("?") ? "&" : "?") + "refresh=1";
  }

  function formatAgeLabel(cacheAgeMs) {
    const mins = Math.max(0, Math.round((cacheAgeMs || 0) / 60000));
    if (mins < 60) return `hace ~${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `hace ~${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ~${days} d`;
  }

  /** Texto de estado + HTML de badge de edad. */
  function describeCachePayload(data) {
    if (!data || !data.cached) {
      return {
        statusText: "Datos actualizados desde la fuente oficial.",
        badgeHtml: `<span class="age-badge age-badge--live">En vivo</span>`,
      };
    }
    const ageLabel = formatAgeLabel(data.cacheAgeMs);
    const sourceFail =
      data.stale ||
      (Array.isArray(data.warnings) &&
        data.warnings.some((w) => /No se pudo actualizar/.test(String(w))));
    const statusText = sourceFail
      ? `Fuente no disponible. Mostrando datos en caché (${ageLabel}).`
      : `Datos en caché (${ageLabel}). El sync diario actualiza solo; «Actualizar datos» fuerza scrape.`;
    const freshClass = data.cacheFresh ? "age-badge--fresh" : "age-badge--stale";
    return {
      statusText,
      badgeHtml: `<span class="age-badge ${freshClass}">Datos ${escapeHtml(ageLabel)}</span>`,
    };
  }

  function confirmForceRefresh() {
    return window.confirm(
      "¿Forzar actualización desde la fuente oficial?\n\nEsto scrapea el sitio de origen (puede tardar). El sync diario ya mantiene los datos al día."
    );
  }

  function connectionErrorMessage(err) {
    if (err && err.name === "AbortError") {
      return "Tiempo de espera agotado. Volvé a intentar en unos segundos.";
    }
    return "No se pudo conectar al servidor. Comprobá la red o reintentá más tarde.";
  }

  function debounce(fn, ms) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms == null ? 200 : ms);
    };
  }

  /** Modal de histórico: ensure DOM once, open with series points. */
  function ensureChartModal() {
    let dlg = document.getElementById("chart-modal");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "chart-modal";
    dlg.className = "chart-modal";
    dlg.innerHTML = `
      <div class="chart-modal__inner">
        <header class="chart-modal__head">
          <h2 class="chart-modal__title" id="chart-modal-title">Histórico</h2>
          <button type="button" class="btn btn--ghost chart-modal__close" id="chart-modal-close" aria-label="Cerrar">Cerrar</button>
        </header>
        <div class="chart-modal__body" id="chart-modal-body"></div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#chart-modal-close").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
    return dlg;
  }

  function openStationChart(stationName, points) {
    const dlg = ensureChartModal();
    const title = dlg.querySelector("#chart-modal-title");
    const body = dlg.querySelector("#chart-modal-body");
    title.textContent = stationName || "Estación";
    body.innerHTML = chartSvg(points || []);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function bindSparklineClicks(root, seriesByKey) {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-station]");
      if (!btn) return;
      const key = btn.getAttribute("data-station");
      openStationChart(key, (seriesByKey && seriesByKey[key]) || []);
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const btn = e.target.closest("[data-station]");
      if (!btn) return;
      e.preventDefault();
      const key = btn.getAttribute("data-station");
      openStationChart(key, (seriesByKey && seriesByKey[key]) || []);
    });
  }

  global.UI = {
    escapeHtml,
    parseNum,
    nivelUmbral,
    umbralLabel,
    estadoClass,
    sparklineSvg,
    chartSvg,
    skeletonRows,
    createColdStartWatcher,
    fetchWithTimeout,
    apiUrl,
    withRefreshParam,
    formatAgeLabel,
    describeCachePayload,
    confirmForceRefresh,
    connectionErrorMessage,
    debounce,
    openStationChart,
    bindSparklineClicks,
  };
})(typeof window !== "undefined" ? window : globalThis);
