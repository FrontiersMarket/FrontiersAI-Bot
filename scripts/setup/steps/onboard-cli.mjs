import { select, text, note, log, spinner, password } from "@clack/prompts";
import { guardCancel } from "../lib/utils.mjs";

/**
 * AUTH_CHOICES — mirrors VALID_AUTH_CHOICES from server.js + the setup.html UI.
 * Maps authChoice value → { label, hint, needsSecret }
 */
const AUTH_CHOICES = [
  { value: "gemini-api-key",      label: "Google (Gemini)",     hint: "Gemini API key" },
  { value: "openai-api-key",      label: "OpenAI",              hint: "OpenAI API key" },
  { value: "apiKey",              label: "Anthropic",            hint: "Anthropic API key" },
  { value: "openrouter-api-key",  label: "OpenRouter",          hint: "OpenRouter API key" },
  { value: "ai-gateway-api-key",  label: "Vercel AI Gateway",   hint: "AI Gateway API key" },
  { value: "moonshot-api-key",    label: "Moonshot",            hint: "Moonshot API key" },
  { value: "zai-api-key",         label: "Z.AI",                hint: "Z.AI API key" },
  { value: "minimax-api",         label: "MiniMax",             hint: "MiniMax API key" },
  { value: "synthetic-api-key",   label: "Synthetic",           hint: "Synthetic API key" },
  { value: "opencode-zen",        label: "OpenCode Zen",        hint: "OpenCode Zen API key" },
  { value: "github-copilot",      label: "GitHub Copilot",      hint: "No key needed", needsSecret: false },
  { value: "copilot-proxy",       label: "Copilot Proxy",       hint: "No key needed", needsSecret: false },
  { value: "qwen-portal",         label: "Qwen Portal",         hint: "No key needed", needsSecret: false },
];

const DEFAULT_MODEL = "google/gemini-2.5-flash";

/**
 * Non-interactive onboarding: prompt for auth provider, API key, and model
 * via CLI, then POST to /setup/api/run on the running container.
 */
export async function runCliOnboarding(vars) {
  const port = vars.PORT ?? "8080";
  const setupPassword = vars.SETUP_PASSWORD;

  note(
    [
      "  Running onboarding directly from the CLI.",
      "  No browser needed — we'll configure the bot right here.",
    ].join("\n"),
    "Non-interactive onboarding"
  );

  // ── Auth provider ─────────────────────────────────────────────────────────
  const authChoice = guardCancel(
    await select({
      message: "Select AI provider:",
      options: AUTH_CHOICES.map((c) => ({
        value: c.value,
        label: c.label,
        hint: c.hint,
      })),
      initialValue: "gemini-api-key",
    })
  );

  const choiceMeta = AUTH_CHOICES.find((c) => c.value === authChoice);
  const needsSecret = choiceMeta?.needsSecret !== false;

  // ── API key ───────────────────────────────────────────────────────────────
  let authSecret = "";
  if (needsSecret) {
    authSecret = guardCancel(
      await password({
        message: `${choiceMeta?.hint ?? "API key"}:`,
        validate: (v) => (!v?.trim() ? "API key is required" : undefined),
      })
    );
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  const model = guardCancel(
    await text({
      message: "Model name:",
      placeholder: DEFAULT_MODEL,
      defaultValue: DEFAULT_MODEL,
    })
  );

  // ── Call /setup/api/run ───────────────────────────────────────────────────
  const s = spinner();
  s.start("Running onboarding…");

  const payload = {
    authChoice,
    authSecret: authSecret.trim(),
    model: model.trim() || DEFAULT_MODEL,
  };

  try {
    const url = `http://localhost:${port}/setup/api/run`;
    const authHeader = `Basic ${Buffer.from(`:${setupPassword}`).toString("base64")}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.ok) {
      s.stop("Onboarding complete ✓");
    } else {
      s.stop("Onboarding failed");
      log.error(data.output || "Unknown error from /setup/api/run");
      throw new Error("Onboarding failed — check output above");
    }
  } catch (err) {
    if (err.message === "Onboarding failed — check output above") throw err;
    s.stop("Could not reach the setup API");
    log.error(`  ${err.message}`);
    log.warn(`  Is the container running? Try: docker logs ${vars.CONTAINER_NAME ?? "frontiersai-bot"}`);
    throw err;
  }
}
