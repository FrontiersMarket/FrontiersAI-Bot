import { text, password, confirm, select, spinner, note, log } from "@clack/prompts";
import { parseEnvFile, writeEnvFile } from "../lib/env-file.mjs";
import { generateToken, guardCancel } from "../lib/utils.mjs";
import { ENV_PATH } from "../lib/constants.mjs";

export async function configureEnv() {
  const existing = parseEnvFile();
  const hasExisting = Object.keys(existing).length > 0;

  if (hasExisting) {
    note(
      [
        `  File: ${ENV_PATH}`,
        "",
        `  SETUP_PASSWORD         ${existing.SETUP_PASSWORD ? "set" : "⚠  not set"}`,
        `  OPENCLAW_GATEWAY_TOKEN ${existing.OPENCLAW_GATEWAY_TOKEN ? "set" : "not set (auto-generated)"}`,
        `  PORT                   ${existing.PORT ?? "8080 (default)"}`,
        `  ENABLE_WEB_TUI         ${existing.ENABLE_WEB_TUI ?? "false (default)"}`,
        `  ENABLE_CHAT_COMPLETIONS ${existing.ENABLE_CHAT_COMPLETIONS ?? "true (default)"}`,
      ].join("\n"),
      "Existing .env"
    );

    const reconfigure = guardCancel(
      await confirm({ message: "Reconfigure .env?", initialValue: false })
    );
    if (!reconfigure) return existing;
  }

  // ── SETUP_PASSWORD ──────────────────────────────────────────────────────
  const setupPassword = guardCancel(
    await password({
      message: existing.SETUP_PASSWORD
        ? "Setup wizard password  (leave blank to keep current)"
        : "Setup wizard password  (protects /setup)",
      validate: (v) => {
        if (existing.SETUP_PASSWORD && !v.trim()) return undefined;
        if (!v || v.trim().length < 6) return "Must be at least 6 characters";
      },
    })
  );

  // ── GATEWAY TOKEN ───────────────────────────────────────────────────────
  const tokenOptions = [
    { value: "generate", label: "Auto-generate  (recommended)", hint: "openssl rand -hex 32" },
    { value: "enter", label: "Enter my own token" },
  ];
  if (existing.OPENCLAW_GATEWAY_TOKEN) {
    tokenOptions.push({ value: "keep", label: "Keep existing token" });
  }

  const tokenChoice = guardCancel(
    await select({ message: "Gateway bearer token", options: tokenOptions })
  );

  let gatewayToken = existing.OPENCLAW_GATEWAY_TOKEN ?? "";
  if (tokenChoice === "generate") {
    const s = spinner();
    s.start("Generating token…");
    gatewayToken = await generateToken();
    s.stop(`Token generated  (${gatewayToken.slice(0, 8)}…)`);
  } else if (tokenChoice === "enter") {
    gatewayToken = guardCancel(
      await text({
        message: "Paste your gateway token",
        validate: (v) =>
          !v || v.trim().length < 16 ? "Token must be at least 16 chars" : undefined,
      })
    );
  }

  // ── PORT ────────────────────────────────────────────────────────────────
  const port = guardCancel(
    await text({
      message: "Wrapper listen port",
      initialValue: existing.PORT ?? "8080",
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 65535) return "Must be a valid port (1–65535)";
      },
    })
  );

  // ── ENABLE_WEB_TUI ──────────────────────────────────────────────────────
  const enableTui = guardCancel(
    await confirm({
      message: "Enable browser terminal at /tui?",
      initialValue: existing.ENABLE_WEB_TUI === "true",
    })
  );

  const vars = {
    SETUP_PASSWORD:
      setupPassword && setupPassword.trim()
        ? setupPassword.trim()
        : (existing.SETUP_PASSWORD ?? ""),
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_STATE_DIR: existing.OPENCLAW_STATE_DIR ?? "/data/.openclaw",
    OPENCLAW_WORKSPACE_DIR: existing.OPENCLAW_WORKSPACE_DIR ?? "/data/workspace",
    PORT: port.trim(),
    ENABLE_WEB_TUI: enableTui ? "true" : "false",
    ENABLE_CHAT_COMPLETIONS: existing.ENABLE_CHAT_COMPLETIONS ?? "true",
    INTERNAL_GATEWAY_PORT: existing.INTERNAL_GATEWAY_PORT ?? "18789",
  };

  writeEnvFile(vars);
  log.success(`.env written → ${ENV_PATH}`);
  return vars;
}