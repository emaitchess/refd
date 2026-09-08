#!/usr/bin/env bash
#
# Per-repo wt setup: replicate the working main checkout into a fresh worktree.
#
# Runs automatically on `wt create` with:
#   $1 = worktree path, $2 = main repo root (also WT_PATH / WT_REPO_ROOT).
#
# Copies every untracked or generated file a refd checkout needs to work:
#   - node_modules (bun install; the pre-commit hook needs installed types)
#   - .wrangler/                      root wrangler state (its own D1/KV/R2/DO)
#   - apps/*/.wrangler/               per-app wrangler state (API local data:
#                                     D1, R2 raws, KV) and caches
#   - apps/*/worker-configuration.d.ts  generated runtime types (check would
#                                     regenerate these, but the copy keeps
#                                     tsc and editors working immediately)
#   - apps/api/.dev.vars              local secrets (JWT, BrightData, Exa, ...)
#   - .mcp-registry-key.hex           local credential (mode 0600 preserved)
#
# Not copied, on purpose:
#   - dist/, .astro/, .DS_Store       regenerable build/dev caches
#   - .husky/_/                       recreated by bun install (husky hook)
#   - internal untracked docs (GTM.md, KEYWORD-MAP.md, docs/plan-*.md, ...):
#     they stay out of worktrees so a blanket `git add -A` can never commit them
#   - /etc/hosts entries and `caddy trust` are machine-level, one-time setup
#     (see AGENTS.md) and cannot be scripted from here.
#
# Copies are non-clobbering: setup only runs on fresh creation anyway, but a
# rerun (or `--setup` override) never overwrites worktree-local changes.
# Stop any running `wrangler dev` before creating a worktree: copying sqlite
# WAL files mid-write can produce an inconsistent snapshot.
set -euo pipefail

WORKTREE_DIR="${1:-${WT_PATH:?worktree path missing}}"
REPO_ROOT="${2:-${WT_REPO_ROOT:?repo root missing}}"

echo "wt setup: seeding $WORKTREE_DIR"

cd "$WORKTREE_DIR"
bun install

copy_if_present() {
  local src="$1" dst="$2" label="$3"
  if [[ ! -e "$src" ]]; then
    echo "  skip $label: not present in $REPO_ROOT"
    return 0
  fi
  if [[ -e "$dst" ]]; then
    echo "  skip $label: already present"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
  echo "  copied $label"
}

# Root wrangler state, every app's wrangler dir, and generated runtime types.
copy_if_present "$REPO_ROOT/.wrangler" "$WORKTREE_DIR/.wrangler" ".wrangler/"
for src in "$REPO_ROOT"/apps/*/.wrangler; do
  [[ -e "$src" ]] || continue
  copy_if_present "$src" "$WORKTREE_DIR/${src#"$REPO_ROOT"/}" "${src#"$REPO_ROOT"/}"
done
for src in "$REPO_ROOT"/apps/*/worker-configuration.d.ts; do
  [[ -e "$src" ]] || continue
  copy_if_present "$src" "$WORKTREE_DIR/${src#"$REPO_ROOT"/}" "${src#"$REPO_ROOT"/}"
done

copy_if_present \
  "$REPO_ROOT/apps/api/.dev.vars" \
  "$WORKTREE_DIR/apps/api/.dev.vars" \
  "apps/api/.dev.vars"

if [[ -f "$REPO_ROOT/.mcp-registry-key.hex" && ! -e "$WORKTREE_DIR/.mcp-registry-key.hex" ]]; then
  cp "$REPO_ROOT/.mcp-registry-key.hex" "$WORKTREE_DIR/.mcp-registry-key.hex"
  chmod 600 "$WORKTREE_DIR/.mcp-registry-key.hex"
  echo "  copied .mcp-registry-key.hex (mode 600)"
fi

echo "wt setup: done"
