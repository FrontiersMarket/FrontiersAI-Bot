#!/bin/bash
# Restarts the OpenClaw gateway inside the running Docker container
# by hitting the wrapper's restart endpoint.

set -euo pipefail

CONTAINER="${CONTAINER_NAME:-frontiersai-bot}"
PORT="${HOST_PORT:-8080}"
PASSWORD="${SETUP_PASSWORD:-test}"

# Check the container is running
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "Error: container '$CONTAINER' is not running." >&2
  echo "Start it with: pnpm run up" >&2
  exit 1
fi

echo "Restarting OpenClaw gateway (container: $CONTAINER)..."

HTTP_CODE=$(curl -s -o /tmp/restart-openclaw-resp.json -w '%{http_code}' \
  -X POST \
  -u ":${PASSWORD}" \
  "http://localhost:${PORT}/setup/api/gateway/restart")

BODY=$(cat /tmp/restart-openclaw-resp.json 2>/dev/null || echo "")
rm -f /tmp/restart-openclaw-resp.json

if [ "$HTTP_CODE" = "200" ]; then
  echo "Gateway restarted successfully."
else
  echo "Failed (HTTP $HTTP_CODE): $BODY" >&2
  exit 1
fi
