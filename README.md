# Altura Ríos Dashboard

Dashboard web para consultar alturas hidrométricas de ríos, con datos desde fuentes públicas de FICH/UNL y DMH Paraguay.

Incluye servidor Express, interfaz estática, parsers HTML livianos y persistencia con SQLite local (dev/Render) o [Turso](https://turso.tech) (Vercel).

**Demo:** [altura-rios.vercel.app](https://altura-rios.vercel.app) · **Repo:** [fonsecaDev2025/altura_rios](https://github.com/fonsecaDev2025/altura_rios)

## Características

- Dashboard de la cuenca del Paraná (umbrales, tendencia, sparklines e histórico por estación).
- Vista separada para estaciones convencionales del Río Paraguay (DMH).
- Sección **Pasos y profundidades** con cuentas de usuario (CRUD manual).
- API REST en JSON (modo **solo-lectura**; scrape vía cron o `?refresh=1`).
- Persistencia diaria (SQLite o Turso) + recuperación de días faltantes.
- Despliegue en Vercel (+ Turso + Cron) o Render (disco + SQLite).
- PWA ligera: shell offline y último snapshot en caché del navegador.

## Tecnologías

- Node.js 18+
- Express, helmet, express-rate-limit
- better-sqlite3 (local) / `@libsql/client` + Turso (Vercel)
- HTML, CSS y JavaScript vanilla
- Python 3 opcional (`croniter_daily.py`, local/Render)

## Instalación

```bash
git clone https://github.com/fonsecaDev2025/altura_rios.git
cd altura_rios
npm install
```

Para Turso en local: copiá `.env.example` → `.env` (o `npx vercel env pull .env.local`).

## Uso local

```bash
npm start
# o
npm run dev
```

Por defecto: `http://localhost:3000`. Si el puerto está ocupado, se prueba el siguiente en el rango configurado.

## Modelo de datos (importante)

La API **no scrapea en cada request**:

| Cómo | Qué hace |
| --- | --- |
| `GET /api/data` / `GET /api/rio-paraguay-dmh` | Sirve el último snapshot (DB + caché en memoria). |
| `?refresh=1` | Fuerza scrape de la fuente oficial (rate-limit: 5/min). |
| `GET /api/cron/sync` | Sync diario Paraná + Paraguay (Vercel Cron, requiere `CRON_SECRET`). |
| Bootstrap | Si no hay snapshot aún, el primer GET puede scrapear una vez. |

TTL informativo: `CACHE_TTL_MS` (por defecto **24 h**). El front muestra la edad de los datos; el botón **Actualizar datos** pide confirmación antes de forzar scrape.

## Scripts

| Script | Descripción |
| --- | --- |
| `npm start` / `npm run dev` | Servidor Express |
| `npm test` | Tests (parsers, DB, API) |
| `npm run lint` | ESLint |
| `npm run sync:paraguay` | Scrape DMH → SQLite/Turso |
| `npm run import:historico` | Importa históricos a SQLite local |
| `npm run recuperar:faltantes` | Rellena días faltantes (wfich + DMH); con `TURSO_*` escribe en Turso |
| `npm run migrate:turso` | Crea esquema en Turso |
| `npm run import:turso` | Migra datos locales → Turso |
| `npm run db:studio` | Explorador simple de la DB |
| `npm run vercel:dev` | Emula Vercel en local |
| `npm run build:pages` | Regenera `public/config.js` si usás `API_BASE_URL` en build |

## API

### Salud

```http
GET /api/health
```

Incluye backend (`turso` / `sqlite-file`), edad de snapshots Paraná/Paraguay y estado del último cron.

### Paraná (solo-lectura)

```http
GET /api/data
GET /api/data?refresh=1
```

### Río Paraguay DMH (solo-lectura)

```http
GET /api/rio-paraguay-dmh
GET /api/rio-paraguay-dmh?refresh=1
```

### Series (sparklines / gráfico)

```http
GET /api/series?source=parana&dias=14
GET /api/series?source=paraguay&dias=30
```

`source`: `parana` \| `paraguay`. `dias`: 1–90 (default 14).

### Cron (protegido)

```http
GET /api/cron/sync
Authorization: Bearer <CRON_SECRET>
```

### Auth + Pasos

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | — | Registro (rate-limit) |
| `POST` | `/api/auth/login` | — | Login (cookie `HttpOnly`) |
| `POST` | `/api/auth/logout` | — | Cierra sesión |
| `GET` | `/api/auth/me` | cookie | Usuario actual |
| `GET/POST` | `/api/pasos` | sí | Listar / crear |
| `PUT/DELETE` | `/api/pasos/:id` | sí | Editar / borrar |

Detalle de dominio: ver [ABOUT.md](./ABOUT.md).

## Variables de entorno

Copiá `.env.example` a `.env`. Sin `TURSO_DATABASE_URL` se usan archivos en `data/`.

| Variable | Descripción | Default |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | URL libsql (requerida en Vercel) | — |
| `TURSO_AUTH_TOKEN` | Token Turso | — |
| `CRON_SECRET` | Bearer para `/api/cron/sync` | — |
| `CACHE_TTL_MS` | Edad “fresca” del snapshot (ms) | `86400000` (24 h) |
| `PORT` | Puerto base | `3000` |
| `CORS_ORIGIN` | Orígenes permitidos (coma) | `*` |
| `TRUST_PROXY` | `1` detrás de Vercel/CDN | — |
| `FETCH_TIMEOUT_MS` | Timeout scrape | `30000` |
| `FETCH_RETRIES` | Reintentos fetch | `2` |
| `SQLITE_PATH` | SQLite Paraná | `data/alturas.sqlite` |
| `PARAGUAY_SQLITE_PATH` | SQLite Paraguay | `data/paraguay_dmh.sqlite` |
| `PASOS_SQLITE_PATH` | SQLite pasos | `data/pasos.sqlite` |
| `DAILY_COMMAND` | Comando de `croniter_daily.py` | `npm run sync:paraguay` |

### Checklist producción (Vercel)

- [ ] `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- [ ] `CRON_SECRET` (y Cron en `vercel.json`: `0 11 * * *` UTC)
- [ ] `TRUST_PROXY=1`
- [ ] `NODE_ENV=production`
- [ ] Migración: `npm run migrate:turso` + `npm run import:turso` (una vez)

## Persistencia

- `data/alturas.sqlite` — extracciones Paraná + snapshots
- `data/paraguay_dmh.sqlite` — Paraguay DMH
- `data/pasos.sqlite` — usuarios, sesiones y pasos
- `data/historico_*.sqlite` — importador histórico

Con Turso, las mismas tablas viven en la nube.

## Sincronización diaria

**Producción (recomendado):** Vercel Cron → `/api/cron/sync` (11:00 UTC ≈ 08:00 ARG).

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://altura-rios.vercel.app/api/cron/sync
```

**Opcional local/Render:** `python3 croniter_daily.py` (+ `croniter_daily.service`). Por defecto solo corre `npm run sync:paraguay`.

## Despliegue en Vercel

1. Creá una base en [Turso](https://turso.tech).
2. Migrá e importá:

```bash
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
npm run migrate:turso
npm run import:turso
```

3. En Vercel: importá el repo y configurá las variables del checklist.
4. Deploy (`api/index.js` + `vercel.json`).
5. Verificá `GET /api/health` (snapshots + `lastCron` tras el primer sync).

**No subas tokens al repo.** Si se filtraron, rotálos en Turso.

## Despliegue en Render

`render.yaml` define web + cron. Con disco en `/var/data` podés usar SQLite sin Turso.

## Fuentes

- FICH/UNL — cuenca del Paraná
- DMH Paraguay — estaciones convencionales del Río Paraguay

Si cambia el HTML de origen, los parsers pueden necesitar ajuste.

## Descargo de responsabilidad

Aviso Legal y Descargo de Responsabilidad

La presente herramienta (disponible en [https://github.com/fonsecaDev2025/altura_rios](https://github.com/fonsecaDev2025/altura_rios)) ha sido desarrollada exclusivamente para uso personal e informativo. No constituye una fuente oficial de datos ni reemplaza la información, publicaciones o avisos oficiales emitidos por las autoridades marítimas, fluviales o portuarias correspondientes.

Esta aplicación funciona únicamente como una ayuda complementaria al navegante. Bajo ninguna circunstancia define, determina ni debe ser utilizada de forma exclusiva para tomar decisiones respecto a la navegación, el franqueo de pasos críticos, el calado seguro o la maniobra de embarcaciones.

El desarrollador no se hace responsable por el uso interno, la interpretación, la exactitud, la disponibilidad o los daños directos e indirectos derivados del uso de esta herramienta. La responsabilidad de la navegación, la seguridad de la embarcación y las decisiones tomadas a bordo recae íntegramente sobre el capitán o mando a cargo.

## Licencia

ISC
