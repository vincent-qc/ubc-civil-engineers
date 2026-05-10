#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
START_MONGO="${START_MONGO:-1}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
PYTHON_BIN="${PYTHON_BIN:-}"

BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"

log() {
  printf '\033[1;34m[browser-agent]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[browser-agent]\033[0m %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

pick_python() {
  if [[ -n "$PYTHON_BIN" ]]; then
    printf '%s\n' "$PYTHON_BIN"
    return
  fi
  for candidate in python3.12 python3.11 python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.13 python3; do
    if has_cmd "$candidate" || [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  printf '%s\n' "python3"
}

cleanup() {
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

PYTHON_BIN="$(pick_python)"
log "Using Python: ${PYTHON_BIN}"

if [[ ! -d ".venv" ]]; then
  log "Creating Python virtual environment"
  "$PYTHON_BIN" -m venv .venv
fi

if [[ "$INSTALL_DEPS" == "1" ]]; then
  log "Installing backend dependencies"
  .venv/bin/pip install -r backend/requirements.txt

  log "Installing frontend dependencies"
  npm install --prefix frontend
fi

log "Starting FastAPI at ${BACKEND_URL}"
.venv/bin/uvicorn app.main:app \
  --app-dir backend \
  --host "$BACKEND_HOST" \
  --port "$BACKEND_PORT" &
BACKEND_PID=$!

log "Starting Next.js app at ${FRONTEND_URL}"
npm run dev --prefix frontend -- \
  --hostname "$FRONTEND_HOST" \
  --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

cat <<EOF

Personal browser agent is starting.

Frontend: ${FRONTEND_URL}
Backend:  ${BACKEND_URL}
Docs:     ${BACKEND_URL}/docs

Useful options:
  START_MONGO=0 ./start.sh     Skip Docker Compose Mongo startup
  INSTALL_DEPS=0 ./start.sh    Skip dependency installation
  PYTHON_BIN=python3.12 ./start.sh

Press Ctrl+C to stop the app processes started by this script.

EOF

wait
