/**
 * Parser del histórico de alturas de wfich1.unl.edu.ar
 * (http://wfich1.unl.edu.ar/cim/rios/historico/<id>).
 *
 * Estructura de cada fila (tbody): 6 celdas
 *   [0] fecha  DD/MM/YYYY
 *   [1] hora   HH:MM
 *   [2] altura (registro del día, coma decimal, ej "3,48")
 *   [3] variación (coma decimal, puede ser "—")
 *   [4] estado (icono <img title="Baja|Crece|Estacionario|Sin Datos">)
 *   [5] altura anterior
 */

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** DD/MM/YYYY -> YYYY-MM-DD (o null si no matchea). */
function fechaDmYToIso(fecha) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(fecha || "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * @param {string} html HTML completo de la página histórico
 * @returns {Array<{
 *   fechaIso: string,
 *   fecha: string,
 *   hora: string,
 *   altura: string,
 *   variacion: string,
 *   estado: string,
 *   alturaAnterior: string
 * }>}
 */
function parseWfichHistorico(html) {
  const lower = String(html || "").toLowerCase();
  const start = lower.indexOf("<tbody");
  if (start === -1) return [];
  const end = lower.indexOf("</tbody>", start);
  const tbody = html.slice(start, end === -1 ? undefined : end);

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tbody)) !== null) {
    const trInner = trMatch[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(trInner)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 6) continue;

    const fecha = stripTags(cells[0]);
    const fechaIso = fechaDmYToIso(fecha);
    if (!fechaIso) continue;

    const estadoMatch = /title="([^"]*)"/i.exec(cells[4]);
    const estado = estadoMatch ? estadoMatch[1].trim() : "";

    rows.push({
      fechaIso,
      fecha,
      hora: stripTags(cells[1]),
      altura: stripTags(cells[2]),
      variacion: stripTags(cells[3]),
      estado,
      alturaAnterior: stripTags(cells[5]),
    });
  }
  return rows;
}

module.exports = { parseWfichHistorico, fechaDmYToIso };
