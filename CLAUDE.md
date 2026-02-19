# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the **Frontiers Market Bot**, powered by **OpenClaw** (an AI coding assistant platform). It provides:

- A web-based setup wizard at `/setup` (protected by `SETUP_PASSWORD`)
- Automatic reverse proxy from public URL → internal OpenClaw gateway
- Persistent state via Docker volume at `/data`

The wrapper manages the OpenClaw lifecycle: onboarding → gateway startup → traffic proxying.

**Deployment**: Dockerized and deployed to **GCP Compute Engine** instances. Separate instances for **staging** and **production**, each with their own environment variables, credentials, and channel tokens.

## Development Commands

```bash
# Local development (requires OpenClaw installed globally or OPENCLAW_ENTRY set)
npm run dev

# Production start
npm start

# Syntax check
npm run lint
```

## Docker Build & Local Testing

```bash
# Build the container
docker build -t frontiers-bot .

# Run locally with volume
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  frontiers-bot

# Access setup wizard
open http://localhost:8080/setup  # password: test
```

## Architecture

### Request Flow

1. **User → GCP Instance → Wrapper (Express on PORT)** → routes to:
   - `/setup/*` → setup wizard (auth: Basic with `SETUP_PASSWORD`)
   - All other routes → proxied to internal gateway

2. **Wrapper → Gateway** (localhost:18789 by default)
   - HTTP/WebSocket reverse proxy via `http-proxy`
   - Automatically injects `Authorization: Bearer <token>` header

### Lifecycle States

1. **Unconfigured**: No `openclaw.json` exists
   - All non-`/setup` routes redirect to `/setup`
   - User completes setup wizard → runs `openclaw onboard --non-interactive`

2. **Configured**: `openclaw.json` exists
   - Wrapper spawns `openclaw gateway run` as child process
   - Waits for gateway to respond on multiple health endpoints
   - Proxies all traffic with injected bearer token

### Key Files

- **src/server.js** (main entry): Express wrapper, proxy setup, gateway lifecycle management, configuration persistence (server logic only - no inline HTML/CSS)
- **src/public/** (static assets for setup wizard):
  - **setup.html**: Setup wizard HTML structure
  - **setup-app.js**: Client-side JS for `/setup` wizard (vanilla JS, no build step)
  - **loading.html**: Loading/retry page shown when gateway is starting
  - **tui.html**: Optional web-based terminal UI
- **Dockerfile**: Single-stage build (installs OpenClaw via npm, installs Homebrew, installs wrapper deps)
- **entrypoint.sh**: Container entrypoint — persists Homebrew to volume, sets permissions, launches server

### Environment Variables

**Required:**
- `SETUP_PASSWORD` — protects `/setup` wizard

**Recommended:**
- `OPENCLAW_STATE_DIR=/data/.openclaw` — config + credentials
- `OPENCLAW_WORKSPACE_DIR=/data/workspace` — agent workspace

**Optional:**
- `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway (auto-generated if unset)
- `PORT` — wrapper HTTP port (default 8080)
- `INTERNAL_GATEWAY_PORT` — gateway internal port (default 18789)
- `OPENCLAW_ENTRY` — path to `entry.js` (default `/usr/local/lib/node_modules/openclaw/dist/entry.js`)
- `ENABLE_WEB_TUI` — enable browser-based terminal at `/tui` (default `false`)
- `TUI_IDLE_TIMEOUT_MS` — TUI idle disconnect timeout (default 300000 / 5 min)
- `TUI_MAX_SESSION_MS` — TUI max session duration (default 1800000 / 30 min)

### Authentication Flow

The wrapper manages a **two-layer auth scheme**:

1. **Setup wizard auth**: Basic auth with `SETUP_PASSWORD` (src/server.js)
2. **Gateway auth**: Bearer token (auto-generated or from `OPENCLAW_GATEWAY_TOKEN` env)
   - Token is auto-injected into proxied requests via `proxyReq` and `proxyReqWs` event handlers
   - Persisted to `${STATE_DIR}/gateway.token` if not provided via env

### Onboarding Process

When the user runs setup via `/setup/api/run`:

1. Calls `openclaw onboard --non-interactive` with user-selected auth provider
2. Writes channel configs (Telegram/Discord/Slack) directly to `openclaw.json` via `openclaw config set --json`
3. Force-sets gateway config to use token auth + loopback bind + allowInsecureAuth
4. Spawns gateway process
5. Waits for gateway readiness (polls multiple endpoints)

**Important**: Channel setup bypasses `openclaw channels add` and writes config directly because `channels add` is flaky across different OpenClaw builds.

### Gateway Token Injection

The wrapper **always** injects the bearer token into proxied requests so browser clients don't need to know it:

- HTTP requests: via `proxy.on("proxyReq")` event handler
- WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler

**Important**: Token injection uses `http-proxy` event handlers (`proxyReq` and `proxyReqWs`) rather than direct `req.headers` modification. Direct header modification does not reliably work with WebSocket upgrades, causing intermittent `token_missing` or `token_mismatch` errors.

This allows the Control UI at `/openclaw` to work without user authentication.

## Deployment

### Environments

| Environment | Description |
|-------------|-------------|
| **Staging** | Testing instance on GCP — uses test channel tokens, test API keys |
| **Production** | Live instance on GCP — uses production channel tokens, production API keys |

Each environment runs as a separate Docker container on its own GCP Compute Engine instance, with:
- Its own set of environment variables (API keys, channel tokens, `SETUP_PASSWORD`)
- Its own persistent volume at `/data` for OpenClaw state
- Its own domain/IP

### GCP Deployment

1. Build and push the Docker image
2. SSH into the GCP instance
3. Pull the image and run with appropriate env vars and volume mount at `/data`
4. Visit `/setup` to complete onboarding (first deploy only)

**Important**: The `/data` volume must persist across container restarts to retain OpenClaw config, credentials, and gateway token.

## Common Development Tasks

### Testing the setup wizard

1. Delete `${STATE_DIR}/openclaw.json` (or run Reset in the UI)
2. Visit `/setup` and complete onboarding
3. Check logs for gateway startup and channel config writes

### Testing authentication

- Setup wizard: Clear browser auth, verify Basic auth challenge
- Gateway: Remove `Authorization` header injection and verify requests fail

### Debugging gateway startup

Check logs for:
- `[gateway] starting with command: ...`
- `[gateway] ready at <endpoint>`
- `[gateway] failed to become ready after N seconds`

If gateway doesn't start:
- Verify `openclaw.json` exists and is valid JSON
- Check `STATE_DIR` and `WORKSPACE_DIR` are writable
- Ensure bearer token is set in config

### Modifying onboarding args

Edit `buildOnboardArgs()` in src/server.js to add new CLI flags or auth providers.

### Adding new channel types

1. Add channel-specific fields to `/setup` HTML (src/public/setup.html)
2. Add config-writing logic in `/setup/api/run` handler (src/server.js)
3. Update client JS to collect the fields (src/public/setup-app.js)

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → persisted to volume if not in env
2. **Channels are written via `config set --json`, not `channels add`** → avoids CLI version incompatibilities
3. **Gateway readiness check polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some builds only expose certain routes
4. **Discord bots require MESSAGE CONTENT INTENT** → document this in setup wizard
5. **Gateway spawn inherits stdio** → logs appear in wrapper output
6. **WebSocket auth requires proxy event handlers** → Direct `req.headers` modification doesn't work for WebSocket upgrades with http-proxy; must use `proxyReqWs` event to reliably inject Authorization header
7. **Control UI requires allowInsecureAuth to bypass pairing** → Set `gateway.controlUi.allowInsecureAuth=true` during onboarding to prevent "disconnected (1008): pairing required" errors. Wrapper already handles bearer token auth, so device pairing is unnecessary.
8. **Homebrew is persisted to volume** → `entrypoint.sh` copies Homebrew to `/data/.linuxbrew` on first run, then symlinks it back. This survives container rebuilds.
9. **Staging vs Production isolation** → Never share env files or tokens between environments. Each GCP instance should have completely independent configuration.
