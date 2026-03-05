import { text, select, log, spinner } from "@clack/prompts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { WORKSPACE_SRC, WORKSPACE_DEST, SCOPE_FILE } from "../lib/constants.mjs";
import { guardCancel } from "../lib/utils.mjs";

const SCOPE_PATH = resolve(WORKSPACE_SRC, SCOPE_FILE);
const SCOPE_DEST = resolve(WORKSPACE_DEST, SCOPE_FILE);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  s.start("Writing SCOPE.md…");
  writeFileSync(SCOPE_PATH, content, "utf8");
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  writeFileSync(SCOPE_DEST, content, "utf8");
  s.stop("SCOPE.md written and synced to container volume ✓");

  if (mode === "ranch") {
    log.success(`Bot scoped to ranch  ${ranchUuid}`);
  } else {
    log.success("Bot set to general scope");
  }
}
