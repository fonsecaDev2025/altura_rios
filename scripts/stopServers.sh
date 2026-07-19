#!/usr/bin/env bash
# Cierra servidores Node de altura_rios (puertos 3000–3014 y 4983).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_PORT="${PORT:-3000}"
END_PORT=$((BASE_PORT + 14))

echo "→ Deteniendo npm/node de $ROOT…"
pkill -f "$ROOT/server.js" 2>/dev/null || true
pkill -f "$ROOT/scripts/dbStudio.js" 2>/dev/null || true
# Evitar matar "start:clean" (el patrón "start" es prefijo).
pkill -f "npm run start([^:]|$)" 2>/dev/null || true
pkill -f "npm run db:studio" 2>/dev/null || true

sleep 0.3

for ((p=BASE_PORT; p<=END_PORT; p++)); do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${p}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    kill -9 $(lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
  fi
done
fuser -k 4983/tcp 2>/dev/null || true

sleep 0.2
left="$(ss -tlnp 2>/dev/null | grep -E ":(($BASE_PORT|$((BASE_PORT+1))|$((BASE_PORT+2))|$((BASE_PORT+3))|$((BASE_PORT+4))|4983))\\b" || true)"
if [[ -n "$left" ]]; then
  echo "Aún hay listeners:"
  echo "$left"
  exit 1
fi
echo "✓ Puertos libres ($BASE_PORT–$END_PORT, 4983)."
