import { text, select, log, spinner } from "@clack/prompts";
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { WORKSPACE_SRC, WORKSPACE_DEST, SCOPE_FILE, ENV_PATH, RESOURCES_SRC } from "../lib/constants.mjs";
import { guardCancel } from "../lib/utils.mjs";
import { parseEnvFile } from "../lib/env-file.mjs";

const SCOPE_PATH = resolve(WORKSPACE_SRC, SCOPE_FILE);
const SCOPE_DEST = resolve(WORKSPACE_DEST, SCOPE_FILE);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENTS_FILE = "AGENTS.md";
const SCOPE_MARKER_START = "<!-- SCOPE:START -->";
const SCOPE_MARKER_END = "<!-- SCOPE:END -->";

const SKILL_CUSTOM_DB_DIR = resolve(WORKSPACE_DEST, "skills", "local-db");

// ── AGENTS.md injection ───────────────────────────────────────────────────────

function injectScopeIntoAgents(block, agentsPath) {
  if (!existsSync(agentsPath)) return;

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

function buildBigQueryScopeBlock(ranchUuid, dataset) {
  return [
    SCOPE_MARKER_START,
    "## Active Scope",
    "",
    `mode: bigquery`,
    `ranch_uuid: ${ranchUuid}`,
    `gbq_dataset: ${dataset}`,
    "",
    "*(Auto-updated by `pnpm setup:local` — do not edit manually)*",
    SCOPE_MARKER_END,
  ].join("\n");
}

function buildCustomDbScopeBlock(dbType, dbName, schemaNote) {
  return [
    SCOPE_MARKER_START,
    "## Active Scope",
    "",
    `mode: custom`,
    `db_type: ${dbType}`,
    `db_name: ${dbName}`,
    `schema: ${schemaNote}`,
    "",
    "*(Auto-updated by `pnpm setup:local` — do not edit manually)*",
    SCOPE_MARKER_END,
  ].join("\n");
}

// ── SCOPE.md builders ─────────────────────────────────────────────────────────

function buildBigQueryScopeContent(ranchUuid, dataset) {
  return [
    "# SCOPE.md — Active Data Scope",
    "",
    "mode: bigquery",
    `ranch_uuid: ${ranchUuid}`,
    `gbq_dataset: ${dataset}`,
    "",
    "# To scope to a different ranch, change ranch_uuid and re-run pnpm setup:local",
    "",
  ].join("\n");
}

function buildCustomDbScopeContent(dbType, dbName, schemaNote) {
  return [
    "# SCOPE.md — Active Data Scope",
    "",
    "mode: custom",
    `db_type: ${dbType}`,
    `db_name: ${dbName}`,
    `schema: ${schemaNote}`,
    "",
    "# To change the data source, re-run pnpm setup:local",
    "",
  ].join("\n");
}

// ── Custom DB SKILL.md ────────────────────────────────────────────────────────

/**
 * Write a placeholder SKILL.md for custom DB mode.
 * This is shown before the first sync runs. After the first sync,
 * db-sync-custom.js overwrites it with the real table list and schema.
 */
function writeCustomDbSkillMd(dbType, dbName, schemaNote) {
  mkdirSync(SKILL_CUSTOM_DB_DIR, { recursive: true });
  const skillPath = resolve(SKILL_CUSTOM_DB_DIR, "SKILL.md");

  const content = [
    "---",
    "name: local-db",
    "description: >",
    `  Query the local SQLite replica of the remote ${dbType.toUpperCase()} database \`${dbName}\`.`,
    "  Use for ALL data queries. Data is synced on a recurring schedule.",
    "---",
    "",
    `# Local DB — \`${dbName}\` (${dbType.toUpperCase()})`,
    "",
    "> **Initial sync in progress.** This file will be automatically updated with the",
    "> full table list once the first sync completes.",
    "",
    "## Execution",
    "",
    "```bash",
    'sqlite3 -json /data/ranch_data.db "SQL HERE"',
    "```",
    "",
    "## Schema Discovery (until first sync completes)",
    "",
    "```bash",
    "# List all tables",
    'sqlite3 /data/ranch_data.db ".tables"',
    "",
    "# Inspect a specific table",
    'sqlite3 /data/ranch_data.db ".schema <tablename>"',
    "```",
    "",
    ...(schemaNote !== "auto" ? [`Schema definition file: \`${schemaNote}\``] : []),
    "",
  ].join("\n");

  writeFileSync(skillPath, content, "utf8");
}

// ── re-inject on workspace sync ───────────────────────────────────────────────

/**
 * Re-read SCOPE.md and re-inject scope into the dest AGENTS.md.
 * Called after workspace sync to prevent the sync from overwriting the injection.
 */
export function reInjectScope() {
  if (!existsSync(SCOPE_PATH)) return;

  const raw = readFileSync(SCOPE_PATH, "utf8");
  const modeMatch = raw.match(/^mode:\s*(\S+)/m);
  const mode = modeMatch?.[1] ?? "bigquery";
  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);

  if (mode === "custom") {
    const dbTypeMatch = raw.match(/^db_type:\s*(\S+)/m);
    const dbNameMatch = raw.match(/^db_name:\s*(\S+)/m);
    const schemaMatch = raw.match(/^schema:\s*(.+)/m);
    const dbType = dbTypeMatch?.[1] ?? "postgres";
    const dbName = dbNameMatch?.[1] ?? "unknown";
    const schemaNote = schemaMatch?.[1]?.trim() ?? "auto";
    const block = buildCustomDbScopeBlock(dbType, dbName, schemaNote);
    injectScopeIntoAgents(block, agentsDest);
  } else {
    const uuidMatch = raw.match(/^ranch_uuid:\s*(\S+)/m);
    if (!uuidMatch) return;
    const ranchUuid = uuidMatch[1];
    const datasetMatch = raw.match(/^gbq_dataset:\s*(\S+)/m);
    const dataset = datasetMatch?.[1] ?? "public";
    const block = buildBigQueryScopeBlock(ranchUuid, dataset);
    injectScopeIntoAgents(block, agentsDest);
  }
}

// ── .env helpers ──────────────────────────────────────────────────────────────

function writeEnvVar(key, value) {
  if (!existsSync(ENV_PATH)) return;
  let content = readFileSync(ENV_PATH, "utf8");
  const re = new RegExp(`^${key}=.*`, "m");
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, content, "utf8");
}

function writeEnvSection(vars, comment) {
  if (!existsSync(ENV_PATH)) return;
  let content = readFileSync(ENV_PATH, "utf8");

  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*`, "m");
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
  }
  writeFileSync(ENV_PATH, content, "utf8");
}

// ── BigQuery flow ─────────────────────────────────────────────────────────────

async function configureBigQuery(existing) {
  const existingUuid = existing.RANCH_UUID?.trim() ?? "";
  const existingDataset = existing.GBQ_DATASET?.trim() ?? "public";

  const ranchUuid = guardCancel(
    await text({
      message: "Ranch UUID this bot is scoped to",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      initialValue: existingUuid,
      validate: (v) => {
        if (!v?.trim()) return "Ranch UUID is required — this bot must always be scoped to a ranch";
        if (!UUID_RE.test(v.trim())) return "Must be a valid UUID  (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
      },
    })
  );

  const gbqDataset = guardCancel(
    await text({
      message: "BigQuery dataset to pull data from",
      placeholder: "public",
      initialValue: existingDataset,
      validate: (v) => {
        if (!v?.trim()) return "Dataset name is required";
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.trim()))
          return "Must be a valid BigQuery dataset name (letters, numbers, underscores)";
      },
    })
  );

  const uuid = ranchUuid.trim().toLowerCase();
  const dataset = gbqDataset.trim();

  return { uuid, dataset };
}

// ── Encrypted key detection ───────────────────────────────────────────────────

/**
 * Returns true if the private key file appears to be passphrase-protected.
 * Handles both traditional PEM (contains "ENCRYPTED") and the OpenSSH format
 * (decodes the binary header and inspects the kdf_name field).
 */
function isKeyEncrypted(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    // Traditional PEM: "BEGIN ENCRYPTED PRIVATE KEY" or "Proc-Type: 4,ENCRYPTED"
    if (content.includes("ENCRYPTED")) return true;
    // OpenSSH format: parse kdf_name from the binary header
    if (content.includes("BEGIN OPENSSH PRIVATE KEY")) {
      const b64 = content.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      const buf = Buffer.from(b64, "base64");
      // Layout: magic(15) + cipher_name(uint32 len + bytes) + kdf_name(uint32 len + bytes)
      if (buf.length > 24) {
        const cipherLen = buf.readUInt32BE(15);
        const kdfOff = 15 + 4 + cipherLen;
        if (kdfOff + 4 <= buf.length) {
          const kdfLen = buf.readUInt32BE(kdfOff);
          const kdfName = buf.slice(kdfOff + 4, kdfOff + 4 + kdfLen).toString("utf8");
          return kdfName !== "none";
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ── Custom DB flow ────────────────────────────────────────────────────────────

async function configureCustomDb(existing) {
  log.info("Configure SSH connection (leave SSH Host blank to connect directly without a tunnel)");

  const sshHost = guardCancel(
    await text({
      message: "SSH host (optional — blank for direct DB connection)",
      placeholder: "db.example.com",
      initialValue: existing.SSH_HOST?.trim() ?? "",
    })
  );

  let sshPort = existing.SSH_PORT?.trim() ?? "22";
  let sshUser = existing.SSH_USER?.trim() ?? "";
  let sshKeyPath = existing.SSH_PRIVATE_KEY_PATH?.trim() ?? "";

  if (sshHost.trim()) {
    sshPort = guardCancel(
      await text({
        message: "SSH port",
        placeholder: "22",
        initialValue: sshPort,
        validate: (v) => {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port (1–65535)";
        },
      })
    );

    sshUser = guardCancel(
      await text({
        message: "SSH username",
        placeholder: "ubuntu",
        initialValue: sshUser,
        validate: (v) => (!v?.trim() ? "SSH username is required" : undefined),
      })
    );

    sshKeyPath = guardCancel(
      await text({
        message: "Path to SSH private key (leave blank to use SSH_PASSWORD instead)",
        placeholder: "/data/resources/id_rsa",
        initialValue: sshKeyPath,
      })
    );

    if (sshKeyPath.trim() && !sshKeyPath.trim().startsWith("/data/")) {
      // Host-side path — copy to resources/ so it's accessible inside the container
      const hostKeyPath = sshKeyPath.trim();
      if (existsSync(hostKeyPath)) {
        const destName = basename(hostKeyPath);
        mkdirSync(RESOURCES_SRC, { recursive: true });
        copyFileSync(hostKeyPath, resolve(RESOURCES_SRC, destName));
        sshKeyPath = `/data/resources/${destName}`;
        log.info(`SSH key copied to resources/ → container path: ${sshKeyPath}`);
      } else {
        log.warn(`SSH key file not found at ${hostKeyPath} — make sure it is present in resources/ before starting the container`);
      }
    }

    // Detect if the resolved key file is passphrase-protected
    let sshKeyPassphrase = existing.SSH_KEY_PASSPHRASE?.trim() ?? "";
    if (sshKeyPath.trim()) {
      // Resolve to a host-accessible path for the encryption check
      const hostCheckPath = sshKeyPath.trim().startsWith("/data/resources/")
        ? resolve(RESOURCES_SRC, basename(sshKeyPath.trim()))
        : sshKeyPath.trim().startsWith("/data/")
          ? null // inside container only — can't check from host
          : sshKeyPath.trim();

      const keyEncrypted = hostCheckPath ? isKeyEncrypted(hostCheckPath) : false;
      const hadPassphrase = !!existing.SSH_KEY_PASSPHRASE?.trim();

      if (keyEncrypted || hadPassphrase) {
        sshKeyPassphrase = guardCancel(
          await text({
            message: keyEncrypted
              ? "SSH key passphrase  (passphrase-protected key detected)"
              : "SSH key passphrase  (leave blank to remove)",
            initialValue: existing.SSH_KEY_PASSPHRASE?.trim() ?? "",
          })
        );
      }
    }

    if (!sshKeyPath.trim()) {
      const sshPassword = guardCancel(
        await text({
          message: "SSH password (used when no private key is specified)",
          initialValue: existing.SSH_PASSWORD?.trim() ?? "",
        })
      );
      existing._sshPassword = sshPassword.trim();
    }
    existing._sshKeyPassphrase = sshKeyPassphrase;
  }

  log.info("Configure remote database connection");

  const dbType = guardCancel(
    await select({
      message: "Database type",
      options: [
        { value: "postgres", label: "PostgreSQL" },
        { value: "mysql",    label: "MySQL / MariaDB" },
      ],
      initialValue: existing.CUSTOM_DB_TYPE?.trim() || "postgres",
    })
  );

  const defaultPort = dbType === "mysql" ? "3306" : "5432";
  // If connecting via SSH, remote DB host is typically "localhost" (on the SSH server)
  const defaultDbHost = sshHost.trim() ? "localhost" : (existing.CUSTOM_DB_HOST?.trim() ?? "localhost");

  const dbHost = guardCancel(
    await text({
      message: sshHost.trim()
        ? "DB host (relative to SSH server — usually localhost)"
        : "DB host",
      placeholder: "localhost",
      initialValue: defaultDbHost,
      validate: (v) => (!v?.trim() ? "DB host is required" : undefined),
    })
  );

  const dbPort = guardCancel(
    await text({
      message: "DB port",
      placeholder: defaultPort,
      initialValue: existing.CUSTOM_DB_PORT?.trim() || defaultPort,
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port (1–65535)";
      },
    })
  );

  const dbName = guardCancel(
    await text({
      message: "Database name",
      placeholder: "myapp",
      initialValue: existing.CUSTOM_DB_NAME?.trim() ?? "",
      validate: (v) => (!v?.trim() ? "Database name is required" : undefined),
    })
  );

  const dbUser = guardCancel(
    await text({
      message: "DB username",
      placeholder: "readonly_user",
      initialValue: existing.CUSTOM_DB_USER?.trim() ?? "",
    })
  );

  const dbPassword = guardCancel(
    await text({
      message: "DB password",
      initialValue: existing.CUSTOM_DB_PASSWORD?.trim() ?? "",
    })
  );

  log.info("Configure schema");

  const schemaChoice = guardCancel(
    await select({
      message: "How should the bot discover the database schema?",
      options: [
        {
          value: "auto",
          label: "Auto-introspect all tables (recommended for first setup)",
        },
        {
          value: "file",
          label: "Provide a JSON schema file path (for large DBs or filtered tables)",
        },
      ],
      initialValue: existing.CUSTOM_DB_SCHEMA_PATH?.trim() ? "file" : "auto",
    })
  );

  let schemaPath = "";
  if (schemaChoice === "file") {
    schemaPath = guardCancel(
      await text({
        message: "Path to JSON schema file inside the container",
        placeholder: "/data/custom_db_schema.json",
        initialValue: existing.CUSTOM_DB_SCHEMA_PATH?.trim() ?? "/data/custom_db_schema.json",
        validate: (v) => (!v?.trim() ? "Schema file path is required" : undefined),
      })
    );
  }

  return {
    sshHost:         sshHost.trim(),
    sshPort:         sshPort.trim(),
    sshUser:         sshUser.trim(),
    sshKeyPath:      sshKeyPath.trim(),
    sshKeyPassphrase: existing._sshKeyPassphrase ?? "",
    sshPassword:     existing._sshPassword ?? "",
    dbType:          dbType.trim(),
    dbHost:          dbHost.trim(),
    dbPort:          dbPort.trim(),
    dbName:          dbName.trim(),
    dbUser:          dbUser.trim(),
    dbPassword:      dbPassword.trim(),
    schemaPath:      schemaPath.trim(),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function configureBotScope() {
  const existing = parseEnvFile();
  const currentSource = existing.DB_SOURCE?.trim() || "bigquery";

  const dataSource = guardCancel(
    await select({
      message: "Local DB data source",
      options: [
        {
          value: "bigquery",
          label: "FM Management  — BigQuery + scoped ranch UUID (Frontiers Market default)",
        },
        {
          value: "custom",
          label: "Custom DB      — connect to any PostgreSQL / MySQL via SSH tunnel or direct",
        },
      ],
      initialValue: currentSource,
    })
  );

  const s = spinner();

  // ── BigQuery path ─────────────────────────────────────────────────────────

  if (dataSource === "bigquery") {
    const { uuid, dataset } = await configureBigQuery(existing);
    const content = buildBigQueryScopeContent(uuid, dataset);

    s.start("Writing SCOPE.md, injecting scope into AGENTS.md, updating .env…");

    writeFileSync(SCOPE_PATH, content, "utf8");
    mkdirSync(WORKSPACE_DEST, { recursive: true });
    writeFileSync(SCOPE_DEST, content, "utf8");

    const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
    injectScopeIntoAgents(buildBigQueryScopeBlock(uuid, dataset), agentsDest);

    writeEnvSection({
      DB_SOURCE:   "bigquery",
      RANCH_UUID:  uuid,
      GBQ_DATASET: dataset,
    });

    s.stop("Scope configured ✓");
    log.success(`BigQuery sync — ranch ${uuid}  (dataset: ${dataset})`);
    return uuid;
  }

  // ── Custom DB path ────────────────────────────────────────────────────────

  const cfg = await configureCustomDb(existing);
  const schemaNote = cfg.schemaPath || "auto";

  s.start("Writing SCOPE.md, injecting scope into AGENTS.md, updating .env, writing SKILL.md…");

  const scopeContent = buildCustomDbScopeContent(cfg.dbType, cfg.dbName, schemaNote);
  writeFileSync(SCOPE_PATH, scopeContent, "utf8");
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  writeFileSync(SCOPE_DEST, scopeContent, "utf8");

  const agentsDest = resolve(WORKSPACE_DEST, AGENTS_FILE);
  injectScopeIntoAgents(buildCustomDbScopeBlock(cfg.dbType, cfg.dbName, schemaNote), agentsDest);

  // Write a custom SKILL.md to the dest workspace
  writeCustomDbSkillMd(cfg.dbType, cfg.dbName, schemaNote);

  // Persist all custom DB config to .env
  const envVars = {
    DB_SOURCE:              "custom",
    CUSTOM_DB_TYPE:         cfg.dbType,
    CUSTOM_DB_HOST:         cfg.dbHost,
    CUSTOM_DB_PORT:         cfg.dbPort,
    CUSTOM_DB_NAME:         cfg.dbName,
    CUSTOM_DB_USER:         cfg.dbUser,
    CUSTOM_DB_PASSWORD:     cfg.dbPassword,
  };
  if (cfg.sshHost)     envVars.SSH_HOST = cfg.sshHost;
  if (cfg.sshPort)     envVars.SSH_PORT = cfg.sshPort;
  if (cfg.sshUser)     envVars.SSH_USER = cfg.sshUser;
  if (cfg.sshKeyPath)  envVars.SSH_PRIVATE_KEY_PATH = cfg.sshKeyPath;
  // Always write SSH_KEY_PASSPHRASE (even if blank) so stale values are cleared
  envVars.SSH_KEY_PASSPHRASE = cfg.sshKeyPassphrase ?? "";
  if (cfg.sshPassword) envVars.SSH_PASSWORD = cfg.sshPassword;
  if (cfg.schemaPath)  envVars.CUSTOM_DB_SCHEMA_PATH = cfg.schemaPath;

  writeEnvSection(envVars);

  s.stop("Custom DB scope configured ✓");
  const connDesc = cfg.sshHost
    ? `${cfg.dbType.toUpperCase()} ${cfg.dbName} via SSH ${cfg.sshHost}`
    : `${cfg.dbType.toUpperCase()} ${cfg.dbName} (direct)`;
  log.success(connDesc);

  return null; // no ranch UUID for custom mode
}
