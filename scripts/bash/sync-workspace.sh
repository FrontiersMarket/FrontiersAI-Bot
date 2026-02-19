#!/bin/bash
# Sync workspace .md files from repo → Docker volume
#
# Usage:
#   ./sync-workspace.sh           # one-shot sync
#   ./sync-workspace.sh --watch   # watch for changes and auto-sync

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$REPO_DIR/workspace"
DEST="$REPO_DIR/.tmpdata/workspace"

if [ ! -d "$SRC" ]; then
  echo "Error: workspace/ directory not found at $SRC"
  exit 1
fi

sync_files() {
  mkdir -p "$DEST"
  rsync -av --include='*.md' --exclude='*' "$SRC/" "$DEST/"
  echo "[sync] Done at $(date +%H:%M:%S)"
}

if [ "$1" = "--watch" ]; then
  echo "[watch] Watching $SRC for .md changes (polling every 2s)..."
  echo "[watch] Press Ctrl+C to stop"
  sync_files

  # Store initial checksums
  LAST_HASH=$(find "$SRC" -name '*.md' -exec md5 -q {} + 2>/dev/null | sort | md5 -q)

  while true; do
    sleep 2
    CURRENT_HASH=$(find "$SRC" -name '*.md' -exec md5 -q {} + 2>/dev/null | sort | md5 -q)
    if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
      echo "[watch] Changes detected, syncing..."
      sync_files
      LAST_HASH="$CURRENT_HASH"
    fi
  done
else
  sync_files
fi
