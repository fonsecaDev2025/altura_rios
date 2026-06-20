/**
 * Carga no bloqueante de Google Fonts.
 * El <link> arranca con media="print" (no bloquea el primer pintado);
 * al terminar de descargar, se promueve a media="all" y se aplican las
 * tipografías. Compatible con CSP script-src 'self' (sin inline onload).
 */
(function () {
  var links = document.querySelectorAll("link[data-font-async]");
  Array.prototype.forEach.call(links, function (link) {
    if (link.sheet) {
      link.media = "all";
      return;
    }
    link.addEventListener("load", function () {
      link.media = "all";
    });
  });
})();
