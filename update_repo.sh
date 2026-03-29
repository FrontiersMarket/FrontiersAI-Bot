#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-}"
CONTAINER="frontiersai-bot"

if [ -n "$BRANCH" ]; then
  echo "=== Switching to branch: $BRANCH ==="
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo "=== Pulling latest changes ==="
  git pull
fi

CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null || echo "")

if [ -z "$CHANGED" ]; then
  echo "Nothing changed."
  exit 0
fi

echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'
echo ""

# ── Workspace sync ────────────────────────────────────────────────────
if echo "$CHANGED" | grep -q "^workspace/"; then
  echo "=== Syncing workspace ==="
  rsync -a --delete workspace/ .tmpdata/workspace/
  echo "  workspace synced ✓"
fi

# ── Docker rebuild (Dockerfile or src/ changed) ───────────────────────
if echo "$CHANGED" | grep -qE "^(Dockerfile|src/|config/)"; then
  echo "=== Rebuilding Docker image ==="
  docker build -t "$CONTAINER" .
  echo "=== Recreating container ==="
  docker stop "$CONTAINER" 2>/dev/null || true
  docker rm "$CONTAINER" 2>/dev/null || true
  pnpm up
  echo "  container rebuilt and restarted ✓"
else
  echo "=== Restarting container ==="
  docker restart "$CONTAINER"
  echo "  restarted ✓"
fi

echo ""
echo "=== Deploy complete ==="
