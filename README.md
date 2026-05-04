# Altura Ríos Dashboard

Dashboard web para consultar alturas hidrométricas de ríos, con datos obtenidos desde fuentes públicas de FICH/UNL y DMH Paraguay.

El proyecto incluye un servidor Express, una interfaz web estática, parsers livianos basados en HTML y persistencia local con SQLite.

## Características

- Dashboard para alturas de la cuenca del Paraná.
- Vista separada para estaciones convencionales del Río Paraguay publicadas por DMH Paraguay.
- API REST para consultar datos en formato JSON.
- Persistencia diaria en SQLite.
- Scripts para importar históricos y actualizar datos locales.
- Configuración lista para desplegar en Render.

## Tecnologías

- Node.js 18 o superior
- Express
- better-sqlite3
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

El proyecto funciona localmente sin configuración adicional, pero estas variables permiten personalizar rutas, CORS, tiempos de espera y sincronización local:

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `PORT` | Puerto base del servidor | `3000` |
| `CORS_ORIGIN` | Orígenes permitidos separados por coma | `*` |
| `FETCH_TIMEOUT_MS` | Timeout para consultar FICH/UNL | `30000` |
| `FETCH_RETRIES` | Cantidad de reintentos de fetch | `2` |
| `SQLITE_PATH` | Ruta de la base SQLite principal | `data/alturas.sqlite` |
| `PARAGUAY_SQLITE_PATH` | Ruta de la base SQLite de DMH Paraguay | `data/paraguay_dmh.sqlite` |
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

## Despliegue

El archivo `render.yaml` define:

- Un servicio web Node.js para la aplicación.
- Un cron job diario para ejecutar tareas programadas.

Para desplegar en Render, conectá el repositorio y configurá las variables de entorno necesarias para tu entorno.

## Fuentes de datos

- FICH/UNL: alturas de la cuenca del Paraná.
- DMH Paraguay: estaciones convencionales del Río Paraguay.

Este proyecto consulta fuentes públicas y puede requerir ajustes si cambia el HTML de los sitios de origen.

## Licencia

ISC
