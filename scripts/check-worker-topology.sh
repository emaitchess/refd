#!/usr/bin/env bash
# Guard: exactly one Worker (the API Worker) owns the cron trigger and the queue
# consumer. Cron/queues on the dashboard or web Worker would double-run the
# nightly job or split queue processing. CI fails if the topology drifts.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

for cfg in apps/dashboard/wrangler.jsonc apps/web/wrangler.jsonc; do
  [ -f "$cfg" ] || continue
  if grep -qE '"(triggers|crons|queues)"' "$cfg"; then
    echo "error: $cfg declares cron/queues — only apps/api may." >&2
    fail=1
  fi
done

if ! grep -q '"crons"' apps/api/wrangler.jsonc; then
  echo "error: apps/api/wrangler.jsonc is missing its cron trigger." >&2
  fail=1
fi
if ! grep -q '"consumers"' apps/api/wrangler.jsonc; then
  echo "error: apps/api/wrangler.jsonc is missing its queue consumer." >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "worker topology ok: cron + queue consumer live only on apps/api"
fi
exit "$fail"
