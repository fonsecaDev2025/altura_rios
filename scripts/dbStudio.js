/**
 * Visor local de las bases SQLite del proyecto (solo lectura).
 *
 *   npm run db:studio
 *   DB_STUDIO_PORT=4983 npm run db:studio
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const PORT = Number(process.env.DB_STUDIO_PORT || 4983);
const HOST = process.env.DB_STUDIO_HOST || "127.0.0.1";
const MAX_ROWS = 200;

function listDatabases() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".sqlite"))
    .sort()
    .map((file) => ({ file, path: path.join(DATA_DIR, file) }));
}

function openDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    const err = new Error(`No existe: ${dbPath}`);
    err.status = 404;
    throw err;
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function resolveDbPath(name) {
  const safe = path.basename(String(name || ""));
  if (!safe.endsWith(".sqlite")) {
    const err = new Error("Nombre de base inválido");
    err.status = 400;
    throw err;
  }
  const full = path.join(DATA_DIR, safe);
  if (!fs.existsSync(full)) {
    const err = new Error(`Base no encontrada: ${safe}`);
    err.status = 404;
    throw err;
  }
  return full;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const app = express();

app.get("/api/databases", (_req, res) => {
  res.json({ databases: listDatabases().map((d) => d.file) });
});

app.get("/api/:db/tables", (req, res, next) => {
  let db;
  try {
    db = openDb(resolveDbPath(req.params.db));
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all()
      .map((r) => r.name);
    res.json({ tables });
  } catch (e) {
    next(e);
  } finally {
    if (db) db.close();
  }
});

app.get("/api/:db/table/:table", (req, res, next) => {
  let db;
  try {
    const table = String(req.params.table || "");
    if (!/^[A-Za-z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Nombre de tabla inválido" });
      return;
    }
    const limit = Math.min(
      MAX_ROWS,
      Math.max(1, Number(req.query.limit) || MAX_ROWS)
    );
    const offset = Math.max(0, Number(req.query.offset) || 0);

    db = openDb(resolveDbPath(req.params.db));
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`)
      .get().n;
    const rows = db
      .prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ? OFFSET ?`)
      .all(limit, offset);
    const columns =
      rows.length > 0
        ? Object.keys(rows[0])
        : db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all()
            .map((c) => c.name);

    res.json({ table, count, limit, offset, columns, rows });
  } catch (e) {
    next(e);
  } finally {
    if (db) db.close();
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>SQLite Studio — altura_rios</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #111; }
    select, button { margin-right: .5rem; padding: .35rem .5rem; }
    table { border-collapse: collapse; margin-top: 1rem; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #ccc; padding: .35rem .5rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; position: sticky; top: 0; }
    #meta { color: #555; margin-top: .75rem; }
    .wrap { overflow: auto; max-height: 70vh; }
  </style>
</head>
<body>
  <h1>SQLite Studio</h1>
  <p>Visor local de <code>data/*.sqlite</code> (solo lectura).</p>
  <div>
    <label>Base <select id="db"></select></label>
    <label>Tabla <select id="table"></select></label>
    <button id="prev" type="button">Anterior</button>
    <button id="next" type="button">Siguiente</button>
    <button id="reload" type="button">Recargar</button>
  </div>
  <div id="meta"></div>
  <div class="wrap"><table id="grid"><thead></thead><tbody></tbody></table></div>
  <script>
    const dbSel = document.getElementById('db');
    const tableSel = document.getElementById('table');
    const meta = document.getElementById('meta');
    const thead = document.querySelector('#grid thead');
    const tbody = document.querySelector('#grid tbody');
    let offset = 0;
    const limit = ${MAX_ROWS};

    async function loadDatabases() {
      const res = await fetch('/api/databases');
      const data = await res.json();
      dbSel.innerHTML = data.databases.map(d => '<option value="' + d + '">' + d + '</option>').join('');
      if (!data.databases.length) {
        meta.textContent = 'No hay archivos .sqlite en data/.';
        return;
      }
      await loadTables();
    }

    async function loadTables() {
      const db = dbSel.value;
      const res = await fetch('/api/' + encodeURIComponent(db) + '/tables');
      const data = await res.json();
      tableSel.innerHTML = data.tables.map(t => '<option value="' + t + '">' + t + '</option>').join('');
      offset = 0;
      await loadRows();
    }

    async function loadRows() {
      const db = dbSel.value;
      const table = tableSel.value;
      if (!db || !table) return;
      const res = await fetch('/api/' + encodeURIComponent(db) + '/table/' + encodeURIComponent(table) + '?limit=' + limit + '&offset=' + offset);
      const data = await res.json();
      meta.textContent = data.table + ': ' + data.count + ' filas · mostrando ' + (data.offset + 1) + '–' + Math.min(data.offset + data.rows.length, data.count);
      thead.innerHTML = '<tr>' + data.columns.map(c => '<th>' + c + '</th>').join('') + '</tr>';
      tbody.innerHTML = data.rows.map(row => '<tr>' + data.columns.map(c => '<td>' + (row[c] ?? '') + '</td>').join('') + '</tr>').join('');
    }

    dbSel.addEventListener('change', loadTables);
    tableSel.addEventListener('change', () => { offset = 0; loadRows(); });
    document.getElementById('reload').addEventListener('click', loadRows);
    document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - limit); loadRows(); });
    document.getElementById('next').addEventListener('click', () => { offset += limit; loadRows(); });
    loadDatabases();
  </script>
</body>
</html>`);
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || String(err) });
});

app.listen(PORT, HOST, () => {
  console.log(`SQLite Studio en http://${HOST}:${PORT}`);
  console.log(`Bases en ${DATA_DIR}`);
});
