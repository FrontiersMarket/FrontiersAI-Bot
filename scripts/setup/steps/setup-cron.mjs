import { select, log, spinner, note } from "@clack/prompts";
import { guardCancel } from "../lib/utils.mjs";
import { execFileAsync } from "../lib/utils.mjs";
import { CONTAINER_NAME } from "../lib/constants.mjs";

const JOB_NAME = "bq-sync";

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
async function findExistingJob() {
  try {
    const { stdout } = await openclawCmd("cron list --json");
    const data = JSON.parse(stdout);
    return data.jobs?.find((j) => j.name === JOB_NAME) ?? null;
  } catch {
    return null;
  }
}

/**
 * Configure the OpenClaw cron job that triggers BigQuery → SQLite syncs.
 */
export async function setupSyncCron(vars) {
  const port = vars.PORT ?? "8080";
  const existing = await findExistingJob();

  if (existing) {
    const state = existing.disabled ? "disabled" : "enabled";
    log.info(
      `Cron job "${JOB_NAME}" already exists (${state}, every ${existing.every ?? existing.cron ?? "?"}).`
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
      // Remove existing job and recreate with new interval
      await openclawCmd(`cron rm ${existing.id}`);
    }
  }

  const every = guardCancel(
    await select({
      message: "How often should the DB sync with BigQuery?",
      options: INTERVAL_OPTIONS,
    })
  );

  const s = spinner();
  s.start(`Creating OpenClaw cron job "${JOB_NAME}" (every ${every})…`);

  try {
    // Build the command the cron job will trigger.
    // The /internal/sync-now endpoint is localhost-only — no credentials needed.
    const triggerCmd = `curl -s -X POST http://localhost:${port}/internal/sync-now`;

    await openclawCmd(
      `cron add --name "${JOB_NAME}" --every ${every} --message "${triggerCmd}" --no-deliver --light-context --session isolated`
    );

    s.stop(`Cron job "${JOB_NAME}" created ✓`);

    // Verify it shows up
    const job = await findExistingJob();
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
        "BQ Sync Cron Job"
      );
    }
  } catch (err) {
    s.stop(`Cron job setup failed — ${err.message}`);
    log.warn(
      [
        "You can create it manually later:",
        `  docker exec -it ${CONTAINER_NAME} su openclaw -c \\`,
        `    "openclaw cron add --name ${JOB_NAME} --every 5m \\`,
        `      --message 'curl -s -X POST http://localhost:${port}/internal/sync-now' \\`,
        `      --no-deliver --light-context --session isolated"`,
      ].join("\n")
    );
  }
}
