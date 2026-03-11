import { confirm, log, note } from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { guardCancel } from "../lib/utils.mjs";
import { ROOT } from "../lib/constants.mjs";
import { parseEnvFile, writeEnvFile } from "../lib/env-file.mjs";

/**
 * Configure chat completions endpoint in openclaw.json.
 * The file lives on the shared volume so the container sees it directly.
 * Returns true if the file was modified, false if already correct or missing.
 */
function patchOpenclawForChatCompletions() {
  const jsonPath = resolve(ROOT, ".tmpdata", ".openclaw", "openclaw.json");
  if (!existsSync(jsonPath)) {
    // File doesn't exist yet, will be created during setup
    return false;
  }

  const config = JSON.parse(readFileSync(jsonPath, "utf8"));
  let changed = false;

  // Patch gateway.http.endpoints.chatCompletions.enabled
  config.gateway ??= {};
  config.gateway.http ??= {};
  config.gateway.http.endpoints ??= {};
  
  if (config.gateway.http.endpoints.chatCompletions?.enabled !== true) {
    config.gateway.http.endpoints.chatCompletions = { enabled: true };
    changed = true;
  }

  if (!changed) return false;
  writeFileSync(jsonPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return true;
}

export async function configureChatCompletions(vars) {
  const existing = parseEnvFile();
  const jsonPath = resolve(ROOT, ".tmpdata", ".openclaw", "openclaw.json");
  const hasConfig = existsSync(jsonPath);

  // Check if already enabled in .env
  const envEnabled = existing.ENABLE_CHAT_COMPLETIONS === "true";

  if (hasConfig) {
    try {
      const config = JSON.parse(readFileSync(jsonPath, "utf8"));
      const isEnabled = config.gateway?.http?.endpoints?.chatCompletions?.enabled === true;
      
      if (isEnabled && envEnabled) {
        note(
          "Chat completions endpoint is already enabled",
          "Chat Completions"
        );
        return true;
      }
    } catch (err) {
      // If we can't read the config, we'll prompt anyway
    }
  }

  const enableChatCompletions = guardCancel(
    await confirm({
      message: "Enable chat completions endpoint (/v1/chat/completions)?",
      initialValue: envEnabled || existing.ENABLE_CHAT_COMPLETIONS === undefined,
    })
  );

  // Update .env file
  const updatedVars = { ...existing, ...vars, ENABLE_CHAT_COMPLETIONS: enableChatCompletions ? "true" : "false" };
  writeEnvFile(updatedVars);

  if (enableChatCompletions) {
    if (hasConfig) {
      const patched = patchOpenclawForChatCompletions();
      if (patched) {
        log.success("Updated openclaw.json with chat completions configuration");
      } else {
        log.info("Chat completions already enabled in openclaw.json");
      }
    } else {
      log.info("Chat completions preference saved. Will be applied when openclaw.json is created.");
    }
    return true;
  }

  return false;
}

/**
 * Apply chat completions configuration to openclaw.json if enabled in .env.
 * Called from pairing flow after openclaw.json is created.
 */
export function applyChatCompletionsConfig() {
  const existing = parseEnvFile();
  if (existing.ENABLE_CHAT_COMPLETIONS !== "true") {
    return false;
  }
  return patchOpenclawForChatCompletions();
}
