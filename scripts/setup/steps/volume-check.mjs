import { confirm, note, spinner, log } from "@clack/prompts";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { guardCancel, execFileAsync } from "../lib/utils.mjs";
import { ROOT, CONTAINER_NAME } from "../lib/constants.mjs";

const TMPDATA = resolve(ROOT, ".tmpdata");

/** Return a human-readable summary of what lives inside .tmpdata */
function summariseTmpdata() {
  const items = [
    { path: resolve(TMPDATA, ".openclaw", "openclaw.json"), label: "openclaw config  (.openclaw/openclaw.json)" },
    { path: resolve(TMPDATA, ".openclaw"),                  label: "openclaw state   (.openclaw/)" },
    { path: resolve(TMPDATA, "workspace"),                  label: "workspace files  (workspace/)" },
    { path: resolve(TMPDATA, "resources"),                  label: "resources        (resources/)" },
  ];
  return items
    .filter((i) => existsSync(i.path))
    .map((i) => `  ✓  ${i.label}`)
    .join("\n");
}

export async function checkVolume() {
  if (!existsSync(TMPDATA)) return; // nothing to do on a truly fresh clone

  const summary = summariseTmpdata();

  note(
    [
      `  Found existing volume data at:  .tmpdata/`,
      "",
      summary || "  (empty)",
      "",
      "  Clearing it ensures a clean setup with no stale config,",
      "  gateway tokens, or leftover state from a previous run.",
      "",
      "  Your .env file and workspace/ source files are NOT affected.",
    ].join("\n"),
    "Existing volume detected"
  );

  const clear = guardCancel(
    await confirm({
      message: "Clear .tmpdata/ for a clean setup?  (recommended)",
      initialValue: true,
    })
  );

  if (!clear) {
    log.info("Keeping existing .tmpdata/ — continuing with current state");
    return;
  }

  // Stop and remove the container first so it isn't writing to the volume
  {
    const s = spinner();
    s.start("Stopping container (if running)…");
    try {
      await execFileAsync("docker", ["rm", "--force", CONTAINER_NAME], { timeout: 20000 });
      s.stop("Container stopped and removed");
    } catch {
      s.stop("No running container found");
    }
  }

  // Wipe and recreate .tmpdata
  // Docker creates files as root inside the volume, so Node's rmSync often
  // fails with EACCES. Fall back to `sudo rm -rf` automatically.
  {
    const s = spinner();
    s.start("Clearing .tmpdata/…");
    try {
      rmSync(TMPDATA, { recursive: true, force: true });
      mkdirSync(TMPDATA, { recursive: true });
      s.stop(".tmpdata/ cleared ✓");
    } catch {
      // Permission denied — retry with sudo
      try {
        await execFileAsync("sudo", ["rm", "-rf", TMPDATA], { timeout: 15_000 });
        mkdirSync(TMPDATA, { recursive: true });
        s.stop(".tmpdata/ cleared (via sudo) ✓");
      } catch (err) {
        s.stop("Failed to clear .tmpdata/");
        log.warn(`  ${err.message}`);
        log.warn("  Try manually: sudo rm -rf .tmpdata && mkdir .tmpdata");
      }
    }
  }
}
