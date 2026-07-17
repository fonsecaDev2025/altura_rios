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
      .replace(/[^\d,.\-]/g, "")
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
    return `<svg class="sparkline sparkline--${trend}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución reciente"><polyline fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" points="${coords}"/></svg>`;
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
              "El servidor puede tardar 30–60 s al despertar (Render). Seguimos esperando…";
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

  global.UI = {
    escapeHtml,
    parseNum,
    nivelUmbral,
    umbralLabel,
    estadoClass,
    sparklineSvg,
    skeletonRows,
    createColdStartWatcher,
    fetchWithTimeout,
    apiUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
