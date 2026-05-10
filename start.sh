#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
START_MONGO="${START_MONGO:-1}"
START_WORKER="${START_WORKER:-0}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
INSTALL_WORKER_DEPS="${INSTALL_WORKER_DEPS:-0}"
WORKER_NAME="${WORKER_NAME:-Local Worker}"
WORKER_OUTPUT="${WORKER_OUTPUT:-./runs}"

BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"

log() {
  printf '\033[1;34m[ft-marketplace]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[ft-marketplace]\033[0m %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

wait_for_backend() {
  log "Waiting for backend health check"
  .venv/bin/python - "$BACKEND_URL/api/health" <<'PY'
import sys
import time
import urllib.error
import urllib.request

url = sys.argv[1]
deadline = time.time() + 45
last_error = None

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            if response.status == 200:
                raise SystemExit(0)
    except (OSError, urllib.error.URLError) as exc:
        last_error = exc
    time.sleep(1)

print(f"Backend did not become healthy at {url}: {last_error}", file=sys.stderr)
raise SystemExit(1)
PY
}

cleanup() {
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -f ".env" && -f ".env.example" ]]; then
  log "Creating .env from .env.example"
  cp .env.example .env
fi

if [[ "$START_MONGO" == "1" ]]; then
  if has_cmd docker; then
    log "Starting MongoDB with Docker Compose"
    docker compose up -d mongo
  else
    warn "Docker is not installed; backend will use MongoDB if already running, otherwise memory fallback."
  fi
fi

if [[ ! -d ".venv" ]]; then
  log "Creating Python virtual environment"
  python3 -m venv .venv
fi

if [[ "$INSTALL_DEPS" == "1" ]]; then
  log "Installing backend dependencies"
  .venv/bin/pip install -r backend/requirements.txt

  if [[ "$INSTALL_WORKER_DEPS" == "1" || "$START_WORKER" == "1" ]]; then
    log "Installing worker fine-tuning dependencies"
    .venv/bin/pip install -r backend/requirements-worker.txt
  fi

  log "Installing frontend dependencies"
  npm install --prefix frontend
fi

log "Starting FastAPI at ${BACKEND_URL}"
.venv/bin/uvicorn app.main:app \
  --app-dir backend \
  --host "$BACKEND_HOST" \
  --port "$BACKEND_PORT" &
BACKEND_PID=$!

log "Starting React app at ${FRONTEND_URL}"
npm run dev --prefix frontend -- \
  --host "$FRONTEND_HOST" \
  --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

if [[ "$START_WORKER" == "1" ]]; then
  wait_for_backend
  log "Starting local worker"
  PYTHONPATH=backend .venv/bin/python -m app.worker.local_worker \
    --api "$BACKEND_URL" \
    --name "$WORKER_NAME" \
    --output "$WORKER_OUTPUT" &
  WORKER_PID=$!
fi

cat <<EOF

Fine-tuning marketplace is starting.

Frontend: ${FRONTEND_URL}
Backend:  ${BACKEND_URL}
Docs:     ${BACKEND_URL}/docs

Useful options:
  START_WORKER=1 ./start.sh              Start a local training worker too
  INSTALL_WORKER_DEPS=1 ./start.sh       Install PyTorch/Transformers/PEFT
  START_MONGO=0 ./start.sh               Skip Docker Compose Mongo startup
  INSTALL_DEPS=0 ./start.sh              Skip dependency installation

Press Ctrl+C to stop the app processes started by this script.

EOF

wait
