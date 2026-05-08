(function (w) {
  var base = (w.API_BASE || "").toString().replace(/\/$/, "");
  w.resolveApiUrl = function (path) {
    if (!path) return base || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    return base ? base + path : path;
  };

  /**
   * Mensaje legible cuando fetch al API devuelve 404 (p. ej. Pages sin backend).
   */
  w.formatApiHttpError = function (status, apiPath) {
    if (status !== 404) {
      return "Error HTTP " + status;
    }
    var resolved =
      typeof w.resolveApiUrl !== "undefined" ? w.resolveApiUrl(apiPath) : apiPath;
    var b = (w.API_BASE || "").toString().replace(/\/$/, "");
    var host = "";
    try {
      host = typeof location !== "undefined" ? location.hostname : "";
    } catch (_e) {
      /* location puede lanzar en entornos restringidos */
    }
    var soloEstaticoCf =
      /\.pages\.dev$/i.test(host) ||
      /\.pages\.cloudflare\.com$/i.test(host) ||
      /\.workers\.dev$/i.test(host);
    var sinBase = !b;
    if (soloEstaticoCf && sinBase) {
      return (
        "404: En Cloudflare (Pages/Workers) solo hay HTML estático; /api no existe ahí. " +
        "Despliega el servidor Node (Express + Puppeteer) en Railway/Render/VPS, " +
        "define API_BASE_URL en el build con esa URL y CORS_ORIGIN en el backend con este sitio. " +
        "Petición: " +
        resolved
      );
    }
    if (sinBase) {
      return (
        "404: No se encontró " +
        resolved +
        ". ¿Tienes el servidor Node ejecutándose (npm start) en el mismo origen o API_BASE apuntando al backend?"
      );
    }
    return (
      "404: El backend respondió «no encontrado» para " +
      resolved +
      ". Revisa la URL base, el proxy y las rutas del servidor."
    );
  };
})(typeof window !== "undefined" ? window : this);
