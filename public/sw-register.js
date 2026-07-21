/**
 * Registro del service worker (PWA ligera).
 * Limpia caches viejos para evitar mezclar JS/HTML tras deploy.
 */
(function () {
  if (!("serviceWorker" in navigator)) return;

  const CURRENT = ["altura-rios-shell-v3", "altura-rios-api-v3"];

  window.addEventListener("load", () => {
    if ("caches" in window) {
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("altura-rios-") && !CURRENT.includes(k))
            .map((k) => caches.delete(k))
        )
      );
    }

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch((err) => {
        console.warn("[sw]", err);
      });
  });
})();
