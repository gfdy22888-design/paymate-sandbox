#!/usr/bin/env bash
# stop.sh — stop the background PayMate Sandbox started by start.sh
set -eu
cd "$(dirname "$0")"

python3 - <<'PY'
import os, pathlib, signal, time
root = pathlib.Path.cwd().resolve()
pidfile = root / 'server.pid'
if not pidfile.exists():
    print('[stop] no server.pid'); raise SystemExit(0)
raw = pidfile.read_text().strip()
if not raw.isdigit() or int(raw) <= 1:
    raise SystemExit('[stop] invalid PID; nothing stopped')
pid = int(raw)
proc = pathlib.Path('/proc') / raw
if not pathlib.Path('/proc').is_dir():
    raise SystemExit('[stop] cannot verify process identity on this OS; stop it manually')
if proc.exists():
    try:
        cwd = (proc / 'cwd').resolve(strict=True)
        args = (proc / 'cmdline').read_bytes().split(b'\0')
        executable = pathlib.Path(os.fsdecode(args[0])).name.lower()
        targets = [pathlib.Path(os.fsdecode(a)) for a in args[1:] if a]
        ours = cwd == root and executable in ('node', 'nodejs') and any((cwd / a).resolve() == root / 'server.js' for a in targets)
    except (OSError, ValueError):
        ours = False
    if not ours:
        raise SystemExit('[stop] PID identity differs from this project; nothing stopped')
    os.kill(pid, signal.SIGTERM)
    for _ in range(20):
        if not proc.exists(): break
        time.sleep(0.1)
    # Do not use a broad process-name kill or unconditional SIGKILL.
    print('[stop] sent SIGTERM to verified project process', pid)
else:
    print('[stop] recorded project process is no longer running')
for name in ('server.pid', 'server.port'):
    (root / name).unlink(missing_ok=True)
PY
