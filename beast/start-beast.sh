#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p logs

REQUIRED_VARS=(
  DATABASE_URL
  JWT_SECRET
  PII_KEY_HEX
  POVERTY_LEVEL_MONTHLY
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "[ERROR] Missing required environment variable: $var"
    echo "Set it in your shell or a .env file before running this script."
    exit 1
  fi
done

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[+] Installing PM2..."
  npm install -g pm2
fi

if [ -f package.json ]; then
  echo "[+] Installing app dependencies..."
  npm install
fi

if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  echo "[+] Ensuring PostgreSQL is running..."
  docker compose up -d db || true
fi

if [ ! -f ecosystem.config.js ]; then
  echo "[ERROR] ecosystem.config.js not found in $SCRIPT_DIR"
  exit 1
fi

echo "[+] Starting BEAST API with PM2..."
pm2 start ecosystem.config.js --update-env
pm2 save
pm2 status

echo "[+] Startup complete. Logs:"
echo "   pm2 logs beast-api --lines 100"
echo "   curl -i http://127.0.0.1:${PORT:-3000}/healthz"
