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

exec gosu openclaw node src/server.js
