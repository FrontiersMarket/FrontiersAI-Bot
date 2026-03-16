import { CONTAINER_NAME, IMAGE_NAME, ROOT } from "./constants.mjs";
import { execFileAsync } from "./utils.mjs";

/**
 * Returns the container's State.Status, or null if the container doesn't exist.
 * Common values: 'running', 'exited', 'created', 'paused', 'restarting'
 */
export async function getContainerState(name = CONTAINER_NAME) {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", name],
      { timeout: 5000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Returns true if the local image tag exists. */
export async function imageExists(tag = IMAGE_NAME) {
  try {
    await execFileAsync("docker", ["image", "inspect", tag], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Force-remove a container (handles both running and stopped). Throws if it can't be removed. */
export async function removeContainer(name = CONTAINER_NAME) {
  try {
    await execFileAsync("docker", ["rm", "--force", name], { timeout: 20000 });
  } catch {}
  const state = await getContainerState(name);
  if (state !== null) {
    throw new Error(
      `Container '${name}' could not be removed (state: ${state}). Run: docker rm --force ${name}`
    );
  }
}

/** Build docker run args from env vars. */
export function buildDockerRunArgs(vars) {
  const port = vars.PORT ?? "8080";
  const containerName = vars.CONTAINER_NAME || CONTAINER_NAME;
  const args = [
    "run", "-d",
    "--name", containerName,
    "-p", `${port}:${port}`,
    "-e", `PORT=${port}`,
    "-e", `SETUP_PASSWORD=${vars.SETUP_PASSWORD ?? ""}`,
    "-e", `ENABLE_WEB_TUI=${vars.ENABLE_WEB_TUI ?? "false"}`,
    "-e", `ENABLE_CHAT_COMPLETIONS=${vars.ENABLE_CHAT_COMPLETIONS ?? "false"}`,
    "-e", `OPENCLAW_STATE_DIR=${vars.OPENCLAW_STATE_DIR ?? "/data/.openclaw"}`,
    "-e", `OPENCLAW_WORKSPACE_DIR=${vars.OPENCLAW_WORKSPACE_DIR ?? "/data/workspace"}`,
    "-e", `INTERNAL_GATEWAY_PORT=${vars.INTERNAL_GATEWAY_PORT ?? "18789"}`,
  ];
  if (vars.OPENCLAW_GATEWAY_TOKEN) {
    args.push("-e", `OPENCLAW_GATEWAY_TOKEN=${vars.OPENCLAW_GATEWAY_TOKEN}`);
  }
  if (vars.RANCH_UUID) {
    args.push("-e", `RANCH_UUID=${vars.RANCH_UUID}`);
  }
  args.push("-v", `${ROOT}/.tmpdata:/data`);
  args.push(IMAGE_NAME);
  return args;
}

/**
 * Run an openclaw subcommand inside the container as root.
 * Args are passed as separate items — no shell quoting needed.
 */
export async function execOpenclaw(args, timeoutMs = 10_000) {
  return execFileAsync(
    "docker",
    ["exec", CONTAINER_NAME, "openclaw", ...args],
    { timeout: timeoutMs }
  );
}

/**
 * Parse the wrapped table format that `openclaw devices list` emits.
 *
 * The CLI wraps long request IDs across multiple rows in the first column:
 *
 *   │ 5775ba36-c93c-    │ …
 *   │ 4156-ba37-        │ …
 *   │ 95e751e22f9b      │ …
 *
 * Strategy: concatenate all non-empty first-column cells, then extract UUIDs.
 */
function parseRequestIds(stdout) {
  const chunks = [];

  for (const line of stdout.split("\n")) {
    // Data rows start with │ but separator rows contain ─ / ┼
    if (!line.startsWith("│")) continue;
    if (line.includes("─") || line.includes("┼")) continue;

    // Split on │ — index 0 is empty (before first │), index 1 is first column
    const parts = line.split("│");
    if (parts.length < 3) continue;

    const cell = parts[1].trim();
    if (!cell || cell === "Request") continue; // skip empty cells and header
    chunks.push(cell);
  }

  const joined = chunks.join("");
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  return [...new Set(joined.match(uuidRe) ?? [])];
}

/**
 * List pending device pairing requests.
 * Returns an array of request IDs (strings).
 */
export async function listPendingDevices() {
  const { stdout } = await execOpenclaw(["devices", "list"]);

  // Table format (the standard CLI output)
  const tableIds = parseRequestIds(stdout);
  if (tableIds.length > 0) return tableIds;

  // JSON fallback (in case a future version supports it)
  const trimmed = stdout.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const items = Array.isArray(data)
        ? data
        : (data.devices ?? data.requests ?? data.items ?? []);
      const ids = items
        .filter((d) =>
          ["pending", "waiting", "requested"].includes(
            (d.status ?? d.state ?? "").toLowerCase()
          )
        )
        .map((d) => d.id ?? d.requestId ?? d.deviceId ?? d.device_id)
        .filter(Boolean);
      if (ids.length > 0) return ids;
    } catch {}
  }

  return [];
}

/** Approve a device pairing request by ID. */
export async function approveDevice(requestId) {
  await execOpenclaw(["devices", "approve", requestId]);
}
