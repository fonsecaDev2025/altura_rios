/**
 * Parser de la tabla "Últimos Registros Observados" de la DMH Paraguay
 * (vermas_convencional.php?code=<code>), tabla con id="theDataTable".
 *
 * Cada fila: 2 celdas
 *   [0] fecha  DD-MM-YYYY
 *   [1] nivel  ej "4.33m"  -> se normaliza a "4.33 m"
 *
 * Nota: por HTTP simple sólo devuelve los últimos ~15 días; el rango de
 * fechas más antiguo se rellena por JavaScript y no es accesible acá.
 */

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DD-MM-YYYY -> YYYY-MM-DD (o null). */
function fechaDmYToIso(fecha) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(fecha || "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "4.33m" / "4.33 m" -> "4.33 m". */
function normalizarNivel(raw) {
  const s = stripTags(raw);
  const m = /(-?\d+(?:[.,]\d+)?)\s*m/i.exec(s);
  if (!m) return s;
  return `${m[1]} m`;
}

/**
 * @param {string} html HTML completo de la página vermas
 * @returns {Array<{fecha: string, fechaIso: string, nivel: string}>}
 */
function parseVermasParaguay(html) {
  const anchor = String(html || "").indexOf('id="theDataTable"');
  if (anchor === -1) return [];
  const tbStart = html.indexOf("<tbody", anchor);
  if (tbStart === -1) return [];
  const tbEnd = html.indexOf("</tbody>", tbStart);
  const tbody = html.slice(tbStart, tbEnd === -1 ? undefined : tbEnd);

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tbody)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(trMatch[1])) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 2) continue;

    const fecha = stripTags(cells[0]);
    const fechaIso = fechaDmYToIso(fecha);
    if (!fechaIso) continue;

    rows.push({
      fecha,
      fechaIso,
      nivel: normalizarNivel(cells[1]),
    });
  }
  return rows;
}

module.exports = { parseVermasParaguay, fechaDmYToIso, normalizarNivel };
