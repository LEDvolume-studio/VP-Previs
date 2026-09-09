#!/usr/bin/env bash

# Start the Rayzee editor in the background.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/.local-runtime"
PID_FILE="$RUNTIME_DIR/rayzee-app.pid"
LOG_FILE="$RUNTIME_DIR/rayzee-app.log"
PORT="${PORT:-5173}"
LOCAL_NODE="$RUNTIME_DIR/node/bin/node"
LOCAL_NPM_CLI="$SCRIPT_DIR/node_modules/npm/bin/npm-cli.js"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(<"$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "Rayzee editor is already running (PID $PID)."
    echo "Open http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ -x "$LOCAL_NODE" && -f "$LOCAL_NPM_CLI" ]]; then
  # Prefer the self-contained runtime bundled with this checkout.
  export PATH="$(dirname "$LOCAL_NODE"):$PATH"
  NPM_COMMAND=("$LOCAL_NODE" "$LOCAL_NPM_CLI")
else
  NPM_BIN="$(command -v npm || true)"
  if [[ -z "$NPM_BIN" ]]; then
    echo "Node/npm was not found locally or on PATH."
    exit 1
  fi
  NPM_COMMAND=("$NPM_BIN")
fi

if [[ ! -x "$SCRIPT_DIR/node_modules/.bin/vite" ]]; then
  echo "Dependencies are not installed. Run: npm install"
  exit 1
fi

cd "$SCRIPT_DIR"
nohup "${NPM_COMMAND[@]}" -w @rayzee/app run dev -- --port "$PORT" >"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"

sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Rayzee editor failed to start. See $LOG_FILE"
  exit 1
fi

echo "Rayzee editor started (PID $PID)."
echo "Open http://localhost:$PORT"
echo "Log: $LOG_FILE"
