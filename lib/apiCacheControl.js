/**
 * Middleware Cache-Control para rutas /api.
 */

const { wantsRefresh } = require("../lib/snapshots");

function apiCacheControl(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();

  if (
    req.path.startsWith("/api/auth") ||
    req.path.startsWith("/api/pasos") ||
    req.path.startsWith("/api/cron")
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return next();
  }

  if (req.path === "/api/data" || req.path === "/api/rio-paraguay-dmh") {
    if (req.method === "GET" && !wantsRefresh(req)) {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    return next();
  }

  res.setHeader("Cache-Control", "no-store");
  next();
}

module.exports = { apiCacheControl };
