#!/usr/bin/env bash

# Stop the Rayzee editor started by start.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.local-runtime/rayzee-app.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Rayzee editor is not running."
  exit 0
fi

PID="$(<"$PID_FILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Removed stale PID file; Rayzee editor is not running."
  exit 0
fi

kill "$PID"
for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Rayzee editor stopped."
    exit 0
  fi
  sleep 0.25
done

echo "Rayzee editor did not stop cleanly; force-stopping PID $PID."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
