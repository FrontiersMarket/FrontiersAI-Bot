#!/bin/bash
set -e

# ── Cloud Run detection ────────────────────────────────────────────────────────
# GCS FUSE mounts ignore POSIX permissions, so skip chown/chmod on Cloud Run.
# The CLOUD_RUN env var is set in the Cloud Run service definition.
# ───────────────────────────────────────────────────────────────────────────────

if [ "${CLOUD_RUN}" = "true" ]; then
  echo "[entrypoint] Cloud Run mode — skipping volume permission changes"
else
  chown openclaw:openclaw /data
  chmod 700 /data

  # Best-effort recursive chown — git objects in .linuxbrew and workspace
  # have restrictive permissions that cause chown to fail on container restart.
  chown -R openclaw:openclaw /data 2>/dev/null || true
fi

# ── Homebrew persistence ───────────────────────────────────────────────────────
if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

# ── First-boot workspace init ──────────────────────────────────────────────────
# On first boot (no workspace on volume), seed from baked-in defaults.
# This ensures Cloud Run instances start with the correct personality files
# without requiring manual setup, while preserving any runtime customizations
# on subsequent restarts.
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
if [ ! -f "${WORKSPACE_DIR}/IDENTITY.md" ]; then
  echo "[entrypoint] First boot — seeding workspace from defaults"
  mkdir -p "${WORKSPACE_DIR}"
  cp -rn /app/workspace-defaults/* "${WORKSPACE_DIR}/" 2>/dev/null || true
fi

# ── GCP credentials ───────────────────────────────────────────────────────────
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

# ── Start server ──────────────────────────────────────────────────────────────
if [ "${CLOUD_RUN}" = "true" ]; then
  # Cloud Run runs as the container's USER (root here, but gosu not needed
  # since GCS FUSE doesn't enforce POSIX permissions)
  exec gosu openclaw node src/server.js
else
  exec gosu openclaw node src/server.js
fi
