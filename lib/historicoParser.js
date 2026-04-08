/**
 * Extrae filas de la página historico (tabla "Ultimos Registros").
 * Formato esperado: #, Fecha (YYYY-MM-DD + HH:MM), Registro (Mts).
 */

function parseHistoricoHtml(html) {
  const rows = [];
  const trRegex =
    /<tr>\s*<th scope="row">(\d+)<\/th>\s*<td>[\s\S]*?<\/i>\s*(\d{4}-\d{2}-\d{2})[\s\S]*?<\/i>\s*(\d{2}:\d{2})[\s\S]*?<\/td>\s*<td>([\d.]+)\s*Mts<\/td>/g;
  let m;
  while ((m = trRegex.exec(html)) !== null) {
    rows.push({
      orden: parseInt(m[1], 10),
      fecha: m[2],
      hora: m[3],
      registro_mts: parseFloat(m[4]),
    });
  }
  return rows;
}

module.exports = { parseHistoricoHtml };
