import { confirm, text, select, note, log, spinner } from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKSPACE_SRC, WORKSPACE_DEST, SCOPE_FILE } from "../lib/constants.mjs";
import { guardCancel } from "../lib/utils.mjs";

const SCOPE_PATH = resolve(WORKSPACE_SRC, SCOPE_FILE);
const SCOPE_DEST = resolve(WORKSPACE_DEST, SCOPE_FILE);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCurrentScope() {
  if (!existsSync(SCOPE_PATH)) return null;
  const content = readFileSync(SCOPE_PATH, "utf8");
  const modeMatch = content.match(/^mode:\s*(\S+)/m);
  const uuidMatch = content.match(/^ranch_uuid:\s*(\S+)/m);
  return {
    mode: modeMatch?.[1] ?? "general",
    ranch_uuid: uuidMatch?.[1] ?? null,
  };
}

function buildScopeContent(mode, ranchUuid = null) {
  if (mode === "ranch") {
    return [
      "# SCOPE.md — Active Data Scope",
      "",
      "mode: ranch",
      `ranch_uuid: ${ranchUuid}`,
      "",
      "# To return to general mode, change to:",
      "# mode: general",
      "#",
      "# To scope to a different ranch:",
      "# mode: ranch",
      "# ranch_uuid: <uuid>",
      "",
    ].join("\n");
  }
  return [
    "# SCOPE.md — Active Data Scope",
    "",
    "mode: general",
    "",
    "# To scope to a specific ranch, change to:",
    "# mode: ranch",
    "# ranch_uuid: <uuid>",
    "",
  ].join("\n");
}

function syncToDest(content) {
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  writeFileSync(SCOPE_DEST, content, "utf8");
}

export async function configureBotScope() {
  const current = parseCurrentScope();

  // Show current state
  if (current) {
    note(
      current.mode === "ranch"
        ? [
            `  Current mode:  ranch`,
            `  Ranch UUID:    ${current.ranch_uuid}`,
          ].join("\n")
        : `  Current mode:  general  (no ranch filter)`,
      "Bot scope  (workspace/SCOPE.md)"
    );

    const change = guardCancel(
      await confirm({ message: "Change the current scope?", initialValue: false })
    );
    if (!change) {
      // Still sync to .tmpdata in case it's out of date
      const s = spinner();
      s.start("Syncing SCOPE.md to container volume…");
      syncToDest(readFileSync(SCOPE_PATH, "utf8"));
      s.stop("SCOPE.md synced ✓");
      return;
    }
  }

  // Choose mode
  const mode = guardCancel(
    await select({
      message: "Bot data scope",
      options: [
        {
          value: "ranch",
          label: "Ranch scope",
          hint: "bot only sees data for one specific ranch",
        },
        {
          value: "general",
          label: "General scope",
          hint: "bot has access to all ranches",
        },
      ],
    })
  );

  let ranchUuid = null;

  if (mode === "ranch") {
    ranchUuid = guardCancel(
      await text({
        message: "Ranch UUID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        initialValue: current?.ranch_uuid ?? "",
        validate: (v) => {
          if (!v || !v.trim()) return "Ranch UUID is required";
          if (!UUID_RE.test(v.trim()))
            return "Must be a valid UUID  (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
        },
      })
    );
    ranchUuid = ranchUuid.trim().toLowerCase();
  }

  // Write workspace/SCOPE.md
  const content = buildScopeContent(mode, ranchUuid);
  writeFileSync(SCOPE_PATH, content, "utf8");

  // Sync to .tmpdata/workspace/ (live container volume)
  const s = spinner();
  s.start("Syncing SCOPE.md to container volume…");
  syncToDest(content);
  s.stop("SCOPE.md synced ✓");

  if (mode === "ranch") {
    log.success(`Bot scoped to ranch  ${ranchUuid}`);
  } else {
    log.success("Bot set to general scope");
  }
}
