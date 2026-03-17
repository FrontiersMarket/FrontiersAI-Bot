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

# Excluded directory names for skills sync
EXCLUDED_DIRS="node_modules|__pycache__|\.venv|venv|\.eggs|site-packages"

remove_bootstrap() {
  if [ -f "$DEST/BOOTSTRAP.md" ]; then
    rm -f "$DEST/BOOTSTRAP.md"
    echo "[sync] Removed BOOTSTRAP.md from workspace at $(date +%H:%M:%S)"
  fi
}

sync_files() {
  mkdir -p "$DEST"

  # Sync top-level .md files
  for f in "$SRC"/*.md; do
    [ -f "$f" ] && cp "$f" "$DEST/"
  done

  # Sync skills/ directory (excluding dependency artifacts)
  if [ -d "$SRC/skills" ]; then
    mkdir -p "$DEST/skills"
    # Use find + cp to replicate rsync --exclude behavior
    (cd "$SRC/skills" && find . -type f | grep -Ev "/($EXCLUDED_DIRS)/" | while IFS= read -r file; do
      dir="$(dirname "$file")"
      mkdir -p "$DEST/skills/$dir"
      cp "$file" "$DEST/skills/$file"
    done)
    echo "[sync] Skills synced at $(date +%H:%M:%S)"
  fi

  # Sync resources/ directory (all files)
  if [ -d "$RESOURCES_SRC" ]; then
    mkdir -p "$RESOURCES_DEST"
    cp -r "$RESOURCES_SRC"/. "$RESOURCES_DEST/"
    echo "[sync] Resources synced at $(date +%H:%M:%S)"
  fi

  remove_bootstrap
  echo "[sync] Done at $(date +%H:%M:%S)"
}

# Cross-platform hash: prefer md5sum (Linux), fall back to md5 (macOS)
hash_cmd() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$@" | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q "$@"
  else
    # No hash tool — always return unique value to force sync
    date +%s%N
  fi
}

compute_hash() {
  {
    find "$SRC" -maxdepth 1 -name '*.md' -exec cat {} + 2>/dev/null
    find "$SRC/skills" -type f -not -path "*/node_modules/*" -exec cat {} + 2>/dev/null
    find "$RESOURCES_SRC" -type f -exec cat {} + 2>/dev/null
  } | hash_cmd || echo "empty"
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
