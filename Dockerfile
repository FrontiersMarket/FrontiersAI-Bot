# ── Stage 1: Build native modules & global tools ────────────────────────────
# node:22-bookworm includes build-essential, gcc, make, python3 — needed for
# native compilation (better-sqlite3, node-pty, and openclaw's native deps).
FROM node:22-bookworm AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Pre-cache node headers before native compilation. Without this, node-pty and
# better-sqlite3 download headers concurrently and the parallel TLS connections
# timeout on Docker Desktop's network layer (arm64 has no prebuilds for node-pty).
RUN npm install -g pnpm@10.16.1 node-gyp \
  && node-gyp install \
  && pnpm install --frozen-lockfile --prod

# openclaw needs build tools for native deps — MUST be in this stage, not slim
RUN npm install -g openclaw@2026.3.8

# ── Stage 2: Runtime image ──────────────────────────────────────────────────
# Everything below until COPY --from=builder runs IN PARALLEL with builder.
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="frontiersai-bot" \
      org.opencontainers.image.description="Frontiers Market Bot powered by OpenClaw"

# Runtime system dependencies (no build-essential, no npm operations)
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    gosu \
    procps \
    python3 \
    python3-pip \
    python3.11-venv \
    jq \
    sqlite3 \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-cloud-cli \
  && rm -rf /var/lib/apt/lists/*

# Python dataviz venv — all versions pinned for reproducible, fast builds.
# kaleido 1.x requires Chromium which is NOT installed; 0.2.1 is self-contained.
COPY requirements-dataviz.txt /tmp/requirements-dataviz.txt
RUN python3 -m venv /opt/dataviz-venv \
  && /opt/dataviz-venv/bin/pip install --quiet --no-cache-dir \
       -r /tmp/requirements-dataviz.txt \
  && rm /tmp/requirements-dataviz.txt \
  && chmod -R a+rX /opt/dataviz-venv

# Create non-root user and install Homebrew.
# Placed before COPY so source changes don't invalidate this expensive layer.
RUN useradd -m -s /bin/bash openclaw \
  && mkdir -p /data && chown openclaw:openclaw /data \
  && mkdir -p /home/linuxbrew/.linuxbrew && chown -R openclaw:openclaw /home/linuxbrew

USER openclaw
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
USER root

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/home/linuxbrew/.linuxbrew"
ENV HOMEBREW_CELLAR="/home/linuxbrew/.linuxbrew/Cellar"
ENV HOMEBREW_REPOSITORY="/home/linuxbrew/.linuxbrew/Homebrew"

# ── Copy from builder (waits for builder to complete) ───────────────────────
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /usr/local/lib/node_modules/openclaw /usr/local/lib/node_modules/openclaw
RUN ln -sf ../lib/node_modules/openclaw/openclaw.mjs /usr/local/bin/openclaw

COPY package.json ./
COPY src ./src
COPY entrypoint.sh ./entrypoint.sh
RUN chown -R openclaw:openclaw /app

ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/setup/healthz || exit 1

USER root
ENTRYPOINT ["./entrypoint.sh"]
