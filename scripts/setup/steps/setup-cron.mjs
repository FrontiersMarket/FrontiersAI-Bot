import { select, log, spinner, note } from "@clack/prompts";
import { guardCancel } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";
import { CONTAINER_NAME } from "../lib/constants.mjs";

// bq-sync kept for BigQuery mode (backwards compat); custom mode uses db-sync
function jobName(dbSource) {
  return dbSource === "custom" ? "db-sync" : "bq-sync";
}

const INTERVAL_OPTIONS = [
  { value: "1m",  label: "Every 1 minute" },
  { value: "5m",  label: "Every 5 minutes  (recommended)" },
  { value: "10m", label: "Every 10 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h",  label: "Every hour" },
];

/**
 * Run an openclaw CLI command inside the container as the openclaw user.
 */
async function openclawCmd(args) {
  const { stdout, stderr } = await execFileAsync(
    "docker",
    ["exec", CONTAINER_NAME, "su", "openclaw", "-c", `openclaw ${args}`],
    { timeout: 15_000 }
  );
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Find an existing cron job by name. Returns the job object or null.
 */
async function findExistingJob(name) {
  try {
    const { stdout } = await openclawCmd("cron list --json");
    const data = JSON.parse(stdout);
    return data.jobs?.find((j) => j.name === name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Configure the OpenClaw cron job that triggers the local DB sync.
 * Works for both BigQuery (FM Management) and Custom DB modes.
 */
export async function setupSyncCron(vars) {
  const port     = vars.PORT ?? "8080";
  const dbSource = vars.DB_SOURCE?.trim() || "bigquery";
  const name     = jobName(dbSource);

  const existing = await findExistingJob(name);

  if (existing) {
    const state = existing.disabled ? "disabled" : "enabled";
    log.info(
      `Cron job "${name}" already exists (${state}, every ${existing.every ?? existing.cron ?? "?"}).`
    );

    const action = guardCancel(
      await select({
        message: "What would you like to do?",
        options: [
          { value: "keep",   label: "Keep as-is" },
          { value: "update", label: "Update interval" },
          { value: "skip",   label: "Skip" },
        ],
      })
    );

    if (action === "keep" || action === "skip") return;

    if (action === "update") {
      await openclawCmd(`cron rm ${existing.id}`);
    }
  }

  const every = guardCancel(
    await select({
      message: "How often should the bot sync the local database?",
      options: INTERVAL_OPTIONS,
    })
  );

  const s = spinner();
  s.start(`Creating OpenClaw cron job "${name}" (every ${every})…`);

  try {
    const triggerCmd = `curl -s -X POST http://localhost:${port}/internal/sync-now`;

    await openclawCmd(
      `cron add --name "${name}" --every ${every} --message "${triggerCmd}" --no-deliver --light-context --session isolated`
    );

    s.stop(`Cron job "${name}" created ✓`);

    const job = await findExistingJob(name);
    if (job) {
      note(
        [
          `Job ID:    ${job.id}`,
          `Name:      ${job.name}`,
          `Schedule:  every ${every}`,
          `Trigger:   POST http://localhost:${port}/internal/sync-now`,
          "",
          "Manage with:",
          `  openclaw cron list`,
          `  openclaw cron runs`,
          `  openclaw cron disable ${job.id}`,
          `  openclaw cron edit ${job.id} --every 15m`,
        ].join("\n"),
        "DB Sync Cron Job"
      );
    }
  } catch (err) {
    s.stop(`Cron job setup failed — ${err.message}`);
    log.warn(
      [
        "You can create it manually later:",
        `  docker exec -it ${CONTAINER_NAME} su openclaw -c \\`,
        `    "openclaw cron add --name ${name} --every 5m \\`,
        `      --message 'curl -s -X POST http://localhost:${port}/internal/sync-now' \\`,
        `      --no-deliver --light-context --session isolated"`,
      ].join("\n")
    );
  }
}
