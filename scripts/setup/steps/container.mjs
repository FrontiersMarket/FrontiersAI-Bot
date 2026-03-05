import { confirm, select, spinner, note, log } from "@clack/prompts";
import {
  getContainerState,
  imageExists,
  removeContainer,
  buildDockerRunArgs,
} from "../lib/docker.mjs";
import { spawnInherited, bail, guardCancel } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";
import { CONTAINER_NAME } from "../lib/constants.mjs";

export async function manageContainer(vars) {
  const s = spinner();
  s.start("Checking Docker image and container state…");

  const [imgExists, containerState] = await Promise.all([
    imageExists(),
    getContainerState(),
  ]);

  s.stop("Docker state checked");

  note(
    [
      `  Image '${CONTAINER_NAME}':  ${imgExists ? "✓ built" : "✗ not found — build required"}`,
      `  Container:            ${containerState ? `'${CONTAINER_NAME}' is ${containerState}` : `no container named '${CONTAINER_NAME}'`}`,
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
