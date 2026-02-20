#!/bin/bash
# Sync workspace .md files, skills/, and resources/ from repo → Docker volume
#
# Usage:
#   ./sync-workspace.sh           # one-shot sync
#   ./sync-workspace.sh --watch   # watch for changes and auto-sync

set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO_DIR/workspace"
DEST="$REPO_DIR/.tmpdata/workspace"
RESOURCES_SRC="$REPO_DIR/resources"
RESOURCES_DEST="$REPO_DIR/.tmpdata/resources"

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
  # Sync top-level .md files
  rsync -av --include='*.md' --exclude='*' "$SRC/" "$DEST/"
  # Sync skills/ directory (excluding dependency artifacts)
  if [ -d "$SRC/skills" ]; then
    mkdir -p "$DEST/skills"
    rsync -av \
      --exclude='node_modules' \
      --exclude='__pycache__' \
      --exclude='.venv' \
      --exclude='venv' \
      --exclude='.eggs' \
      --exclude='site-packages' \
      --exclude='*.egg-info' \
      "$SRC/skills/" "$DEST/skills/"
  fi
  # Sync resources/ directory (all files)
  if [ -d "$RESOURCES_SRC" ]; then
    mkdir -p "$RESOURCES_DEST"
    rsync -av "$RESOURCES_SRC/" "$RESOURCES_DEST/"
    echo "[sync] Resources synced at $(date +%H:%M:%S)"
  fi
  remove_bootstrap
  echo "[sync] Done at $(date +%H:%M:%S)"
}

compute_hash() {
  # Hash .md files, skills/*, and resources/* for change detection
  {
    find "$SRC" -maxdepth 1 -name '*.md' -exec md5 -q {} + 2>/dev/null | sort
    find "$SRC/skills" -type f -exec md5 -q {} + 2>/dev/null | sort
    find "$RESOURCES_SRC" -type f -exec md5 -q {} + 2>/dev/null | sort
  } | md5 -q || echo "empty"
}

if [ "$1" = "--watch" ]; then
  echo "[watch] Watching $SRC and $RESOURCES_SRC for changes (polling every 2s)..."
  echo "[watch] Press Ctrl+C to stop"
  sync_files

  LAST_HASH=$(compute_hash)

  while true; do
    sleep 2
    remove_bootstrap
    CURRENT_HASH=$(compute_hash)
    if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
      echo "[watch] Changes detected, syncing..."
      sync_files
      LAST_HASH="$CURRENT_HASH"
    fi
  done
else
  sync_files
fi
