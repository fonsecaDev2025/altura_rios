const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseFichAlturas } = require("../lib/fichHtmlParser");
const { parseHistoricoHtml } = require("../lib/historicoParser");
const { parseRioParaguay } = require("../lib/paraguayConvencional");
const { parseAlturasHtml } = require("../lib/pnaHtmlParser");

/* ─── fichHtmlParser ─── */

describe("parseFichAlturas", () => {
  it("devuelve array vacío si no hay tabla", () => {
    assert.deepEqual(parseFichAlturas("<html><body></body></html>"), []);
  });

  it("devuelve array vacío si tabla sin tbody", () => {
    const html = '<table class="table"><thead></thead></table>';
    assert.deepEqual(parseFichAlturas(html), []);
  });

  it("parsea filas correctamente", () => {
    const html = `
      <table class="table">
        <tbody>
          <tr>
            <td>Santa Fe</td>
            <td>Paraná</td>
            <td>3.20</td>
            <td>+0.05</td>
            <td><img alt="C" title="Crece"></td>
            <td>3.15</td>
            <td>5.00</td>
            <td>6.50</td>
            <td><a href="/historico/130">ver</a></td>
          </tr>
        </tbody>
      </table>`;
    const rows = parseFichAlturas(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].puerto, "Santa Fe");
    assert.equal(rows[0].rio, "Paraná");
    assert.equal(rows[0].altura, "3.20");
    assert.equal(rows[0].variacion, "+0.05");
    assert.equal(rows[0].estado, "Crece");
    assert.equal(rows[0].alturaAnterior, "3.15");
    assert.ok(rows[0].historicoHref.includes("/historico/130"));
  });

  it("ignora filas con menos de 7 celdas", () => {
    const html = `
      <table class="table">
        <tbody>
          <tr><td>solo</td><td>dos</td></tr>
        </tbody>
      </table>`;
    assert.deepEqual(parseFichAlturas(html), []);
  });
});

/* ─── historicoParser ─── */

describe("parseHistoricoHtml", () => {
  it("devuelve array vacío con HTML sin tabla", () => {
    assert.deepEqual(parseHistoricoHtml("<html></html>"), []);
  });

  it("extrae filas de la tabla historico", () => {
    const html = `
      <tr>
        <th scope="row">1</th>
        <td><i class="far fa-calendar"></i> 2024-06-01<i class="far fa-clock"></i> 08:00</td>
        <td>4.25 Mts</td>
      </tr>
      <tr>
        <th scope="row">2</th>
        <td><i class="far fa-calendar"></i> 2024-06-02<i class="far fa-clock"></i> 14:30</td>
        <td>4.10 Mts</td>
      </tr>`;
    const rows = parseHistoricoHtml(html);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].orden, 1);
    assert.equal(rows[0].fecha, "2024-06-01");
    assert.equal(rows[0].hora, "08:00");
    assert.equal(rows[0].registro_mts, 4.25);
    assert.equal(rows[1].orden, 2);
    assert.equal(rows[1].fecha, "2024-06-02");
    assert.equal(rows[1].hora, "14:30");
    assert.equal(rows[1].registro_mts, 4.10);
  });
});

/* ─── paraguayConvencional ─── */

describe("parseRioParaguay", () => {
  it("devuelve array vacío si no hay sección RIO PARAGUAY", () => {
    assert.deepEqual(parseRioParaguay("<html></html>"), []);
  });

  it("devuelve array vacío si falta sección RIO PARANA como delimitador", () => {
    const html = "<h3> RIO PARAGUAY</h3><table><tbody></tbody></table>";
    assert.deepEqual(parseRioParaguay(html), []);
  });

  it("extrae datos de estaciones correctamente", () => {
    const html = `
      <h3> RIO PARAGUAY</h3>
      <table>
        <tbody>
          <tr>
            <td>
              <span>Asunción</span>
              <span>08-05-2026</span>
              <span>2.50</span>
              <span>+0.10</span>
              <span>-0.42 (2020)</span>
              <span>8.90 (1983)</span>
            </td>
            <td><a href="detalle.php?id=1">Ver más</a></td>
          </tr>
        </tbody>
      </table>
      <h3> RIO PARANA</h3>`;
    const rows = parseRioParaguay(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].localidad, "Asunción");
    assert.equal(rows[0].fecha, "08-05-2026");
    assert.equal(rows[0].nivelDelDia, "2.50");
    assert.equal(rows[0].variacionDiaria, "+0.10");
    assert.ok(rows[0].verMasUrl.includes("detalle.php?id=1"));
  });
});

/* ─── pnaHtmlParser ─── */

describe("parseAlturasHtml (PNA)", () => {
  it("devuelve array vacío si no hay tabla fpTable", () => {
    assert.deepEqual(parseAlturasHtml("<html></html>"), []);
  });

  it("parsea filas con 13+ columnas", () => {
    const cells = Array(13).fill("<td>—</td>");
    cells[0] = "<td>Rosario</td>";
    cells[1] = "<td>Paraná</td>";
    cells[2] = "<td>3.80</td>";
    cells[3] = "<td>-0.02</td>";
    cells[6] = "<td>Normal</td>";
    cells[12] = '<td><a href="/alturas?id=130&page=historico">hist</a></td>';
    const html = `
      <table class="fpTable">
        <tbody>
          <tr>${cells.join("")}</tr>
        </tbody>
      </table>`;
    const rows = parseAlturasHtml(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].puerto, "Rosario");
    assert.equal(rows[0].rio, "Paraná");
    assert.equal(rows[0].ultimoRegistro, "3.80");
    assert.equal(rows[0].variacion, "-0.02");
    assert.equal(rows[0].estado, "Normal");
    assert.ok(rows[0].historicoHref.includes("/alturas?id=130"));
  });
});
