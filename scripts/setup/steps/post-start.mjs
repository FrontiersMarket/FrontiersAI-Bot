import { spinner, log } from "@clack/prompts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CONTAINER_NAME, RESOURCES_DEST, GCP_KEY_FILE } from "../lib/constants.mjs";
import { pollHealth } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";

export async function postStartCheck(vars) {
  const port = vars.PORT ?? "8080";
  const healthUrl = `http://localhost:${port}/setup/healthz`;

  // ── Health check ─────────────────────────────────────────────────────────
  const s = spinner();
  s.start(`Waiting for container health check  (${healthUrl})…`);
  const healthy = await pollHealth(healthUrl, 35_000);

  if (healthy) {
    s.stop("Container is healthy ✓");
  } else {
    s.stop("Health check timed out — container may still be starting up");
    log.warn("Run `docker logs -f frontiersai-bot` to monitor startup");
  }

  // ── gcloud auth verification ──────────────────────────────────────────────
  const s2 = spinner();
  s2.start("Checking gcloud auth in container logs…");
  try {
    const { stdout: logs } = await execFileAsync(
      "docker",
      ["logs", "--tail", "60", CONTAINER_NAME],
      { timeout: 8000 }
    );
    const activated =
      logs.includes("Activated service account credentials") ||
      logs.includes("auth activate-service-account");
    const keyPresent = existsSync(resolve(RESOURCES_DEST, GCP_KEY_FILE));

    if (activated) {
      s2.stop("gcloud: service account activated ✓");
    } else if (keyPresent) {
      s2.stop("gcloud: key present — auth will run on next container restart");
    } else {
      s2.stop("gcloud: no key found — GCP access not configured");
    }
  } catch {
    s2.stop("gcloud: could not read container logs");
  }
}
