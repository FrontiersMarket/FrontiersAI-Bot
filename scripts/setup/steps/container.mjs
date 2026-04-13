import { confirm, select, spinner, note, log } from "@clack/prompts";
import {
  getContainerState,
  imageExists,
  removeContainer,
  buildDockerRunArgs,
} from "../lib/docker.mjs";
import { spawnInherited, bail, guardCancel } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";
import { CONTAINER_NAME, IMAGE_NAME, ROOT } from "../lib/constants.mjs";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const TMPDATA = resolve(ROOT, ".tmpdata");

/**
 * Ensure .tmpdata/ exists BEFORE Docker starts — if Docker creates it via
 * bind-mount, it'll be root-owned on Linux and the entrypoint may not be
 * able to fix top-level ownership.
 */
function ensureTmpdataDir() {
  if (!existsSync(TMPDATA)) {
    mkdirSync(TMPDATA, { recursive: true });
  }
}

/**
 * Return true if the image contains a specific file path.
 * Used to detect stale images that are missing new source files.
 */
async function imageHasFile(filePath) {
  try {
    await execFileAsync(
      "docker",
      ["run", "--rm", "--entrypoint", "test", IMAGE_NAME, "-f", filePath],
      { timeout: 8000 }
    );
    return true;
  } catch {
    return false;
  }
}

export async function manageContainer(vars) {
  const s = spinner();
  s.start("Checking Docker image and container state…");

  const dbSource = vars.DB_SOURCE?.trim() || "bigquery";

  const [imgExists, containerState, customDbInImage] = await Promise.all([
    imageExists(),
    getContainerState(),
    // Only check for the custom sync module when we'll actually need it
    dbSource === "custom" ? imageHasFile("/app/src/db-sync-custom.js") : Promise.resolve(true),
  ]);

  s.stop("Docker state checked");

  // If the image is missing db-sync-custom.js, a rebuild is required before
  // the custom DB sync service can start inside the container.
  const needsRebuildForCustomDb = dbSource === "custom" && imgExists && !customDbInImage;

  note(
    [
      `  Image '${CONTAINER_NAME}':  ${imgExists ? "✓ built" : "✗ not found — build required"}`,
      `  Container:            ${containerState ? `'${CONTAINER_NAME}' is ${containerState}` : `no container named '${CONTAINER_NAME}'`}`,
      ...(needsRebuildForCustomDb ? ["", "  ⚠  Image is missing db-sync-custom.js — rebuild required for custom DB mode"] : []),
    ].join("\n"),
    "Docker state"
  );

  // ── Decide on build ──────────────────────────────────────────────────────
  let shouldBuild = false;

  if (!imgExists) {
    const doBuild = guardCancel(
      await confirm({ message: "Build Docker image now?  (required to continue)", initialValue: true })
    );
    if (!doBuild) bail("Cannot continue without a built image. Run: pnpm docker:build");
    shouldBuild = true;
  } else if (needsRebuildForCustomDb) {
    // Image is missing the custom DB sync module — must rebuild, no choice
    log.warn("Rebuilding image to include custom DB sync support…");
    shouldBuild = true;
  } else {
    const rebuildChoice = guardCancel(
      await select({
        message: "Docker image",
        options: [
          { value: "keep", label: "Use existing image", hint: "skip rebuild" },
          { value: "rebuild", label: "Rebuild image", hint: "picks up code changes" },
        ],
      })
    );
    if (rebuildChoice === "rebuild") shouldBuild = true;
  }

  // ── Decide on container action ───────────────────────────────────────────
  let containerAction = "none";

  if (!imgExists || !containerState) {
    // After fresh build, or no container at all
    const startNow = guardCancel(
      await confirm({ message: "Start a new container now?", initialValue: true })
    );
    containerAction = startNow ? "recreate" : "none";
  } else if (containerState === "running") {
    containerAction = guardCancel(
      await select({
        message: `Container '${CONTAINER_NAME}' is already running`,
        options: [
          { value: "keep", label: "Leave it running", hint: "skip restart" },
          { value: "restart", label: "Restart", hint: "stop → start, same config" },
          { value: "recreate", label: "Recreate", hint: "remove → fresh run with current .env" },
        ],
      })
    );
  } else if (containerState === "exited" || containerState === "created") {
    containerAction = guardCancel(
      await select({
        message: `Container '${CONTAINER_NAME}' is stopped`,
        options: [
          { value: "start", label: "Start it", hint: "resume stopped container" },
          { value: "recreate", label: "Recreate", hint: "remove → fresh run with current .env" },
          { value: "none", label: "Skip", hint: "do nothing" },
        ],
      })
    );
  }

  // ── Build ────────────────────────────────────────────────────────────────
  if (shouldBuild) {
    log.info("Building Docker image — output below:\n");
    try {
      await spawnInherited("docker", ["build", "-t", CONTAINER_NAME, "."]);
      log.success("Docker image built");
    } catch (err) {
      bail(`Docker build failed: ${err.message}`);
    }
  }

  // ── Ensure .tmpdata/ exists before Docker touches it ─────────────────────
  ensureTmpdataDir();

  // ── Execute container action ─────────────────────────────────────────────
  if (containerAction === "none" || containerAction === "keep") {
    if (containerAction === "keep") log.info("Container left running");
    return containerState === "running";
  }

  if (containerAction === "start") {
    const s2 = spinner();
    s2.start("Starting container…");
    try {
      await execFileAsync("docker", ["start", CONTAINER_NAME], { timeout: 15000 });
      s2.stop("Container started");
    } catch (err) {
      s2.stop("Failed to start container");
      bail(`docker start failed: ${err.message}`);
    }
    return true;
  }

  if (containerAction === "restart") {
    const s2 = spinner();
    s2.start("Restarting container…");
    try {
      await execFileAsync("docker", ["restart", CONTAINER_NAME], { timeout: 30000 });
      s2.stop("Container restarted");
    } catch (err) {
      s2.stop("Failed to restart container");
      bail(`docker restart failed: ${err.message}`);
    }
    return true;
  }

  if (containerAction === "recreate") {
    const s2 = spinner();
    s2.start("Removing old container (if any)…");
    try {
      await removeContainer(CONTAINER_NAME);
    } catch (err) {
      s2.stop("Could not remove container");
      bail(err.message);
    }
    s2.stop("Old container removed");

    log.info("Starting new container…\n");
    try {
      await spawnInherited("docker", buildDockerRunArgs(vars));
      log.success(`Container '${CONTAINER_NAME}' started`);
    } catch {
      bail("docker run failed — see output above for details");
    }
    return true;
  }

  return false;
}
