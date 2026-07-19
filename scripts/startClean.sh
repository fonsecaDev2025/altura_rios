#!/usr/bin/env bash
# Libera puertos de la app (3000–3014 y db:studio 4983) y arranca el servidor.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_PORT="${PORT:-3000}"
END_PORT=$((BASE_PORT + 14))
PORTS=()
for ((p=BASE_PORT; p<=END_PORT; p++)); do PORTS+=("$p"); done
PORTS+=(4983)

echo "→ Cerrando instancias previas de altura_rios…"
pkill -f "$ROOT/server.js" 2>/dev/null || true
pkill -f "$ROOT/scripts/dbStudio.js" 2>/dev/null || true
# Solo "npm run start" exacto (no matar este "start:clean")
pkill -f "npm run start$" 2>/dev/null || true
pkill -f "npm run db:studio$" 2>/dev/null || true

sleep 0.4

for p in "${PORTS[@]}"; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${p}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    kill -9 $(lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
  fi
done

sleep 0.3
echo "→ Arrancando en puerto ${BASE_PORT} (fallback automático si está ocupado)…"
exec node server.js
