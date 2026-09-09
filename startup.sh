#!/bin/sh
set -eu
cd /workspace
if [ -f /workspace/secrets/runtime.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /workspace/secrets/runtime.env
  set +a
fi
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
