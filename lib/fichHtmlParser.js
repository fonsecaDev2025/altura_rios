/**
 * Parser HTML para tabla de alturas de la FICH/UNL (cuenca del Paraná).
 * Fuente: http://wfich1.unl.edu.ar/cim/rios/parana/alturas
 *
 * Columnas: Puerto | Río | Altura/Caudal | Variación | Cambio (img) |
 *           Alt. Ant | Alerta | Evacuación | Histórico (link)
 */

const FICH_ORIGIN = "http://wfich1.unl.edu.ar";

function strip(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractEstado(cellHtml) {
  const imgTitle = (cellHtml.match(/title="([^"]+)"/i) || [])[1];
  if (imgTitle) return imgTitle;
  const alt = (cellHtml.match(/alt="([^"]+)"/i) || [])[1];
  if (alt === "B") return "Baja";
  if (alt === "C") return "Crece";
  if (alt === "E") return "Estacionario";
  if (alt === "-") return "Sin Datos";
  return strip(cellHtml) || "—";
}

function parseFichAlturas(html) {
  const tableMatch = html.match(
    /<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) return [];

  const tbodyMatch = tableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRe.exec(tbodyMatch[1])) !== null) {
    const inner = trMatch[1];
    if (/<th/i.test(inner)) continue;

    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(inner)) !== null) {
      cells.push(cm[1]);
    }
    if (cells.length < 7) continue;

    let historicoHref = null;
    const lastCell = cells[cells.length - 1] || "";
    const linkMatch = lastCell.match(/href="([^"]+)"/i);
    if (linkMatch) {
      let href = linkMatch[1].trim();
      if (href.startsWith("/")) href = FICH_ORIGIN + href;
      historicoHref = href;
    }

    const row = {
      puerto: strip(cells[0]),
      rio: strip(cells[1]),
      altura: strip(cells[2]),
      variacion: strip(cells[3]),
      estado: extractEstado(cells[4]),
      alturaAnterior: strip(cells[5]),
      alerta: strip(cells[6]),
      evacuacion: cells.length >= 8 ? strip(cells[7]) : "",
      historicoHref,
    };

    if (row.puerto || row.rio) rows.push(row);
  }

  return rows;
}

module.exports = { parseFichAlturas };
