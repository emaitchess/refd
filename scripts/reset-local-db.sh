#!/usr/bin/env bash
# Reset the local dev state to a clean slate, then re-apply migrations.
#
# Removes .wrangler/state/v3 — the miniflare store for local D1 (users,
# workspaces, prompts, runs…), R2 raw payloads, Queues, and the login/register
# rate-limit rows — then recreates an empty D1 with every migration applied.
#
# Stop `bun run dev` first: miniflare holds these files open while it runs.
# Usage: bun run db:reset   (or: bash scripts/reset-local-db.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

STATE_DIR=".wrangler/state/v3"

if pgrep -f "vite dev" >/dev/null 2>&1; then
  echo "⚠  A dev server (vite) is running — it holds the local state open." >&2
  echo "   Stop it (Ctrl-C in that terminal), then re-run: bun run db:reset" >&2
  exit 1
fi

echo "→ removing $STATE_DIR (D1, R2, Queues, rate-limits)…"
rm -rf "$STATE_DIR"

echo "→ applying migrations to a fresh local D1…"
bunx wrangler d1 migrations apply refd --local

echo "✓ Local state reset. Start the app with 'bun run dev' and register a new"
echo "  account to walk the onboarding flow from scratch."
