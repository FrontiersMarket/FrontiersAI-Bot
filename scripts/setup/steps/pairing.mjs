import { confirm, note, log, spinner } from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { listPendingDevices, approveDevice, execOpenclaw } from "../lib/docker.mjs";
import { guardCancel, sleep, execFileAsync, pollHealth } from "../lib/utils.mjs";
import { CONTAINER_NAME, ROOT, RESOURCES_SRC, GCP_KEY_FILE } from "../lib/constants.mjs";
import { reInjectScope } from "./scope.mjs";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 10; // 30s total

async function waitForPendingDevices() {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    try {
      const ids = await listPendingDevices();
      if (ids.length > 0) return ids;
    } catch {}
    await sleep(POLL_INTERVAL_MS);
  }
  return [];
}

/**
 * Patch gateway.controlUi.allowedOrigins in openclaw.json to include the local origin.
 * The file lives on the shared volume so the container sees it directly.
 * Returns true if the file was modified, false if already correct or missing.
 */
function patchOpenclaw(port, enableChatCompletions = false) {
  const jsonPath = resolve(ROOT, ".tmpdata", ".openclaw", "openclaw.json");
  if (!existsSync(jsonPath)) return false;

  const config = JSON.parse(readFileSync(jsonPath, "utf8"));
  let changed = false;

  // Patch gateway.controlUi.allowedOrigins
  config.gateway ??= {};
  config.gateway.controlUi ??= {};
  const origins = config.gateway.controlUi.allowedOrigins ?? [];
  const required = [`http://localhost:${port}`, "http://127.0.0.1:18789"];
  const missing = required.filter((o) => !origins.includes(o));
  if (missing.length > 0) {
    config.gateway.controlUi.allowedOrigins = [...origins, ...missing];
    changed = true;
  }

  // Patch gateway.http.endpoints.chatCompletions.enabled
  if (enableChatCompletions) {
    config.gateway.http ??= {};
    config.gateway.http.endpoints ??= {};
    config.gateway.http.endpoints.chatCompletions ??= {};
    if (config.gateway.http.endpoints.chatCompletions.enabled !== true) {
      config.gateway.http.endpoints.chatCompletions.enabled = true;
      changed = true;
    }
  }

  // Patch tools.allow + remove tools.profile
  config.tools ??= {};
  if (!Array.isArray(config.tools.allow) || !config.tools.allow.includes("exec")) {
    config.tools.allow = ["exec"];
    changed = true;
  }
  if ("profile" in config.tools) {
    delete config.tools.profile;
    changed = true;
  }

  // Patch agents.defaults
  config.agents ??= {};
  config.agents.defaults ??= {};
  const agentDefaults = {
    verboseDefault: "off",
    blockStreamingDefault: "off",
    typingIntervalSeconds: 5,
    typingMode: "instant",
  };
  for (const [key, val] of Object.entries(agentDefaults)) {
    if (config.agents.defaults[key] !== val) {
      config.agents.defaults[key] = val;
      changed = true;
    }
  }

  if (!changed) return false;
  writeFileSync(jsonPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return true;
}

/**
 * Shared post-setup work: patch config, sync workspace, GCP auth,
 * clear sessions, restart container, wait for gateway.
 *
 * Used by both the browser (development) and CLI (non-interactive) flows.
 */
export async function postSetupWork(vars) {
  const port = vars.PORT ?? "8080";
  const controlUrl = `http://localhost:${port}/openclaw`;

  // ── Fix .tmpdata/ permissions for host-side writes ────────────────────────
  // The container entrypoint runs `chown -R openclaw:openclaw /data`, which
  // changes the bind-mounted .tmpdata/ to the container's openclaw UID.
  // On Linux VMs, this UID may differ from the host user, blocking host writes.
  // Must run BEFORE any host-side reads/writes to .tmpdata/.
  {
    try {
      await execFileAsync(
        "docker",
        ["exec", CONTAINER_NAME, "chmod", "-R", "a+rwX", "/data"],
        { timeout: 15_000 }
      );
      // Restore SSH key permissions — SSH refuses keys more open than 0600
      await execFileAsync(
        "docker",
        ["exec", CONTAINER_NAME, "chmod", "600", "/data/.ssh/id_ed25519"],
        { timeout: 5_000 }
      ).catch(() => {});
    } catch {
      // Non-fatal — may already be fine (e.g. macOS where Docker Desktop handles UID mapping)
    }
  }

  // ── Patch allowedOrigins + tools.allow ────────────────────────────────────
  {
    const s = spinner();
    s.start("Patching openclaw.json (allowedOrigins + tools.allow)…");
    let patched = false;
    try {
      const enableChatCompletions = vars.ENABLE_CHAT_COMPLETIONS === "true";
      patched = patchOpenclaw(port, enableChatCompletions);
      const patches = ["allowedOrigins", "tools.allow", "agents.defaults"];
      if (enableChatCompletions) {
        patches.push("chatCompletions.enabled");
      }
      s.stop(
        patched
          ? `Patched openclaw.json (${patches.join(", ")}) ✓`
          : "openclaw.json already up to date — no change needed ✓"
      );
    } catch (err) {
      s.stop("Could not patch openclaw.json");
      log.warn(`  ${err.message}`);
    }
  }

  // ── Configure chat completions via CLI (fallback/ensure) ────────────────
  {
    const enableChatCompletions = vars.ENABLE_CHAT_COMPLETIONS === "true";
    if (enableChatCompletions) {
      const s = spinner();
      s.start("Configuring chat completions endpoint via CLI…");
      try {
        await execOpenclaw([
          "config",
          "set",
          "gateway.http.endpoints.chatCompletions.enabled",
          "true",
        ], 15_000);
        s.stop("Chat completions enabled ✓");
      } catch (err) {
        s.stop("Could not configure chat completions via CLI");
        log.warn(`  ${err.message}`);
        log.warn("  You may need to set it manually: docker exec " + CONTAINER_NAME + " openclaw config set gateway.http.endpoints.chatCompletions.enabled true");
      }
    }
  }

  // ── Sync workspace → .tmpdata (container volume) ──────────────────────────
  {
    const s = spinner();
    s.start("Syncing workspace files to container volume…");
    try {
      const { stdout } = await execFileAsync(
        "bash",
        [resolve(ROOT, "scripts/bash/sync-workspace.sh")],
        { timeout: 30_000, cwd: ROOT }
      );
      const lineCount = stdout.trim().split("\n").filter(Boolean).length;
      s.stop(`Workspace synced  (${lineCount} operations) ✓`);
    } catch (err) {
      s.stop("Workspace sync failed");
      log.warn(`  ${err.message}`);
    }
  }

  // ── Re-inject scope into dest AGENTS.md after sync ────────────────────────
  try {
    reInjectScope();
  } catch {}

  // ── Remove BOOTSTRAP.md from container's live filesystem ──────────────────
  {
    const s = spinner();
    s.start("Removing BOOTSTRAP.md from container workspace…");
    try {
      await execFileAsync(
        "docker",
        ["exec", CONTAINER_NAME, "rm", "-f", "/data/workspace/BOOTSTRAP.md"],
        { timeout: 5000 }
      );
      s.stop("BOOTSTRAP.md removed ✓");
    } catch {
      s.stop("BOOTSTRAP.md not found or already removed");
    }
  }

  // ── Authenticate GCP service account inside container ─────────────────────
  {
    const s = spinner();
    s.start("Authenticating GCP service account in container…");

    const keyPathInContainer = `/data/resources/${GCP_KEY_FILE}`;

    let projectId = "frontiersmarketplace";
    try {
      const keyData = JSON.parse(
        readFileSync(resolve(RESOURCES_SRC, GCP_KEY_FILE), "utf8")
      );
      projectId = keyData.project_id ?? projectId;
    } catch {}

    try {
      await execFileAsync(
        "docker",
        [
          "exec", CONTAINER_NAME,
          "su", "-", "openclaw", "-c",
          `gcloud auth activate-service-account --key-file=${keyPathInContainer}`,
        ],
        { timeout: 30_000 }
      );
      await execFileAsync(
        "docker",
        [
          "exec", CONTAINER_NAME,
          "su", "-", "openclaw", "-c",
          `gcloud config set project ${projectId}`,
        ],
        { timeout: 10_000 }
      );
      s.stop(`GCP service account authenticated  (project: ${projectId}) ✓`);
    } catch (err) {
      s.stop("GCP auth failed — bot may lack BigQuery access");
      log.warn(`  ${err.message}`);
    }
  }

  // ── Clear agent sessions + reset via CLI ──────────────────────────────────
  {
    const s = spinner();
    s.start("Clearing agent sessions…");
    const sessionsDir = resolve(ROOT, ".tmpdata", ".openclaw", "agents", "main", "sessions");
    try {
      if (existsSync(sessionsDir)) {
        rmSync(sessionsDir, { recursive: true, force: true });
      }
      s.stop("Agent sessions cleared ✓");
    } catch (err) {
      s.stop("Could not clear agent sessions");
      log.warn(`  ${err.message}`);
    }
  }

  {
    const s = spinner();
    s.start("Resetting OpenClaw session…");
    try {
      await execOpenclaw(["session", "reset"], 15_000);
      s.stop("OpenClaw session reset ✓");
    } catch {
      s.stop("Session reset skipped (command not available or no active session)");
    }
  }

  {
    const s = spinner();
    s.start("Restarting container to apply config changes…");
    try {
      await execFileAsync("docker", ["restart", CONTAINER_NAME], { timeout: 30_000 });
      s.stop("Container restarted ✓");
    } catch (err) {
      s.stop("Container restart failed");
      log.warn(`  ${err.message}`);
      log.warn(`  Run manually: docker restart ${CONTAINER_NAME}`);
    }
  }

  // ── Wait for gateway ──────────────────────────────────────────────────────
  {
    const healthUrl = `http://localhost:${port}/setup/healthz`;
    const s = spinner();
    s.start("Waiting for gateway to come back up…");
    const healthy = await pollHealth(healthUrl, 60_000);
    if (healthy) {
      s.stop("Gateway is ready ✓");
    } else {
      s.stop("Gateway health check timed out — it may still be starting up");
      log.warn(`  Monitor with: docker logs -f ${CONTAINER_NAME}`);
    }
  }

  // ── Done tip ──────────────────────────────────────────────────────────────
  note(
    [
      "  A fresh session is ready. Open the Control UI to start:",
      "",
      `    ${controlUrl}`,
      "",
      "  To keep the bot in sync and tail logs while you work:",
      "",
      "    pnpm watch",
      "",
      "  This will:",
      "    • Stream container logs in real time",
      "    • Auto-sync workspace/ changes → container on every save",
    ].join("\n"),
    "All done — fresh session ready"
  );
}

/**
 * Development flow — directs user to browser wizard, then auto-approves devices.
 */
export async function runPairingFlow(vars) {
  const port = vars.PORT ?? "8080";
  const setupUrl = `http://localhost:${port}/setup`;
  const controlUrl = `http://localhost:${port}/openclaw`;

  // ── Step 1: complete the setup wizard ─────────────────────────────────────
  note(
    [
      "  Open the setup wizard and complete the onboarding flow.",
      "",
      `  URL:       ${setupUrl}`,
      `  Password:  ${vars.SETUP_PASSWORD}`,
      "",
      "  Suggested settings:",
      "    Model:    google/gemini-2.5-flash",
      "    Channels: skip for now (you can add them later)",
      "",
      "  When the wizard finishes it will show a success screen with a",
      '  "Open OpenClaw UI" button at the top right — stop there.',
    ].join("\n"),
    "Step 1 — Complete setup wizard"
  );

  guardCancel(
    await confirm({
      message: "Setup wizard finished? (/setup process complete)",
      initialValue: false,
    })
  );

  // ── Shared post-setup work (patch, sync, auth, sessions, restart) ─────────
  await postSetupWork(vars);

  // ── Step 2: open the Control UI → triggers pairing request ────────────────
  note(
    [
      `  Open the Control UI now:  ${controlUrl}`,
      "",
      '  You will likely see a "pairing required" screen — that is expected.',
      "  Come back here and confirm; we will approve the pairing next.",
    ].join("\n"),
    "Device pairing — Open Control UI"
  );

  guardCancel(
    await confirm({
      message: 'Have you opened the Control UI (even if it shows "pairing required")?',
      initialValue: false,
    })
  );

  // ── Auto-approve pending pairing requests ─────────────────────────────────
  const s = spinner();
  s.start("Polling for pending device pairing requests…");

  let pendingIds;
  try {
    pendingIds = await waitForPendingDevices();
  } catch {
    s.stop("Could not query device list");
    note(
      [
        "  Run manually:",
        `    docker exec ${CONTAINER_NAME} openclaw devices list`,
        `    docker exec ${CONTAINER_NAME} openclaw devices approve <request-id>`,
      ].join("\n"),
      "Manual pairing fallback"
    );
    return;
  }

  if (pendingIds.length === 0) {
    s.stop("No pending pairing requests found");
    log.warn(
      "No requests detected — the dashboard connection may still be in progress.\n" +
      "  Run manually:\n" +
      `    docker exec ${CONTAINER_NAME} openclaw devices list\n` +
      `    docker exec ${CONTAINER_NAME} openclaw devices approve <request-id>`
    );
    return;
  }

  s.stop(`Found ${pendingIds.length} pending request(s)`);

  let approved = 0;
  for (const id of pendingIds) {
    const s2 = spinner();
    s2.start(`Approving  ${id}…`);
    try {
      await approveDevice(id);
      s2.stop(`Approved  ${id} ✓`);
      approved++;
    } catch (err) {
      s2.stop(`Failed to approve  ${id}`);
      log.warn(`  Error: ${err.message}`);
      log.warn(`  Run manually: docker exec ${CONTAINER_NAME} openclaw devices approve ${id}`);
    }
  }

  if (approved > 0) {
    note(
      [
        `  ${approved} device(s) approved.`,
        "",
        "  Refresh your browser:",
        `    ${controlUrl}`,
        "",
        "  The Control UI should now load fully.",
        "  Send a test message in your connected channel to verify.",
      ].join("\n"),
      "Devices approved ✓"
    );
  }
}
