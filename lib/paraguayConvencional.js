/**
 * Extrae solo la tabla "RIO PARAGUAY" de indexconvencional.php (DMH Paraguay).
 */

function stripInnerHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} html HTML completo de la página
 * @returns {Array<{
 *   localidad: string,
 *   fecha: string,
 *   nivelDelDia: string,
 *   variacionDiaria: string,
 *   minimoHistoricoFecha: string,
 *   maximoHistoricoFecha: string,
 *   verMasUrl: string | null
 * }>}
 */
function parseRioParaguay(html) {
  const start = html.indexOf("<h3> RIO PARAGUAY</h3>");
  const end = html.indexOf("<h3> RIO PARANA</h3>");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }
  const section = html.slice(start, end);
  const tbodyMatch = section.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    return [];
  }
  const tbody = tbodyMatch[1];
  const base = "https://www.meteorologia.gov.py/nivel-rio/";
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRegex.exec(tbody)) !== null) {
    const trInner = m[1];
    if (!/<td/i.test(trInner)) continue;
    const spans = [...trInner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((x) =>
      stripInnerHtml(x[1])
    );
    if (spans.length < 6) continue;
    let href = (trInner.match(/href="([^"]+)"/) || [])[1] || null;
    if (href && !/^https?:/i.test(href)) {
      href = base + href.replace(/^\//, "");
    }
    rows.push({
      localidad: spans[0],
      fecha: spans[1],
      nivelDelDia: spans[2],
      variacionDiaria: spans[3],
      minimoHistoricoFecha: spans[4],
      maximoHistoricoFecha: spans[5],
      verMasUrl: href,
    });
  }
  return rows;
}

module.exports = { parseRioParaguay };
