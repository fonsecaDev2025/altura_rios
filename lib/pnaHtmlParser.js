/**
 * Parser HTML con regex para tabla fpTable de PNA (Prefectura Naval Argentina).
 * Fallback liviano que no requiere Puppeteer/Chrome.
 */

const SITE_ORIGIN = "https://contenidosweb.prefecturanaval.gob.ar";

function stripTags(s) {
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

function parseAlturasHtml(html) {
  const tbodyMatch = html.match(
    /<table[^>]*class\s*=\s*["'][^"']*fpTable[^"']*["'][^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i
  );
  if (!tbodyMatch) return [];

  const tbody = tbodyMatch[1];
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRe.exec(tbody)) !== null) {
    const trInner = trMatch[1];
    const cellRe = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(trInner)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 13) continue;

    let href = "";
    const linkMatch = (cells[12] || "").match(/href\s*=\s*["']([^"']+)["']/i);
    if (linkMatch) {
      href = linkMatch[1].replace(/\r/g, "").trim();
      if (href.startsWith("/")) href = SITE_ORIGIN + href;
      else if (href && !/^https?:/i.test(href))
        href = SITE_ORIGIN + "/" + href.replace(/^\//, "");
    }

    const row = {
      puerto: stripTags(cells[0]),
      rio: stripTags(cells[1]),
      ultimoRegistro: stripTags(cells[2]),
      variacion: stripTags(cells[3]),
      periodo: stripTags(cells[4]),
      fechaHora: stripTags(cells[5]),
      estado: stripTags(cells[6]),
      registroAnterior: stripTags(cells[8]),
      fechaAnterior: stripTags(cells[9]),
      alerta: stripTags(cells[10]),
      evacuacion: stripTags(cells[11]),
      historicoHref: href || null,
    };

    if (row.puerto || row.rio) rows.push(row);
  }

  return rows;
}

module.exports = { parseAlturasHtml };
