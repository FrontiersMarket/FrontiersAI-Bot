#!/usr/bin/env node
/**
 * Frontiers Market Bot — Local Setup Wizard
 *
 * Run with:  pnpm setup:local
 *
 * Phases:
 *   1. Prerequisites  — node, pnpm, docker daemon
 *   2. Volume check   — detect & optionally wipe .tmpdata/ for a clean run
 *   3. Environment    — write .env with required vars
 *   4. GCP key        — enforce service-account key in resources/
 *   5. Bot scope      — ranch UUID (must run before container for RANCH_UUID env var)
 *   6. Container      — build image + start / restart / recreate
 *   7. Post-start     — health check + gcloud auth verification
 *   8. Sync cron      — create OpenClaw cron job for recurring BQ → SQLite syncs
 *   9. Pairing        — guide through /setup wizard + auto-approve devices
 *  10. DB sync        — wait for initial BigQuery → SQLite sync (gateway must be up)
 */

import { intro, outro, note } from "@clack/prompts";
import { checkPrerequisites } from "./steps/prerequisites.mjs";
import { checkVolume } from "./steps/volume-check.mjs";
import { configureEnv } from "./steps/env.mjs";
import { setupGcpKey } from "./steps/gcp-key.mjs";
import { manageContainer } from "./steps/container.mjs";
import { postStartCheck } from "./steps/post-start.mjs";
import { configureBotScope } from "./steps/scope.mjs";
import { runPairingFlow } from "./steps/pairing.mjs";
import { waitForDbSync } from "./steps/db-sync-wait.mjs";
import { setupSyncCron } from "./steps/setup-cron.mjs";

async function main() {
  console.log("");
  intro(" Frontiers Market Bot — Local Setup ");

  // Phase 1 — system requirements
  await checkPrerequisites();

  // Phase 2 — volume pre-check
  await checkVolume();

  // Phase 3 — .env
  const vars = await configureEnv();

  // Phase 4 — GCP service-account key (enforced)
  await setupGcpKey(vars);

  // Phase 5 — bot data scope (must run before container so RANCH_UUID is in env)
  const ranchUuid = await configureBotScope();
  if (ranchUuid) vars.RANCH_UUID = ranchUuid;

  // Phase 6 — Docker image + container
  const containerStarted = await manageContainer(vars);

  // Phase 7 — health + gcloud
  if (containerStarted) {
    await postStartCheck(vars);
  }

  // Phase 8 — configure OpenClaw cron for recurring BQ → SQLite syncs
  if (containerStarted) {
    await setupSyncCron(vars);
  }

  // Phase 9 — setup wizard + device pairing
  if (containerStarted) {
    await runPairingFlow(vars);
  } else {
    const port = vars.PORT ?? "8080";
    note(
      [
        "  Container not started — skipping setup wizard and pairing steps.",
        "",
        "  When ready, start the container with:  pnpm up",
        `  Then open:  http://localhost:${port}/setup`,
        `  Password:   ${vars.SETUP_PASSWORD}`,
      ].join("\n"),
      "Container not running"
    );
  }

  // Phase 10 — wait for initial BQ → SQLite sync (runs after pairing so gateway is up)
  if (containerStarted) {
    await waitForDbSync(vars);
  }

  outro("Setup complete. Happy ranching!");
}

main().catch((err) => {
  console.error("\nUnexpected error:", err.message);
  process.exit(1);
});
