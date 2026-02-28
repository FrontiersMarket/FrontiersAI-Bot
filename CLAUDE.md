# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and developers working with this repository.

## Overview

**Frontiers Market Bot** — a Dockerized AI bot for Frontiers Market (cattle & ranch platform), powered by **[OpenClaw](https://docs.openclaw.ai/)**. The Express wrapper server provides:

- A web-based setup wizard at `/setup` (protected by `SETUP_PASSWORD`)
- Reverse proxy from public URL → internal OpenClaw gateway (with auto-injected auth)
- Optional browser-based terminal at `/tui`
- Persistent state via Docker volume at `/data`
- Bot personality and skills defined in `workspace/`

The wrapper manages the full OpenClaw lifecycle: onboarding → gateway startup → traffic proxying → auto-restart on crash.

**Deployment**: GCP Compute Engine via GitHub Actions. Separate **staging** and **production** instances with independent env vars, credentials, and channel tokens.

## Project Structure

```
FrontiersAI-Bot/
├── src/
│   ├── server.js                 # Main Express wrapper (~1100 lines)
│   └── public/
│       ├── setup.html            # Setup wizard UI (Alpine.js + Tailwind)
│       ├── loading.html          # Gateway startup loading page
│       └── tui.html              # Browser terminal (xterm + WebSocket)
├── workspace/                    # Bot personality & behavior (synced to container)
│   ├── IDENTITY.md               # Bot name, role, personality
│   ├── SOUL.md                   # Core behavior and values
│   ├── AGENTS.md                 # Agent definitions
│   ├── TOOLS.md                  # Available tools documentation
│   ├── USER.md                   # User context and preferences
│   ├── HEARTBEAT.md              # Periodic check-in behavior
│   └── skills/
│       └── report-generator/     # PDF report generation skill
│           ├── report_generator.js
│           ├── package.json      # Uses pdf-lib
│           ├── SKILL.md          # Skill documentation
│           └── results/          # Generated PDF output
├── scripts/
│   ├── watch-workspace.mjs       # File watcher: syncs workspace/ → volume
│   ├── restart-openclaw.sh       # Gateway restart via API call
│   └── bash/                     # Shell utilities (bot-shell, clean, sync)
├── resources/                    # Credentials (gitignored)
├── .github/workflows/
│   ├── ci.yml                    # Lint + Docker build dry-run
│   ├── deploy.yml                # Build → push → deploy to GCP (manual dispatch)
│   └── rollback.yml              # Rollback to previous image (manual dispatch)
├── Dockerfile                    # Node 22, OpenClaw, Homebrew, pnpm
├── entrypoint.sh                 # Volume permissions, Homebrew persistence, GCP creds
├── package.json                  # Root deps + npm scripts
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── turbo.json                    # Parallel task runner config
```

## Packages & Dependencies

| Package | Role |
|---------|------|
| **express** ^5.1.0 | Web server for wrapper, setup API, static files |
| **http-proxy** ^1.18.1 | HTTP/WebSocket reverse proxy to OpenClaw gateway |
| **node-pty** ^1.0.0 | PTY for browser-based terminal (TUI) |
| **ws** ^8.18.0 | WebSocket server for TUI communication |
| **turbo** (dev) | Monorepo task runner (parallel logs + watcher) |

Report generator skill uses **pdf-lib** for PDF generation.

No build step — all frontend is vanilla JS with Alpine.js + Tailwind loaded via CDN.

## Development Commands

```bash
# Build Docker image
pnpm docker:build

# Start container (detached)
pnpm up

# Follow logs + watch workspace changes (parallel via turbo)
pnpm watch

# Stop container
pnpm down

# Restart gateway without restarting container
pnpm restart-openclaw

# Shell into container
pnpm shell

# Syntax check
pnpm lint

# Start server locally (no Docker, requires OpenClaw installed)
pnpm start
```

### Local Development Workflow

```bash
cp .env.example .env         # Configure env vars
pnpm docker:build            # Build image
pnpm up                      # Start container
pnpm watch                   # Logs + workspace sync (turbo)
# Edit workspace/ files → auto-synced every 300ms to .tmpdata/workspace/

# Access:
# Setup:   http://localhost:8080/setup  (password from .env)
# Control: http://localhost:8080/openclaw (after setup)
# TUI:     http://localhost:8080/tui (if ENABLE_WEB_TUI=true)
```

## Architecture

### Request Flow

```
User/Channel → Express Wrapper (PORT) →
  ├─ /setup/*       → Setup wizard (Basic auth with SETUP_PASSWORD)
  ├─ /tui & /tui/ws → Browser terminal (if ENABLE_WEB_TUI=true)
  ├─ /healthz       → Gateway status check
  └─ /*             → Reverse proxy to gateway (localhost:18789)
                       (auto-injects Authorization: Bearer <token>)
```

### Lifecycle States

1. **Unconfigured** (no `openclaw.json`): All non-`/setup` routes redirect to `/setup`. User completes wizard → runs `openclaw onboard --non-interactive`.

2. **Configured** (`openclaw.json` exists): Wrapper spawns `openclaw gateway run`, polls health endpoints (`/openclaw`, `/`, `/health`), then proxies all traffic with injected bearer token. Auto-restarts gateway on crash.

### Key Server Functions (src/server.js)

| Function | Purpose |
|----------|---------|
| `resolveGatewayToken()` | Load token from env → disk → or generate new one |
| `isConfigured()` | Check if `openclaw.json` exists |
| `startGateway()` | Spawn gateway child process |
| `ensureGatewayRunning()` | Idempotent startup with readiness check |
| `waitForGatewayReady()` | Poll health endpoints (60s timeout) |
| `restartGateway()` | SIGTERM → wait → respawn |
| `requireSetupAuth()` | Basic auth middleware (SHA256 timing-safe compare) |
| `buildOnboardArgs()` | Construct CLI args for `openclaw onboard` |
| `validatePayload()` | Validate setup form data |
| `runCmd()` | Spawn child process, capture stdout/stderr |

### Two-Layer Auth Scheme

1. **Setup wizard**: Basic auth with `SETUP_PASSWORD` + rate limiting (50 req/IP/60s)
2. **Gateway**: Bearer token auto-injected into all proxied requests
   - Token resolved at startup: env var → disk file → newly generated
   - Persisted to `${STATE_DIR}/gateway.token` (mode 0o600)
   - Must use `proxy.on("proxyReq")` and `proxy.on("proxyReqWs")` event handlers (direct `req.headers` modification breaks WebSocket upgrades)

### Onboarding Process (`/setup/api/run`)

1. Validate payload (flow, authChoice, tokens, channels)
2. Run `openclaw onboard --non-interactive --flow <flow> --auth-choice <auth> [secret]`
3. Configure gateway: `allowInsecureAuth=true`, token auth, `trustedProxies=["127.0.0.1"]`
4. Optionally set model via `openclaw models set <model>`
5. Write channel configs via `openclaw config set --json channels.<name>` (not `channels add` — it's flaky)
6. Spawn gateway and wait for readiness

### Workspace Sync Flow

```
workspace/ (repo) → watch-workspace.mjs → .tmpdata/workspace/ → /data/workspace (container)
```

Syncs `*.md` files, `skills/`, and `resources/` with 300ms debounce. This is how bot personality and skill changes reach the running container during development.

### TUI (Web Terminal)

Optional browser terminal at `/tui` (requires `ENABLE_WEB_TUI=true`). Uses `node-pty` to spawn `openclaw tui` in a PTY, connected via WebSocket. Single session only (409 on concurrent access). Idle timeout: 5 min, max session: 30 min.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SETUP_PASSWORD` | **Yes** | — | Protects `/setup` wizard |
| `OPENCLAW_STATE_DIR` | Recommended | `~/.openclaw` | Config + credentials dir |
| `OPENCLAW_WORKSPACE_DIR` | Recommended | `<state>/workspace` | Agent workspace dir |
| `OPENCLAW_GATEWAY_TOKEN` | No | auto-generated | Bearer token for gateway |
| `PORT` | No | 8080 | Wrapper HTTP port |
| `INTERNAL_GATEWAY_PORT` | No | 18789 | Gateway internal port |
| `OPENCLAW_ENTRY` | No | `/openclaw/dist/entry.js` | OpenClaw CLI entry point |
| `ENABLE_WEB_TUI` | No | `false` | Enable browser terminal |
| `TUI_IDLE_TIMEOUT_MS` | No | 300000 | TUI idle timeout (5 min) |
| `TUI_MAX_SESSION_MS` | No | 1800000 | TUI max session (30 min) |

## CI/CD (GitHub Actions)

### deploy.yml (Manual Dispatch)
1. Build Docker image, tag with commit SHA + `latest`
2. Push to GCP Artifact Registry
3. SSH into GCP instance, pull image, stop old container, start new one
4. Health check: poll `http://localhost:8080/` (30 attempts, 5s interval)
5. Cleanup old images (keeps latest 10)

**Requires**: Workload Identity Federation (keyless auth), per-environment secrets (`GCE_INSTANCE_NAME`, `GCE_INSTANCE_ZONE`, `ENV_VARS`), and repo variables (`GCP_PROJECT_ID`, `GCP_REGION`, etc.)

### rollback.yml (Manual Dispatch)
Roll back to a previous commit SHA's image without rebuilding.

### ci.yml
Lint + Docker build dry-run. Auto-trigger currently disabled.

## Docker & Entrypoint

**Dockerfile**: Node 22 base → system packages → OpenClaw (npm global) → Homebrew → pnpm install (production) → copy source. Creates non-root `openclaw` user. Health check on `/setup/healthz`.

**entrypoint.sh**:
1. Fix `/data` volume ownership
2. Persist Homebrew to volume (`/data/.linuxbrew` ← symlink)
3. Set `GOOGLE_APPLICATION_CREDENTIALS` if key file exists in `/data/resources/`
4. Start server as `openclaw` user via `gosu`

## Common Development Tasks

### Modifying the setup wizard
1. Add fields to [setup.html](src/public/setup.html) (Alpine.js data model)
2. Add config-writing logic in `/setup/api/run` handler in [server.js](src/server.js)

### Adding new channel types
1. Add channel fields to setup.html
2. Add `config set --json channels.<name>` call in the run handler
3. Update validation in `validatePayload()`

### Modifying onboarding
Edit `buildOnboardArgs()` in server.js to add CLI flags or auth providers.

### Debugging gateway startup
Check logs for: `[gateway] starting with command: ...`, `[gateway] ready at <endpoint>`, or `[gateway] failed to become ready after N seconds`. If it won't start: verify `openclaw.json` is valid, dirs are writable, bearer token is set in config.

### Adding a new skill
1. Create `workspace/skills/<skill-name>/` with implementation + `SKILL.md`
2. Reference it in `workspace/TOOLS.md` or `workspace/AGENTS.md`
3. Skill files auto-sync to container via workspace watcher

## Production Operations (GCP)

### Accessing the Control UI / TUI remotely

The gateway runs inside the Docker container and is only accessible via the wrapper (port 8080). Use an SSH tunnel to access it securely:

```bash
# On your local machine — keep this terminal open
ssh -N -L 19000:127.0.0.1:8080 frontiersai-bot-production
```

Then open:
- **TUI**: `http://localhost:19000/tui`
- **Control UI**: `http://localhost:19000/openclaw`

### Device pairing (required on first access and after container rebuilds)

OpenClaw requires explicit device approval before any client can connect to the gateway. This must be done after initial setup and any time a new browser/device connects.

```bash
# List pending pairing requests
docker exec -it frontiersai-bot su - openclaw -c "openclaw devices list"

# Approve each pending request by ID
docker exec -it frontiersai-bot su - openclaw -c "openclaw devices approve <request-id>"
```

Then refresh the browser. Repeat for each pending request shown.

> Note: `allowInsecureAuth=true` does **not** bypass device pairing — it only removes the pairing UI redirect. Devices must still be approved via CLI.

### Manual redeploy (without GitHub Actions)

```bash
# On local machine — build for amd64 (required on Apple Silicon)
docker build --platform linux/amd64 -t frontiersai-bot:latest .
docker save frontiersai-bot:latest | gzip > /tmp/bot-image.tar.gz
gcloud compute scp /tmp/bot-image.tar.gz frontiersai-bot-production:~ --zone=us-central1-a --project=frontiersmarketplace

# On VM
docker load < bot-image.tar.gz
docker restart frontiersai-bot
```

### VM info

| Resource | Value |
|----------|-------|
| Project | `frontiersmarketplace` |
| Instance | `frontiersai-bot-production` |
| Zone | `us-central1-a` |
| Static IP | `34.136.213.183` |
| Data disk | `/mnt/disks/data` (persisted via systemd mount unit) |

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → persisted to volume if not in env
2. **Channels use `config set --json`, not `channels add`** → avoids CLI version incompatibilities
3. **Gateway readiness polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some OpenClaw builds only expose certain routes
4. **Discord bots require MESSAGE CONTENT INTENT** → documented in setup wizard
5. **WebSocket auth requires proxy event handlers** → direct `req.headers` modification fails for WS upgrades; must use `proxyReqWs` event
6. **Control UI needs `allowInsecureAuth=true`** → removes pairing UI redirect, but devices still require explicit CLI approval via `openclaw devices approve <id>`
7. **Homebrew persisted to volume** → `entrypoint.sh` symlinks `/data/.linuxbrew` back on restart
8. **Staging/Production are fully isolated** → never share env files, tokens, or volumes between environments
9. **Setup rate limiting** → 50 req/IP/60s on `/setup` routes to prevent brute-force
10. **Single TUI session** → concurrent access returns 409 Conflict
