#!/usr/bin/env bash
# stop.sh — stop the background PayMate Sandbox started by start.sh
set -eu
cd "$(dirname "$0")"

if [ ! -f server.pid ]; then echo "[stop] no server.pid"; exit 0; fi
PID="$(cat server.pid)"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for i in 1 2 3 4 5; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
  echo "[stop] stopped pid $PID"
else
  echo "[stop] pid $PID not running"
fi
rm -f server.pid server.port
