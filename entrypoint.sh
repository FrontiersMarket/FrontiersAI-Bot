#!/bin/bash
set -e

chown openclaw:openclaw /data
chmod 755 /data

# Best-effort recursive chown — git objects in .linuxbrew and workspace
# have restrictive permissions that cause chown to fail on container restart.
chown -R openclaw:openclaw /data 2>/dev/null || true
# Ensure the volume is fully accessible from the host (for workspace sync, etc.).
# On Linux, the bind-mounted .tmpdata/ must be writable by the host user whose UID
# may differ from the container's openclaw user.
chmod -R a+rwX /data 2>/dev/null || true

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

# Set GCP credentials if the key file was synced into the volume
if [ -f /data/resources/openclaw-gbq-key.json ]; then
  export GOOGLE_APPLICATION_CREDENTIALS="/data/resources/openclaw-gbq-key.json"
  # Configure gcloud for the openclaw user so bq CLI uses the correct SA and project
  GCLOUD="/home/linuxbrew/.linuxbrew/bin/gcloud"
  if [ -f "$GCLOUD" ]; then
    gosu openclaw "$GCLOUD" auth activate-service-account \
      --key-file=/data/resources/openclaw-gbq-key.json 2>/dev/null || true
    gosu openclaw "$GCLOUD" config set project frontiersmarketplace 2>/dev/null || true
  fi
fi

# Ensure the openclaw CLI finds the correct state dir when run as the openclaw user
# (e.g. via `docker exec ... su - openclaw -c "openclaw ..."`)
OPENCLAW_PROFILE="/home/openclaw/.bashrc"
OPENCLAW_STATE_LINE="export OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR:-/data/.openclaw}"
if ! grep -qF "OPENCLAW_STATE_DIR" "$OPENCLAW_PROFILE" 2>/dev/null; then
  echo "$OPENCLAW_STATE_LINE" >> "$OPENCLAW_PROFILE"
fi

exec gosu openclaw node src/server.js
