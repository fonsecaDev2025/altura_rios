# Altura Ríos Dashboard

Dashboard web para consultar alturas hidrométricas de ríos, con datos obtenidos desde fuentes públicas de FICH/UNL y DMH Paraguay.

El proyecto incluye un servidor Express, una interfaz web estática, parsers livianos basados en HTML y persistencia con SQLite local (dev/Render) o [Turso](https://turso.tech) (Vercel).

## Características

- Dashboard para alturas de la cuenca del Paraná.
- Vista separada para estaciones convencionales del Río Paraguay publicadas por DMH Paraguay.
- API REST para consultar datos en formato JSON.
- Persistencia diaria (SQLite local o Turso en la nube).
- Scripts para importar históricos y actualizar datos.
- Despliegue en Vercel (+ Turso) o Render (disco + SQLite).

## Tecnologías

- Node.js 18 o superior
- Express
- better-sqlite3 (local) / @libsql/client + Turso (Vercel)
- HTML, CSS y JavaScript vanilla
- Python 3 para el daemon diario opcional

## Instalación

Cloná el repositorio e instalá las dependencias:

```bash
git clone https://github.com/tu-usuario/altura_rios.git
cd altura_rios
npm install
```

## Uso local

Iniciá el servidor:

```bash
npm start
```

También podés usar:

```bash
npm run dev
```

Por defecto la aplicación queda disponible en:

```text
http://localhost:3000
```

Si el puerto está ocupado, el servidor intenta usar el siguiente puerto disponible dentro del rango configurado.

## Scripts disponibles

```bash
npm start
```

Inicia el servidor Express.

```bash
npm run build:pages
```

Genera configuración para Pages.

```bash
npm run import:historico
```

Importa datos históricos a una base SQLite local.

```bash
npm run sync:paraguay
```

Descarga datos de DMH Paraguay y los guarda en SQLite.

## API

### Salud del servicio

```http
GET /api/health
```

Devuelve el estado básico del backend.

### Alturas de la cuenca del Paraná

```http
GET /api/data
```

Obtiene alturas desde FICH/UNL y guarda la última extracción diaria en SQLite.

### Río Paraguay DMH

```http
GET /api/rio-paraguay-dmh
```

Obtiene estaciones convencionales del Río Paraguay desde DMH Paraguay y guarda la extracción en SQLite.

## Variables de entorno

Copiá `.env.example` a `.env` si usás Turso en local. Sin `TURSO_DATABASE_URL` se usan archivos SQLite en `data/`.

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | URL libsql de Turso (requerida en Vercel) | — |
| `TURSO_AUTH_TOKEN` | Token de Turso | — |
| `CRON_SECRET` | Bearer para `GET /api/cron/sync` (Vercel Cron) | — |
| `PORT` | Puerto base del servidor | `3000` |
| `CORS_ORIGIN` | Orígenes permitidos separados por coma | `*` |
| `TRUST_PROXY` | `1` detrás de Vercel/CDN | — |
| `FETCH_TIMEOUT_MS` | Timeout para consultar FICH/UNL | `30000` |
| `FETCH_RETRIES` | Cantidad de reintentos de fetch | `2` |
| `SQLITE_PATH` | Ruta SQLite principal (sin Turso) | `data/alturas.sqlite` |
| `PARAGUAY_SQLITE_PATH` | Ruta SQLite Paraguay (sin Turso) | `data/paraguay_dmh.sqlite` |
| `PASOS_SQLITE_PATH` | Ruta SQLite pasos (sin Turso) | `data/pasos.sqlite` |
| `DAILY_COMMAND` | Comando diario usado por `croniter_daily.py` | `npm run sync:paraguay` |

## Persistencia local

Las bases SQLite se crean automáticamente dentro de `data/` cuando se ejecutan endpoints o scripts que guardan información.

- `data/alturas.sqlite`: última extracción diaria por puerto.
- `data/paraguay_dmh.sqlite`: extracciones de estaciones convencionales del Río Paraguay.
- `data/historico_<id>_<tiempo>.sqlite`: bases generadas por el importador histórico.

## Sincronización diaria opcional

El archivo `croniter_daily.py` ejecuta un comando una vez por día a la hora configurada en el script.

Ejemplo:

```bash
python3 croniter_daily.py
```

Por defecto ejecuta:

```bash
npm run sync:paraguay
```

También se incluye `croniter_daily.service` para usarlo como servicio systemd.

## Despliegue en Vercel (recomendado)

Vercel no permite SQLite en disco. La app usa Turso cuando están definidas `TURSO_*`.

1. Creá una base en [Turso](https://turso.tech) y obtené `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
2. Migrá el esquema e importá tus datos locales (una vez):

```bash
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
npm run migrate:turso
npm run import:turso
```

3. En [Vercel](https://vercel.com): Importá el repo `altura_rios` y configurá en Environment Variables:

| Variable | Valor |
| --- | --- |
| `TURSO_DATABASE_URL` | tu URL libsql |
| `TURSO_AUTH_TOKEN` | tu token |
| `TRUST_PROXY` | `1` |
| `NODE_ENV` | `production` |

4. Deploy. La entrada serverless es `api/index.js` (`vercel.json`).
5. Configurá también `CRON_SECRET`: Vercel llama cada día a `/api/cron/sync` (11:00 UTC) y scrapea Paraná + Paraguay guardando en Turso.

Sync manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://altura-rios.vercel.app/api/cron/sync
```

CLI opcional: `npx vercel` / `npx vercel --prod` (después de `npx vercel login`).

**Importante:** no subas el token al repo. Si lo pegaste en un chat, rotálo en el dashboard de Turso.

## Despliegue en Render

El archivo `render.yaml` define un servicio web Node.js y un cron. Con disco en `/var/data` podés seguir usando SQLite (sin Turso).

## Fuentes de datos

- FICH/UNL: alturas de la cuenca del Paraná.
- DMH Paraguay: estaciones convencionales del Río Paraguay.

Este proyecto consulta fuentes públicas y puede requerir ajustes si cambia el HTML de los sitios de origen.

## Licencia

ISC
