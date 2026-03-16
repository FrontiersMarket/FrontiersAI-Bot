import { text, confirm, log } from "@clack/prompts";
import { DEFAULT_CONTAINER_NAME, setContainerName } from "../lib/constants.mjs";
import { guardCancel, execFileAsync } from "../lib/utils.mjs";
import { writeEnvFile } from "../lib/env-file.mjs";

/**
 * Returns an array of { name, port } for running Docker containers that publish
 * the given host port.
 */
async function containersOnPort(port) {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--format", "{{.Names}}", "--filter", `publish=${port}`],
      { timeout: 5000 }
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((name) => name.trim());
  } catch {
    return [];
  }
}

/**
 * Find the next free host port starting from `start`.
 * A port is "free" if no running Docker container publishes it.
 */
async function findFreePort(start) {
  for (let p = start; p < start + 100; p++) {
    const users = await containersOnPort(p);
    if (users.length === 0) return p;
  }
  return null;
}

export async function configureContainerName(vars) {
  const existing = vars.CONTAINER_NAME || DEFAULT_CONTAINER_NAME;

  const name = guardCancel(
    await text({
      message: "Docker container name",
      placeholder: DEFAULT_CONTAINER_NAME,
      initialValue: existing,
      validate: (v) => {
        if (!v?.trim()) return "Container name is required";
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v.trim()))
          return "Invalid name — use alphanumeric, dots, hyphens, underscores";
      },
    })
  ).trim();

  // Apply the name globally (ES module live binding)
  setContainerName(name);
  vars.CONTAINER_NAME = name;

  // ── Port conflict check ──────────────────────────────────────────────────
  const port = parseInt(vars.PORT || "8080", 10);
  const occupiers = await containersOnPort(port);

  // Filter out our own container — it's fine if we're reusing the same name
  const others = occupiers.filter((n) => n !== name);

  if (others.length > 0) {
    log.warn(
      `Port ${port} is already in use by container: ${others.join(", ")}`
    );

    const freePort = await findFreePort(port + 1);
    if (!freePort) {
      log.error("Could not find a free port in the next 100 ports");
      return;
    }

    const useNewPort = guardCancel(
      await confirm({
        message: `Use port ${freePort} instead?`,
        initialValue: true,
      })
    );

    if (useNewPort) {
      vars.PORT = String(freePort);
      writeEnvFile(vars);
      log.success(`Port updated to ${freePort} in .env`);
    } else {
      log.warn(
        `Keeping port ${port} — you may need to stop the other container first`
      );
    }
  }

  log.success(`Container name: ${name}  |  Port: ${vars.PORT ?? "8080"}`);
}
