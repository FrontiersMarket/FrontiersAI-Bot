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
 *   5. Container      — build image + start / restart / recreate
 *   6. Post-start     — health check + gcloud auth verification
 *   7. Bot scope      — ranch-scoped or general, writes workspace/SCOPE.md
 *   8. Pairing        — guide through /setup wizard + auto-approve devices
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

async function main() {
  console.log("");
  intro(" Frontiers Market Bot — Local Setup ");

  // Phase 1 — system requirements
  await checkPrerequisites();

  // Phase 2 — volume pre-check
  await checkVolume();

  // Phase 3 — .env
  const vars = await configureEnv();

  // Phase 3 — GCP service-account key (enforced)
  await setupGcpKey();

  // Phase 4 — Docker image + container
  const containerStarted = await manageContainer(vars);

  // Phase 5 — health + gcloud
  if (containerStarted) {
    await postStartCheck(vars);
  }

  // Phase 6 — bot data scope (ranch or general)
  await configureBotScope();

  // Phase 7 — setup wizard + device pairing
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

  outro("Setup complete. Happy ranching!");
}

main().catch((err) => {
  console.error("\nUnexpected error:", err.message);
  process.exit(1);
});
