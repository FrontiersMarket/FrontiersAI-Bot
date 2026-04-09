import { text, log, spinner } from "@clack/prompts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WORKSPACE_SRC, WORKSPACE_DEST, SCOPE_FILE, ENV_PATH } from "../lib/constants.mjs";
import { guardCancel } from "../lib/utils.mjs";
import { parseEnvFile } from "../lib/env-file.mjs";

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
function injectScopeIntoAgents(ranchUuid, dataset, agentsPath) {
  if (!existsSync(agentsPath)) return;

  const block = [
    SCOPE_MARKER_START,
    "## Active Scope",
    "",
    `mode: ranch`,
    `ranch_uuid: ${ranchUuid}`,
    `gbq_dataset: ${dataset}`,
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

function buildScopeContent(ranchUuid, dataset) {
  return [
    "# SCOPE.md — Active Data Scope",
    "",
    "mode: ranch",
    `ranch_uuid: ${ranchUuid}`,
    `gbq_dataset: ${dataset}`,
    "",
    "# To scope to a different ranch, change ranch_uuid and re-run pnpm setup:local",
    "",
  ].join("\n");
}

/**
 * Read the current scope from SCOPE.md and re-inject it into the dest AGENTS.md.
 * Call this after workspace sync to ensure the sync doesn't overwrite the injection.
 */
export function reInjectScope() {
  const scopePath = SCOPE_PATH;
  if (!existsSync(scopePath)) return;

  const raw = readFileSync(scopePath, "utf8");
  const uuidMatch = raw.match(/^ranch_uuid:\s*(\S+)/m);
  if (!uuidMatch) return;

  const ranchUuid = uuidMatch[1];
  const datasetMatch = raw.match(/^gbq_dataset:\s*(\S+)/m);
  const dataset = datasetMatch?.[1] ?? "public";
  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
  injectScopeIntoAgents(ranchUuid, dataset, agentsDest);
}

/**
 * Update (or append) RANCH_UUID in the .env file without touching other vars.
 */
function writeRanchUuidToEnv(ranchUuid) {
  if (!existsSync(ENV_PATH)) return;

  let content = readFileSync(ENV_PATH, "utf8");

  if (/^RANCH_UUID=/m.test(content)) {
    content = content.replace(/^RANCH_UUID=.*/m, `RANCH_UUID=${ranchUuid}`);
  } else {
    content = content.trimEnd() + `\n\n# Ranch UUID this bot is scoped to\nRANCH_UUID=${ranchUuid}\n`;
  }

  writeFileSync(ENV_PATH, content, "utf8");
}

/**
 * Update (or append) GBQ_DATASET in the .env file without touching other vars.
 */
function writeDatasetToEnv(dataset) {
  if (!existsSync(ENV_PATH)) return;

  let content = readFileSync(ENV_PATH, "utf8");

  if (/^GBQ_DATASET=/m.test(content)) {
    content = content.replace(/^GBQ_DATASET=.*/m, `GBQ_DATASET=${dataset}`);
  } else {
    content = content.trimEnd() + `\n\n# BigQuery dataset to pull ranch data from\nGBQ_DATASET=${dataset}\n`;
  }

  writeFileSync(ENV_PATH, content, "utf8");
}

export async function configureBotScope() {
  const existing = parseEnvFile();
  const existingUuid = existing.RANCH_UUID?.trim() ?? "";
  const existingDataset = existing.GBQ_DATASET?.trim() ?? "public";

  const ranchUuid = guardCancel(
    await text({
      message: "Ranch UUID this bot is scoped to",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      initialValue: existingUuid,
      validate: (v) => {
        if (!v || !v.trim()) return "Ranch UUID is required — this bot must always be scoped to a ranch";
        if (!UUID_RE.test(v.trim()))
          return "Must be a valid UUID  (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
      },
    })
  );

  const gbqDataset = guardCancel(
    await text({
      message: "BigQuery dataset to pull data from",
      placeholder: "public",
      initialValue: existingDataset,
      validate: (v) => {
        if (!v || !v.trim()) return "Dataset name is required";
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.trim()))
          return "Must be a valid BigQuery dataset name (letters, numbers, underscores)";
      },
    })
  );

  const uuid = ranchUuid.trim().toLowerCase();
  const dataset = gbqDataset.trim();
  const content = buildScopeContent(uuid, dataset);

  const s = spinner();
  s.start("Writing SCOPE.md, injecting scope into AGENTS.md, updating .env…");

  writeFileSync(SCOPE_PATH, content, "utf8");
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  writeFileSync(SCOPE_DEST, content, "utf8");

  // Inject scope inline into the dest AGENTS.md (gitignored .tmpdata/) so it's
  // part of the auto-loaded container context — no tool call needed on first message.
  // The source workspace/AGENTS.md is NOT touched to avoid git noise.
  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
  injectScopeIntoAgents(uuid, dataset, agentsDest);

  // Persist RANCH_UUID and GBQ_DATASET to .env so the server and DB sync service can use them
  writeRanchUuidToEnv(uuid);
  writeDatasetToEnv(dataset);

  s.stop("Scope configured ✓");
  log.success(`Bot scoped to ranch ${uuid}  (dataset: ${dataset})`);

  return uuid;
}
