import { text, select, log, spinner } from "@clack/prompts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WORKSPACE_SRC, WORKSPACE_DEST, SCOPE_FILE } from "../lib/constants.mjs";
import { guardCancel } from "../lib/utils.mjs";

const SCOPE_PATH = resolve(WORKSPACE_SRC, SCOPE_FILE);
const SCOPE_DEST = resolve(WORKSPACE_DEST, SCOPE_FILE);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENTS_FILE = "AGENTS.md";
const SCOPE_MARKER_START = "<!-- SCOPE:START -->";
const SCOPE_MARKER_END = "<!-- SCOPE:END -->";

/**
 * Inject the active scope into AGENTS.md between the SCOPE markers so the
 * scope is part of the auto-loaded agent context — no tool call required on
 * the first user message.
 */
function injectScopeIntoAgents(mode, ranchUuid, agentsPath) {
  if (!existsSync(agentsPath)) return;

  const lines =
    mode === "ranch"
      ? [`mode: ranch`, `ranch_uuid: ${ranchUuid}`]
      : [`mode: general`];

  const block = [
    SCOPE_MARKER_START,
    "## Active Scope",
    "",
    ...lines,
    "",
    "*(Auto-updated by `pnpm setup:local` — do not edit manually)*",
    SCOPE_MARKER_END,
  ].join("\n");

  const existing = readFileSync(agentsPath, "utf8");
  const startIdx = existing.indexOf(SCOPE_MARKER_START);
  const endIdx = existing.indexOf(SCOPE_MARKER_END);

  let updated;
  if (startIdx !== -1 && endIdx !== -1) {
    updated =
      existing.slice(0, startIdx) +
      block +
      existing.slice(endIdx + SCOPE_MARKER_END.length);
  } else {
    updated = existing + "\n" + block + "\n";
  }

  writeFileSync(agentsPath, updated, "utf8");
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

/**
 * Read the current scope from SCOPE.md and re-inject it into the dest AGENTS.md.
 * Call this after sync-workspace.sh to ensure the sync doesn't overwrite the injection.
 */
export function reInjectScope() {
  const scopePath = SCOPE_PATH;
  if (!existsSync(scopePath)) return;

  const raw = readFileSync(scopePath, "utf8");
  const modeMatch = raw.match(/^mode:\s*(\S+)/m);
  const uuidMatch = raw.match(/^ranch_uuid:\s*(\S+)/m);
  if (!modeMatch) return;

  const mode = modeMatch[1];
  const ranchUuid = uuidMatch ? uuidMatch[1] : null;
  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
  injectScopeIntoAgents(mode, ranchUuid, agentsDest);
}

export async function configureBotScope() {
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
        validate: (v) => {
          if (!v || !v.trim()) return "Ranch UUID is required";
          if (!UUID_RE.test(v.trim()))
            return "Must be a valid UUID  (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
        },
      })
    );
    ranchUuid = ranchUuid.trim().toLowerCase();
  }

  const content = buildScopeContent(mode, ranchUuid);

  const s = spinner();
  s.start("Writing SCOPE.md and injecting scope into AGENTS.md…");
  writeFileSync(SCOPE_PATH, content, "utf8");
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  writeFileSync(SCOPE_DEST, content, "utf8");

  // Inject scope inline into the dest AGENTS.md (gitignored .tmpdata/) so it's
  // part of the auto-loaded container context — no tool call needed on first message.
  // The source workspace/AGENTS.md is NOT touched to avoid git noise.
  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
  injectScopeIntoAgents(mode, ranchUuid, agentsDest);

  s.stop("SCOPE.md written and scope injected into AGENTS.md ✓");

  if (mode === "ranch") {
    log.success(`Bot scoped to ranch  ${ranchUuid}`);
  } else {
    log.success("Bot set to general scope");
  }
}
