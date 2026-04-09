/**
 * Cloudflare Pages: define la variable de entorno API_BASE_URL (sin barra final).
 * Ej.: https://altura-api.tudominio.com
 */
const fs = require("fs");
const path = require("path");

const url = process.env.API_BASE_URL || "";
const out = path.join(__dirname, "..", "public", "config.js");
const content = `/**
 * Generado por npm run build:pages (API_BASE_URL en el entorno de build).
 */
window.API_BASE = ${JSON.stringify(url)};
`;

fs.writeFileSync(out, content, "utf8");
console.log("[build:pages] public/config.js → API_BASE", url ? `"${url}"` : "(vacío, rutas relativas)");
