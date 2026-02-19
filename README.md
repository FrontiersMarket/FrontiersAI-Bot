# Frontiers Market Bot

AI-powered bot for Frontiers Market, built on **OpenClaw**. Dockerized and deployed to **GCP Compute Engine** with separate staging and production instances.

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- A **Setup Wizard** at `/setup` (password-protected)
- Optional **Web Terminal** at `/tui` for browser-based CLI access
- Persistent state via Docker volume (config/credentials survive restarts)

## How it works

1. The container runs an Express wrapper server
2. `/setup` is protected by `SETUP_PASSWORD` (Basic auth)
3. During setup, the wrapper runs `openclaw onboard --non-interactive`, writes state to the volume, and starts the gateway
4. After setup, all traffic is reverse-proxied (including WebSockets) to the internal OpenClaw gateway

## Requirements

- **Docker** (Docker Desktop or Docker Engine)
- **Node.js 24+** (only needed for local development without Docker)
- **pnpm** (only needed for local development without Docker)

## Local setup

### 1. Clone and configure

```bash
git clone <repo-url>
cd FrontiersAI-Bot
cp .env.example .env
# Edit .env as needed (defaults work for local testing)
```

### 2. Build the Docker image

```bash
pnpm docker:build
```

### 3. Start the container

```bash
pnpm up
```

### 4. Run dev mode (logs + workspace watcher via Turborepo)

```bash
pnpm watch
```

This runs two persistent tasks in parallel using Turborepo:
- **dev:logs** — follows Docker container logs
- **dev:watch** — watches `workspace/` for `.md` changes and auto-syncs to the container volume

### 5. Access the app

- **Setup wizard**: http://localhost:8080/setup (password: `test`, username: anything)
- **Web terminal**: http://localhost:8080/tui (after setup, if `ENABLE_WEB_TUI=true`)
- **Control UI**: http://localhost:8080/openclaw (after setup)

### 6. Other dev commands

```bash
pnpm shell       # bash shell into the container
pnpm tui         # openclaw TUI inside the container
pnpm down        # stop the container
```

### All scripts

| Command | Description |
|---------|-------------|
| `pnpm docker:build` | Build the Docker image |
| `pnpm up` | Start container (detached) |
| `pnpm watch` | Turbo: follow logs + watch workspace |
| `pnpm shell` | Bash shell into container |
| `pnpm tui` | OpenClaw TUI in container |
| `pnpm down` | Stop container |
| `pnpm lint` | Syntax check |

### Development without Docker

```bash
pnpm install
pnpm start      # requires OpenClaw installed globally or OPENCLAW_ENTRY set
pnpm lint       # syntax check
```

## Workspace files

The bot's personality and behavior are defined by `.md` files in the [`workspace/`](workspace/) directory. These are the source-of-truth files checked into the repo:

| File | Purpose |
|------|---------|
| `IDENTITY.md` | Bot name, personality, and self-description |
| `SOUL.md` | Core behavior, tone, and communication style |
| `AGENTS.md` | Agent definitions and capabilities |
| `BOOTSTRAP.md` | Initial startup instructions |
| `TOOLS.md` | Available tools and how to use them |
| `USER.md` | User context and preferences |
| `HEARTBEAT.md` | Periodic check-in behavior |

### Editing workspace files

1. Edit files in `workspace/` in your editor
2. Sync to the running container:

```bash
# Automatic (included in pnpm watch)
pnpm watch

# Manual one-shot
./scripts/bash/sync-workspace.sh

# Manual watch mode (shell-based, polls every 2s)
./scripts/bash/sync-workspace.sh --watch
```

The sync copies `workspace/*.md` → `.tmpdata/workspace/` (the Docker volume mount). The bot picks up changes on its next interaction — no container restart needed.

### How it works

- `workspace/` in the repo is the editable source
- `.tmpdata/workspace/` is the Docker volume mounted at `/data/workspace` inside the container
- `pnpm watch` uses Turborepo to run the Node.js file watcher (~300ms debounce) and container logs in parallel
- `scripts/bash/sync-workspace.sh` uses `rsync` for manual/one-shot syncs
- On GCP, these files are baked into the volume during initial setup or updated via the sync script

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SETUP_PASSWORD` | Yes | — | Password to access `/setup` |
| `OPENCLAW_STATE_DIR` | Recommended | `~/.openclaw` | Config + credentials directory |
| `OPENCLAW_WORKSPACE_DIR` | Recommended | `<state>/workspace` | Agent workspace directory |
| `OPENCLAW_GATEWAY_TOKEN` | No | auto-generated | Auth token for gateway |
| `PORT` | No | `8080` | Wrapper HTTP port |
| `INTERNAL_GATEWAY_PORT` | No | `18789` | Gateway internal port |
| `OPENCLAW_ENTRY` | No | `/usr/local/lib/node_modules/openclaw/dist/entry.js` | Path to OpenClaw entry |
| `ENABLE_WEB_TUI` | No | `false` | Enable browser terminal at `/tui` |
| `TUI_IDLE_TIMEOUT_MS` | No | `300000` (5 min) | TUI idle disconnect timeout |
| `TUI_MAX_SESSION_MS` | No | `1800000` (30 min) | TUI max session duration |

See [.env.example](.env.example) for full documentation.

## Getting chat tokens

### Telegram

1. Open Telegram and message **@BotFather**
2. Run `/newbot` and follow the prompts
3. Copy the token (looks like `123456789:AA...`) and paste it into `/setup`

### Discord

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. **New Application** → pick a name
3. Open the **Bot** tab → **Add Bot**
4. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
5. Copy the **Bot Token** and paste it into `/setup`
6. Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`)

## Deployment (GCP)

Each environment (staging, production) runs as a separate Docker container on its own GCP Compute Engine instance.

1. Build and push the Docker image to a container registry
2. SSH into the GCP instance
3. Pull the image and run with appropriate env vars and a persistent volume at `/data`
4. Visit `http://<instance-ip>:8080/setup` to complete onboarding (first deploy only)

The `/data` volume **must persist** across container restarts to retain config, credentials, and gateway token.

## FAQ

**How do I access the setup page?**
Go to `/setup` on your instance. Enter the `SETUP_PASSWORD` as the password. The username field is ignored.

**I see "gateway disconnected" or auth errors in the Control UI.**
Go to `/setup` and click "Open OpenClaw UI" — the setup page passes the required auth token.

**How do I approve pairing for Telegram or Discord?**
Go to `/setup` and use the "Approve Pairing" dialog.

**How do I change the AI model after setup?**
Shell into the container and run:
```bash
openclaw models set provider/model-id
```
Example: `openclaw models set anthropic/claude-sonnet-4-20250514`. Use `openclaw models list --all` to see available models.

**Config seems broken?**
Go to `/setup` and click "Run Doctor" to run `openclaw doctor --repair`.
