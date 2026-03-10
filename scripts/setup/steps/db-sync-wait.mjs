import { spinner, log, note } from "@clack/prompts";
import http from "node:http";
import { CONTAINER_NAME } from "../lib/constants.mjs";
import { execFileAsync } from "../lib/utils.mjs";

const POLL_INTERVAL_MS = 3_000;
const INIT_TIMEOUT_MS  = 40_000;   // time to wait for syncState.initialized
const SYNC_TIMEOUT_MS  = 5 * 60 * 1000; // time to wait for sync to finish once started
const STALL_WARN_MS    = 20_000;   // show a warning after this long with no progress

function apiGet(url, password) {
  const token = Buffer.from(`:${password}`).toString("base64");
  return new Promise((resolve) => {
    try {
      const req = http.get(
        url,
        { headers: { Authorization: `Basic ${token}` }, timeout: 5000 },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try { resolve(JSON.parse(body)); } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function tailContainerLogs(lines = 8) {
  try {
    const { stdout } = await execFileAsync(
      "docker", ["logs", "--tail", String(lines), CONTAINER_NAME],
      { timeout: 5000 }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

function formatNumber(n) {
  return Number(n).toLocaleString();
}

export async function waitForDbSync(vars) {
  const port     = vars.PORT ?? "8080";
  const password = vars.SETUP_PASSWORD;
  const statusUrl = `http://localhost:${port}/setup/api/sync-status`;

  // ── Phase 1: wait for sync service to initialize ───────────────────────────
  const s = spinner();
  s.start("Waiting for DB sync service to initialize…");

  const initDeadline = Date.now() + INIT_TIMEOUT_MS;
  let attempts = 0;
  let status = null;

  while (Date.now() < initDeadline) {
    attempts++;
    status = await apiGet(statusUrl, password);

    if (!status) {
      s.message(`Waiting for server to respond… (attempt ${attempts})`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (!status.ranchUuid) {
      s.stop("DB sync skipped — RANCH_UUID not set in container");
      log.warn("Restart the container after re-running the scope step.");
      return;
    }

    if (status.initialized || status.running || status.lastSyncAt) {
      break; // sync service is up
    }

    const elapsed = Date.now() - (initDeadline - INIT_TIMEOUT_MS);
    if (elapsed > STALL_WARN_MS) {
      s.message(`Sync service not responding after ${Math.round(elapsed / 1000)}s — still waiting…`);
    } else {
      s.message(`Initializing… (attempt ${attempts})`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!status?.initialized && !status?.running && !status?.lastSyncAt) {
    s.stop("DB sync service did not initialize in time");
    const logs = await tailContainerLogs(10);
    log.warn(
      [
        "The sync service failed to start. Possible causes:",
        "  • GCP credentials not loaded (check GOOGLE_APPLICATION_CREDENTIALS in container)",
        "  • RANCH_UUID env var missing (restart container after scope step)",
        "  • BigQuery connection issue",
        "",
        "Check logs with:  docker logs -f frontiersai-bot",
        ...(logs ? ["", "Recent container output:", ...logs.split("\n").map((l) => `  ${l}`)] : []),
      ].join("\n")
    );
    return;
  }

  // ── Phase 2: wait for the sync to actually complete ────────────────────────
  if (status?.lastSyncAt && !status?.running) {
    // Already done (e.g. re-run of setup)
  } else {
    s.message("Sync in progress — pulling ranch data from BigQuery…");
    const syncDeadline = Date.now() + SYNC_TIMEOUT_MS;
    let stallWarned = false;

    while (Date.now() < syncDeadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      status = await apiGet(statusUrl, password);

      if (!status) continue;

      if (status.lastSyncAt && !status.running) break;

      if (status.running) {
        const populated = Object.values(status.tables ?? {}).filter((t) => t.rows > 0).length;
        s.message(
          populated > 0
            ? `Syncing… ${populated} tables populated so far`
            : "Syncing tables from BigQuery…"
        );
        stallWarned = false;
      } else if (!stallWarned) {
        s.message("Waiting for sync to complete…");
        stallWarned = true;
      }
    }

    if (!status?.lastSyncAt) {
      s.stop("Sync timed out — still running in the background");
      log.warn("Monitor progress with:  docker logs -f frontiersai-bot");
      return;
    }
  }

  s.stop("Initial DB sync complete ✓");

  // ── Summary ────────────────────────────────────────────────────────────────
  const tables       = status.tables ?? {};
  const totalTables  = Object.keys(tables).length;
  const populated    = Object.entries(tables)
    .filter(([, v]) => v.rows > 0)
    .sort(([, a], [, b]) => b.rows - a.rows);
  const skipped      = Object.values(tables).filter((v) => v.error).length;

  const topRows = populated
    .slice(0, 8)
    .map(([name, v]) => `  ${name.padEnd(24)} ${formatNumber(v.rows)} rows`)
    .join("\n");

  note(
    [
      `Database:    ${status.dbPath}`,
      `Tables:      ${populated.length} of ${totalTables} populated${skipped ? `  (${skipped} not in BQ)` : ""}`,
      "",
      "Top tables by row count:",
      topRows || "  (no data synced)",
      "",
      `Next auto-sync in ${Math.round((status.syncIntervalMs ?? 300000) / 60000)} min`,
    ].join("\n"),
    "Local DB Sync"
  );
}
