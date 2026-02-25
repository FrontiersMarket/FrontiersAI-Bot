#!/bin/bash
set -e

chown openclaw:openclaw /data
chmod 700 /data

# Best-effort recursive chown — git objects in .linuxbrew and workspace
# have restrictive permissions that cause chown to fail on container restart.
chown -R openclaw:openclaw /data 2>/dev/null || true

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

exec gosu openclaw node src/server.js
