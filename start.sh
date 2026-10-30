#!/usr/bin/env bash
# start.sh — launch PayMate Sandbox in background (127.0.0.1 only)
# Uses python3 subprocess with detached session; avoids inheriting the caller's stdout pipe.
set -eu
cd "$(dirname "$0")"

if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then
  echo "[start] already running (pid $(cat server.pid))"; exit 0
fi

PORT="${PAYMATE_PORT:-8787}"
python3 - "$PORT" << 'PY'
import subprocess, sys, os
port = sys.argv[1]
env = dict(os.environ); env['PAYMATE_PORT'] = port
env.setdefault('NODE_OPTIONS', '--max-old-space-size=128')
log = open('server.log', 'ab')
p = subprocess.Popen(['node', 'server.js'], cwd='.', stdin=subprocess.DEVNULL,
                     stdout=log, stderr=subprocess.STDOUT,
                     start_new_session=True, close_fds=True, env=env)
open('server.pid', 'w').write(str(p.pid))
open('server.port', 'w').write(port)
print(f'[start] launched pid={p.pid} port={port}')
PY

sleep 1
if kill -0 "$(cat server.pid)" 2>/dev/null; then
  echo "[start] OK -> http://127.0.0.1:$(cat server.port)/"
else
  echo "[start] FAILED — see server.log"; exit 1
fi
