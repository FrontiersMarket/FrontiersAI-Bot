#!/bin/bash
# Sync workspace .md files from repo → Docker volume
#
# Usage:
#   ./sync-workspace.sh           # one-shot sync
#   ./sync-workspace.sh --watch   # watch for changes and auto-sync

set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO_DIR/workspace"
DEST="$REPO_DIR/.tmpdata/workspace"

if [ ! -d "$SRC" ]; then
  echo "Error: workspace/ directory not found at $SRC"
  exit 1
fi

remove_bootstrap() {
  if [ -f "$DEST/BOOTSTRAP.md" ]; then
    rm -f "$DEST/BOOTSTRAP.md"
    echo "[sync] Removed BOOTSTRAP.md from workspace at $(date +%H:%M:%S)"
  fi
}

sync_files() {
  mkdir -p "$DEST"
  rsync -av --include='*.md' --exclude='*' "$SRC/" "$DEST/"
  remove_bootstrap
  echo "[sync] Done at $(date +%H:%M:%S)"
}

if [ "$1" = "--watch" ]; then
  echo "[watch] Watching $SRC for .md changes (polling every 2s)..."
  echo "[watch] Press Ctrl+C to stop"
  sync_files

  # Store initial checksums
  LAST_HASH=$(find "$SRC" -name '*.md' -exec md5 -q {} + 2>/dev/null | sort | md5 -q || echo "empty")

  while true; do
    sleep 2
    remove_bootstrap
    CURRENT_HASH=$(find "$SRC" -name '*.md' -exec md5 -q {} + 2>/dev/null | sort | md5 -q || echo "empty")
    if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
      echo "[watch] Changes detected, syncing..."
      sync_files
      LAST_HASH="$CURRENT_HASH"
    fi
  done
else
  sync_files
fi
