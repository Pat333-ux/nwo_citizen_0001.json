#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# .env is a trusted, shell-compatible local file. Never commit it.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

required=(DATABASE_URL JWT_SECRET PII_KEY_HEX POVERTY_LEVEL_MONTHLY)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[ERROR] Missing required environment variable: $name" >&2
    exit 1
  fi
done

if [[ ${#JWT_SECRET} -lt 32 ]]; then
  echo "[ERROR] JWT_SECRET must be at least 32 characters." >&2
  exit 1
fi
if [[ ! "$PII_KEY_HEX" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "[ERROR] PII_KEY_HEX must contain exactly 64 hexadecimal characters." >&2
  exit 1
fi
if [[ ! "$POVERTY_LEVEL_MONTHLY" =~ ^[0-9]+([.][0-9]+)?$ ]] || awk "BEGIN { exit !($POVERTY_LEVEL_MONTHLY > 0) }"; then
  :
else
  echo "[ERROR] POVERTY_LEVEL_MONTHLY must be a positive number." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1 || ! command -v pm2 >/dev/null 2>&1; then
  echo "[ERROR] Node.js/npm and PM2 must be installed before running this script." >&2
  exit 1
fi

mkdir -p logs

echo "[+] Installing locked dependencies..."
npm ci

echo "[+] Running project checks..."
npm run typecheck
npm run lint
npm test

if [[ "${START_LOCAL_DB:-0}" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] START_LOCAL_DB=1 but Docker is not installed." >&2
    exit 1
  fi
  echo "[+] Starting the local PostgreSQL service..."
  docker compose up -d --wait db
fi

if [[ ! -f ecosystem.config.cjs ]]; then
  echo "[ERROR] ecosystem.config.cjs not found in $SCRIPT_DIR" >&2
  exit 1
fi

echo "[+] Starting/reloading BEAST API under PM2..."
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null; then
    echo "[+] Health endpoint returned success."
    pm2 status
    exit 0
  fi
  sleep 2
done

echo "[ERROR] Health endpoint did not become ready. Recent PM2 logs:" >&2
pm2 logs beast-api --lines 100 --nostream >&2 || true
exit 1
