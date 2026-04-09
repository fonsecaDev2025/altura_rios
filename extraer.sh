#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Uso:
  ./extraer.sh [BASE_URL]

Ejemplos:
  ./extraer.sh
  ./extraer.sh https://altura-rios.onrender.com
  BASE_URL=https://altura-rios.onrender.com OUT_DIR=./exports ./extraer.sh

Variables opcionales:
  BASE_URL  URL base del backend (por defecto: https://altura-rios.onrender.com)
  OUT_DIR   Carpeta de salida (por defecto: ./exports)
EOF
  exit 0
fi

BASE_URL="${1:-${BASE_URL:-https://altura-rios.onrender.com}}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${OUT_DIR:-./exports}"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$OUT_DIR"

fetch_endpoint() {
  local endpoint="$1"
  local outfile="$2"
  local timeout="$3"
  local tmp
  tmp="$(mktemp)"

  echo "-> Descargando ${BASE_URL}${endpoint}"

  if ! curl -fsSL \
    --connect-timeout 20 \
    --max-time "$timeout" \
    --retry 2 \
    --retry-delay 3 \
    --retry-all-errors \
    -H "Accept: application/json" \
    "${BASE_URL}${endpoint}" \
    -o "$tmp"; then
    echo "   ERROR: no se pudo descargar ${endpoint}"
    rm -f "$tmp"
    return 1
  fi

  if ! node -e 'const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));if(d&&d.ok===false){console.error(d.error||"API respondió ok=false");process.exit(2)}' "$tmp"; then
    echo "   ERROR: respuesta inválida u ok=false en ${endpoint}"
    cp "$tmp" "${outfile%.json}.error.json" || true
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$outfile"
  echo "   OK: $outfile"
  return 0
}

PNA_FILE="${OUT_DIR}/pna_${STAMP}.json"
PARAGUAY_FILE="${OUT_DIR}/paraguay_${STAMP}.json"

pna_ok=0
par_ok=0

if fetch_endpoint "/api/data" "$PNA_FILE" 240; then
  cp "$PNA_FILE" "${OUT_DIR}/pna_latest.json"
  pna_ok=1
fi

if fetch_endpoint "/api/rio-paraguay-dmh" "$PARAGUAY_FILE" 120; then
  cp "$PARAGUAY_FILE" "${OUT_DIR}/paraguay_latest.json"
  par_ok=1
fi

if [[ "$pna_ok" -eq 0 && "$par_ok" -eq 0 ]]; then
  echo ""
  echo "Fallaron ambos endpoints. Revisa logs en Render y vuelve a intentar."
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  [[ "$pna_ok" -eq 1 ]] && jq '.items' "$PNA_FILE" > "${PNA_FILE%.json}_items.json"
  [[ "$par_ok" -eq 1 ]] && jq '.items' "$PARAGUAY_FILE" > "${PARAGUAY_FILE%.json}_items.json"
fi

echo ""
echo "Extracción terminada."
[[ "$pna_ok" -eq 1 ]] && echo "- PNA guardado en: $PNA_FILE"
[[ "$par_ok" -eq 1 ]] && echo "- Paraguay guardado en: $PARAGUAY_FILE"
echo "- Últimos accesos rápidos:"
[[ "$pna_ok" -eq 1 ]] && echo "  ${OUT_DIR}/pna_latest.json"
[[ "$par_ok" -eq 1 ]] && echo "  ${OUT_DIR}/paraguay_latest.json"

