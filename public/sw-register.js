/**
 * Registro del service worker (PWA ligera).
 */
(function () {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw]", err);
    });
  });
})();
