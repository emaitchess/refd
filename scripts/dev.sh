#!/usr/bin/env bash
set -euo pipefail

site_pid=''

cleanup() {
  if [[ -n "$site_pid" ]]; then
    kill "$site_pid" 2>/dev/null || true
    wait "$site_pid" 2>/dev/null || true
  fi
  caddy stop 2>/dev/null || true
}

trap cleanup EXIT INT TERM

bunx wrangler d1 migrations apply refd --local
caddy start --config Caddyfile 2>/dev/null
bun run site:dev &
site_pid=$!
bun run app:dev
