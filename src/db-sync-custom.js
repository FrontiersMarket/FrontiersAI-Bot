/**
 * db-sync-custom.js — Custom DB (via optional SSH tunnel) → SQLite sync service
 *
 * Connects to a remote PostgreSQL or MySQL database — optionally via an SSH
 * tunnel — pulls user-defined (or auto-introspected) tables, and stores them
 * in a local SQLite database at RANCH_DB_PATH.
 *
 * SSH tunnel is used when SSH_HOST is configured. Without SSH_HOST the module
 * connects to the DB directly.
 *
 * Env vars (all read at sync time, so container restarts pick up changes):
 *
 *   CUSTOM_DB_TYPE          postgres | mysql  (default: postgres)
 *   SSH_HOST                SSH server hostname (optional — omit for direct connect)
 *   SSH_PORT                SSH port            (default: 22)
 *   SSH_USER                SSH username
 *   SSH_PRIVATE_KEY_PATH    Path to PEM private key file  (preferred)
 *   SSH_PRIVATE_KEY         Inline PEM key content         (fallback)
 *   SSH_PASSWORD            SSH password                   (if no key)
 *   CUSTOM_DB_HOST          DB host relative to SSH server (default: localhost)
 *   CUSTOM_DB_PORT          DB port (default: 5432/3306)
 *   CUSTOM_DB_NAME          Database / schema name
 *   CUSTOM_DB_USER          DB username
 *   CUSTOM_DB_PASSWORD      DB password
 *   CUSTOM_DB_SCHEMA_PATH   Path to JSON schema file (optional — auto-introspects if absent)
 *   DB_SYNC_INTERVAL_MS     Sync interval in ms (default: 300000)
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const SYNC_INTERVAL_MS = parseInt(
  process.env.DB_SYNC_INTERVAL_MS ?? "300000",
  10
);

// ── Sync state (same shape as db-sync.js) ─────────────────────────────────────

export const syncState = {
  running: false,
  initialized: false,
  lastSyncAt: null,
  lastSyncError: null,
  nextSyncAt: null,
  tables: {}, // { tableName: { rows, syncedAt, error } }
};

let syncTimer = null;

// ── SSH tunnel ────────────────────────────────────────────────────────────────

/**
 * Resolve the SSH private key from a file path or inline env var.
 * Returns null if neither is configured.
 */
function resolvePrivateKey() {
  const keyPath = process.env.SSH_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    try {
      return fs.readFileSync(keyPath, "utf8");
    } catch (err) {
      console.warn(`[db-sync-custom] could not read SSH key at ${keyPath}: ${err.message}`);
    }
  }
  const inlineKey = process.env.SSH_PRIVATE_KEY?.trim();
  if (inlineKey) return inlineKey;
  return null;
}

/**
 * Open an SSH tunnel that forwards a local ephemeral port to the remote DB.
 * Returns { sshConn, server, localPort } — caller is responsible for cleanup.
 *
 * If SSH_HOST is not set, returns null (direct connection mode).
 */
async function createTunnel() {
  const sshHost = process.env.SSH_HOST?.trim();
  if (!sshHost) return null; // direct connection

  const sshPort = parseInt(process.env.SSH_PORT ?? "22", 10);
  const sshUser = process.env.SSH_USER?.trim();
  const remoteHost = process.env.CUSTOM_DB_HOST?.trim() || "localhost";
  const dbType = process.env.CUSTOM_DB_TYPE?.trim().toLowerCase() || "postgres";
  const remotePort = parseInt(
    process.env.CUSTOM_DB_PORT ?? (dbType === "mysql" ? "3306" : "5432"),
    10
  );

  const { Client: SSH2Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new SSH2Client();
    let localPort = null;
    let sshReady = false;
    let settled = false;

    function tryResolve() {
      if (settled || localPort === null || !sshReady) return;
      settled = true;
      resolve({ conn, server, localPort });
    }

    function doReject(err) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    const server = net.createServer((socket) => {
      conn.forwardOut(
        "127.0.0.1",
        0,
        remoteHost,
        remotePort,
        (err, stream) => {
          if (err) {
            console.warn(`[db-sync-custom] SSH forward error: ${err.message}`);
            socket.destroy();
            return;
          }
          socket.pipe(stream);
          stream.pipe(socket);
          socket.on("error", () => stream.destroy());
          stream.on("error", () => socket.destroy());
          stream.on("close", () => socket.destroy());
          socket.on("close", () => stream.destroy());
        }
      );
    });

    server.listen(0, "127.0.0.1", () => {
      localPort = server.address().port;
      tryResolve();
    });

    server.on("error", (err) => doReject(err));

    conn.on("ready", () => {
      sshReady = true;
      tryResolve();
    });

    conn.on("error", (err) => {
      server.close();
      doReject(new Error(`SSH connection to ${sshHost}:${sshPort} failed: ${err.message}`));
    });

    const connectCfg = {
      host: sshHost,
      port: sshPort,
      username: sshUser,
      readyTimeout: 15000,
    };

    const privateKey = resolvePrivateKey();
    if (privateKey) {
      connectCfg.privateKey = privateKey;
      const passphrase = process.env.SSH_KEY_PASSPHRASE?.trim();
      if (passphrase) connectCfg.passphrase = passphrase;
    } else {
      const pw = process.env.SSH_PASSWORD?.trim();
      if (pw) connectCfg.password = pw;
    }

    conn.connect(connectCfg);
  });
}

function closeTunnel(tunnel) {
  if (!tunnel) return;
  try { tunnel.server.close(); } catch {}
  try { tunnel.conn.end(); } catch {}
}

// ── Type mapping ──────────────────────────────────────────────────────────────

function pgTypeToSQLite(pgType) {
  const t = pgType.toLowerCase().split("(")[0].trim();
  switch (t) {
    case "integer": case "int": case "int2": case "int4": case "int8":
    case "bigint": case "smallint": case "serial": case "bigserial":
      return "INTEGER";
    case "float4": case "float8": case "real": case "double precision":
    case "numeric": case "decimal": case "money":
      return "REAL";
    case "boolean": case "bool":
      return "INTEGER"; // 0/1
    case "json": case "jsonb":
      return "TEXT";
    case "bytea":
      return "BLOB";
    case "timestamp": case "timestamptz": case "timestamp without time zone":
    case "timestamp with time zone": case "date": case "time":
    case "time without time zone": case "time with time zone": case "timetz":
    case "interval":
      return "TEXT";
    case "uuid":
      return "TEXT";
    case "array":
      return "TEXT";
    default:
      // varchar, text, char, name, citext, enum, etc.
      if (t.startsWith("character") || t.startsWith("varchar") || t.startsWith("_")) {
        return "TEXT";
      }
      return "TEXT";
  }
}

function mysqlTypeToSQLite(mysqlType) {
  const t = mysqlType.toLowerCase().split("(")[0].trim();
  switch (t) {
    case "tinyint": case "smallint": case "mediumint": case "int": case "bigint":
    case "integer":
      return "INTEGER";
    case "float": case "double": case "decimal": case "numeric": case "real":
    case "double precision":
      return "REAL";
    case "tinyblob": case "blob": case "mediumblob": case "longblob":
    case "binary": case "varbinary":
      return "BLOB";
    case "json":
      return "TEXT";
    case "datetime": case "timestamp": case "date": case "time": case "year":
      return "TEXT";
    default:
      // varchar, text, char, longtext, mediumtext, tinytext, enum, set, etc.
      return "TEXT";
  }
}

function serializeCustomValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString("base64");
  if (typeof val === "object") return JSON.stringify(val);
  if (typeof val === "boolean") return val ? 1 : 0;
  return val;
}

// ── Schema loading ────────────────────────────────────────────────────────────

/**
 * Schema file format (CUSTOM_DB_SCHEMA_PATH):
 * {
 *   "tables": [
 *     {
 *       "name": "users",
 *       "columns": ["id", "email"],   // optional — omit to sync all columns
 *       "filter": "deleted_at IS NULL" // optional WHERE clause
 *     }
 *   ]
 * }
 */
function loadSchemaFile() {
  const schemaPath = process.env.CUSTOM_DB_SCHEMA_PATH?.trim();
  if (!schemaPath) return null;
  if (!fs.existsSync(schemaPath)) {
    console.warn(`[db-sync-custom] schema file not found at ${schemaPath} — auto-introspecting`);
    return null;
  }
  try {
    const raw = fs.readFileSync(schemaPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tables)) {
      console.warn("[db-sync-custom] invalid schema file — expected { tables: [...] }, auto-introspecting");
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[db-sync-custom] could not parse schema file: ${err.message} — auto-introspecting`);
    return null;
  }
}

// ── DB introspection ──────────────────────────────────────────────────────────

async function introspectPostgres(client) {
  // Single query — avoids N+1 round-trips over the SSH tunnel
  const { rows } = await client.query(`
    SELECT t.table_name, c.column_name, c.data_type
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
  `);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, []);
    map.get(r.table_name).push({ name: r.column_name, type: r.data_type });
  }
  return [...map.entries()].map(([name, columns]) => ({ name, columns }));
}

async function introspectMySQL(conn) {
  // Single query — avoids N+1 round-trips over the SSH tunnel
  const [rows] = await conn.query(`
    SELECT t.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type
    FROM INFORMATION_SCHEMA.TABLES t
    JOIN INFORMATION_SCHEMA.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
    WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
    ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
  `);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, []);
    map.get(r.table_name).push({ name: r.column_name, type: r.data_type });
  }
  return [...map.entries()].map(([name, columns]) => ({ name, columns }));
}

// ── Per-table sync ────────────────────────────────────────────────────────────

const STREAM_BATCH = 500; // rows buffered in memory before a SQLite flush

/** Resolve columns for a table from user config or introspected metadata. */
function resolveColumns(tableConfig, introspectedCols) {
  if (tableConfig.columns?.length) {
    const available = new Map((introspectedCols || []).map((c) => [c.name, c.type]));
    const cols = tableConfig.columns
      .filter((c) => available.has(c))
      .map((c) => ({ name: c, type: available.get(c) ?? "text" }));
    if (cols.length === 0) {
      console.warn(`[db-sync-custom] ${tableConfig.name}: none of the specified columns exist, skipping`);
    }
    return cols;
  }
  return introspectedCols || [];
}

/**
 * Sync one PostgreSQL table using pg's row-streaming API.
 * Rows are never all held in memory at once — flushed to SQLite every STREAM_BATCH rows.
 */
async function syncOneTablePostgres(sqliteDb, pgClient, tableConfig, introspectedCols) {
  const { name, filter, limit } = tableConfig;

  const cols = resolveColumns(tableConfig, introspectedCols);
  if (cols.length === 0) return 0;

  // Ensure SQLite table exists
  const colDefs = cols.map((c) => `"${c.name}" ${pgTypeToSQLite(c.type)}`).join(", ");
  sqliteDb.prepare(`CREATE TABLE IF NOT EXISTS "${name}" (${colDefs})`).run();

  const colList = cols.map((c) => `"${c.name}"`).join(", ");
  let sql = `SELECT ${colList} FROM "${name}"`;
  if (filter) sql += ` WHERE ${filter}`;
  if (limit)  sql += ` LIMIT ${parseInt(limit, 10)}`;

  const insertSql = `INSERT INTO "${name}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;

  // Clear old data before streaming in new rows
  sqliteDb.prepare(`DELETE FROM "${name}"`).run();
  const stmt = sqliteDb.prepare(insertSql);

  const flushBatch = sqliteDb.transaction((batch) => {
    for (const row of batch) stmt.run(cols.map((c) => serializeCustomValue(row[c.name])));
  });

  let rowCount = 0;
  let batch = [];

  const pg = await import("pg");
  const Query = pg.default?.Query ?? pg.Query;

  await new Promise((resolve, reject) => {
    const q = pgClient.query(new Query(sql));
    q.on("row", (row) => {
      batch.push(row);
      if (batch.length >= STREAM_BATCH) {
        flushBatch(batch);
        rowCount += batch.length;
        batch = [];
      }
    });
    q.on("end", () => {
      if (batch.length > 0) {
        flushBatch(batch);
        rowCount += batch.length;
        batch = [];
      }
      resolve();
    });
    q.on("error", reject);
  });

  return rowCount;
}

/**
 * Sync one MySQL table using LIMIT/OFFSET pagination.
 * Each page is fetched and written to SQLite before the next is fetched.
 */
async function syncOneTableMySQL(sqliteDb, mysqlConn, tableConfig, introspectedCols) {
  const { name, filter, limit } = tableConfig;

  const cols = resolveColumns(tableConfig, introspectedCols);
  if (cols.length === 0) return 0;

  const colDefs = cols.map((c) => `"${c.name}" ${mysqlTypeToSQLite(c.type)}`).join(", ");
  sqliteDb.prepare(`CREATE TABLE IF NOT EXISTS "${name}" (${colDefs})`).run();

  const colList = cols.map((c) => `\`${c.name}\``).join(", ");
  const baseSql = `SELECT ${colList} FROM \`${name}\`${filter ? ` WHERE ${filter}` : ""}`;

  const insertSql = `INSERT INTO "${name}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;

  sqliteDb.prepare(`DELETE FROM "${name}"`).run();
  const stmt = sqliteDb.prepare(insertSql);

  const flushBatch = sqliteDb.transaction((batch) => {
    for (const row of batch) stmt.run(cols.map((c) => serializeCustomValue(row[c.name])));
  });

  const PAGE = STREAM_BATCH;
  let offset = 0;
  let totalRows = 0;
  const hardLimit = limit ? parseInt(limit, 10) : Infinity;

  while (true) {
    const pageLimit = Math.min(PAGE, hardLimit - totalRows);
    const [rows] = await mysqlConn.query(`${baseSql} LIMIT ${pageLimit} OFFSET ${offset}`);
    if (rows.length === 0) break;
    flushBatch(rows);
    totalRows += rows.length;
    offset += rows.length;
    if (rows.length < pageLimit || totalRows >= hardLimit) break;
  }

  return totalRows;
}

// ── Dynamic SKILL.md generation ───────────────────────────────────────────────

/**
 * Write (or overwrite) the local-db SKILL.md with the current table list.
 * Called after every successful sync so the bot always has up-to-date schema info.
 *
 * Writes to ${OPENCLAW_WORKSPACE_DIR}/skills/local-db/SKILL.md.
 * Inside the container this is /data/workspace/skills/local-db/SKILL.md.
 */
function writeSkillMd() {
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR?.trim();
  if (!workspaceDir) return;

  const dbType   = process.env.CUSTOM_DB_TYPE?.trim().toLowerCase() || "postgres";
  const dbName   = process.env.CUSTOM_DB_NAME?.trim() || "unknown";
  const sshHost  = process.env.SSH_HOST?.trim();
  const schemaPath = process.env.CUSTOM_DB_SCHEMA_PATH?.trim();

  const syncedAt = syncState.lastSyncAt ?? new Date().toISOString();
  const connDesc = sshHost ? `via SSH tunnel to \`${sshHost}\`` : "direct connection";

  // Build table list — sort alphabetically, errors last
  const ok  = Object.entries(syncState.tables).filter(([, v]) => !v.error).sort(([a], [b]) => a.localeCompare(b));
  const err = Object.entries(syncState.tables).filter(([, v]) =>  v.error).sort(([a], [b]) => a.localeCompare(b));

  const tableRows = [
    ...ok.map(([name, v]) => `| \`${name}\` | ${Number(v.rows).toLocaleString()} |`),
    ...err.map(([name, v]) => `| \`${name}\` | *(error: ${v.error?.slice(0, 60)})* |`),
  ].join("\n") || "| *(no tables synced)* | — |";

  const schemaHint = schemaPath
    ? [
        `Schema definition: \`${schemaPath}\``,
        "",
        "Read that file before writing queries to understand available columns.",
      ].join("\n")
    : [
        "No schema file configured — introspect columns as needed:",
        "",
        "```bash",
        "# List columns for a specific table",
        'sqlite3 /data/ranch_data.db ".schema <tablename>"',
        "```",
      ].join("\n");

  const content = [
    "---",
    "name: local-db",
    "description: >",
    `  Query the local SQLite replica of the remote ${dbType.toUpperCase()} database \`${dbName}\`.`,
    "  Use for ALL data queries. Data is synced automatically on a recurring schedule.",
    "---",
    "",
    `# Local DB — \`${dbName}\` (${dbType.toUpperCase()})`,
    "",
    `Connected ${connDesc}. Last synced: \`${syncedAt}\``,
    "",
    "## Execution",
    "",
    "```bash",
    'sqlite3 -json /data/ranch_data.db "SQL HERE"',
    "```",
    "",
    "Always use `-json` for structured output. For large results pipe through `head -c 100000`.",
    "",
    "For multi-line SQL:",
    "",
    "```bash",
    "sqlite3 -json /data/ranch_data.db \"$(cat <<'SQL'",
    "SELECT * FROM my_table LIMIT 10",
    "SQL",
    ")\"",
    "```",
    "",
    `## Available Tables (${ok.length} synced${err.length > 0 ? `, ${err.length} failed` : ""})`,
    "",
    "| Table | Rows |",
    "|-------|------|",
    tableRows,
    "",
    "## Column Schema",
    "",
    schemaHint,
    "",
    "## SQLite Notes",
    "",
    "- Use double quotes for SQL reserved words: `\"order\"`, `\"group\"`, `\"user\"`",
    "- BOOLEAN → INTEGER (0 = false, 1 = true)",
    "- TIMESTAMP / DATETIME → ISO 8601 TEXT strings",
    "- JSON columns → TEXT; use `json_extract(col, '$.key')` to query",
    "- Arrays → JSON TEXT",
    "",
    "## Check Sync Status",
    "",
    "```sql",
    "SELECT table_name, last_sync_at, row_count, error",
    "FROM _sync_meta",
    "ORDER BY last_sync_at DESC",
    "```",
    "",
  ].join("\n");

  try {
    const skillDir = path.join(workspaceDir, "skills", "local-db");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
    console.log(`[db-sync-custom] SKILL.md updated — ${ok.length} tables listed`);
  } catch (err) {
    console.warn(`[db-sync-custom] could not write SKILL.md: ${err.message}`);
  }
}

// ── _sync_meta ────────────────────────────────────────────────────────────────

function ensureSyncMeta(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS _sync_meta (
      table_name TEXT PRIMARY KEY,
      last_sync_at TEXT,
      row_count INTEGER,
      error TEXT
    )
  `).run();
}

// ── Main sync logic ───────────────────────────────────────────────────────────

export async function runSync(_ranchUuid, dbPath) {
  if (syncState.running) {
    console.log("[db-sync-custom] sync already in progress, skipping");
    return;
  }

  const dbType = process.env.CUSTOM_DB_TYPE?.trim().toLowerCase() || "postgres";
  const dbName = process.env.CUSTOM_DB_NAME?.trim();
  const dbUser = process.env.CUSTOM_DB_USER?.trim();
  const dbPassword = process.env.CUSTOM_DB_PASSWORD?.trim() ?? "";
  const dbHost = process.env.CUSTOM_DB_HOST?.trim() || "localhost";
  const dbPort = parseInt(
    process.env.CUSTOM_DB_PORT ?? (dbType === "mysql" ? "3306" : "5432"),
    10
  );

  if (!dbName) {
    console.error("[db-sync-custom] CUSTOM_DB_NAME not configured — aborting sync");
    syncState.lastSyncError = "CUSTOM_DB_NAME not configured";
    return;
  }

  syncState.running = true;
  syncState.lastSyncError = null;
  const syncStart = Date.now();
  const startedAt = new Date().toISOString();
  console.log(`[db-sync-custom] ── starting sync ───────────────────────────────`);
  console.log(`[db-sync-custom]    type=${dbType}  db=${dbName}`);

  let tunnel = null;
  let pgClient = null;
  let mysqlConn = null;
  let sqliteDb = null;

  try {
    // 1. Open SSH tunnel if SSH_HOST is set
    const sshHostEnv = process.env.SSH_HOST?.trim();
    if (sshHostEnv) {
      console.log(`[db-sync-custom] opening SSH tunnel → ${sshHostEnv}:${process.env.SSH_PORT ?? 22}…`);
    }
    tunnel = await createTunnel();
    if (tunnel) {
      console.log(`[db-sync-custom] SSH tunnel ready (local port ${tunnel.localPort})`);
    }
    const connectHost = tunnel ? "127.0.0.1" : dbHost;
    const connectPort = tunnel ? tunnel.localPort : dbPort;

    // 2. Connect to remote DB
    console.log(`[db-sync-custom] connecting to ${dbType.toUpperCase()} at ${connectHost}:${connectPort}…`);
    let introspectedTables = [];
    const schemaFile = loadSchemaFile();

    if (dbType === "mysql") {
      const mysql = await import("mysql2/promise");
      mysqlConn = await mysql.createConnection({
        host: connectHost,
        port: connectPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
        connectTimeout: 15000,
      });
      console.log(`[db-sync-custom] connected to MySQL`);

      if (!schemaFile) {
        console.log("[db-sync-custom] introspecting MySQL schema…");
        introspectedTables = await introspectMySQL(mysqlConn);
        console.log(`[db-sync-custom] found ${introspectedTables.length} tables`);
      }
    } else {
      const pg = await import("pg");
      const PgClient = pg.default?.Client ?? pg.Client;
      pgClient = new PgClient({
        host: connectHost,
        port: connectPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
        connectionTimeoutMillis: 15000,
        ssl: false,
      });
      // Prevent unhandled 'error' events from crashing the process if the
      // connection drops mid-sync (e.g. SSH tunnel reset). Errors surface
      // naturally as rejected promises from query() calls.
      pgClient.on("error", (err) => {
        console.warn(`[db-sync-custom] pg client error (connection lost?): ${err.message}`);
      });
      await pgClient.connect();
      console.log(`[db-sync-custom] connected to PostgreSQL`);

      if (!schemaFile) {
        console.log("[db-sync-custom] introspecting PostgreSQL schema…");
        introspectedTables = await introspectPostgres(pgClient);
        console.log(`[db-sync-custom] found ${introspectedTables.length} tables`);
      }
    }

    // 3. Build table list from schema file or introspection
    let tablesToSync;
    if (schemaFile) {
      tablesToSync = schemaFile.tables.map((t) => ({ ...t }));
      console.log(`[db-sync-custom] using schema file — ${tablesToSync.length} tables defined`);
    } else {
      tablesToSync = introspectedTables.map((t) => ({ name: t.name, _introspected: t.columns }));
    }

    const total = tablesToSync.length;
    console.log(`[db-sync-custom] ── syncing ${total} table${total !== 1 ? "s" : ""} ─────────────────────────`);

    // 4. Open SQLite
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.pragma("synchronous = NORMAL");
    ensureSyncMeta(sqliteDb);

    // 5. Sync each table
    let tablesDone = 0;
    let tablesOk = 0;
    let tablesErr = 0;
    let totalRows = 0;

    for (const tableConfig of tablesToSync) {
      const { name } = tableConfig;
      tablesDone++;
      const prefix = `[db-sync-custom] [${tablesDone}/${total}]`;

      // Resolve introspected columns for this table
      let introspectedCols = tableConfig._introspected ?? null;
      if (!introspectedCols && !tableConfig.columns) {
        // Need to introspect this specific table (schema file provided but no columns specified)
        try {
          if (dbType === "mysql") {
            const [colRows] = await mysqlConn.query(
              `SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type
               FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
               ORDER BY ORDINAL_POSITION`,
              [name]
            );
            introspectedCols = colRows.map((c) => ({ name: c.column_name, type: c.data_type }));
          } else {
            const { rows: colRows } = await pgClient.query(
              `SELECT column_name, data_type
               FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = $1
               ORDER BY ordinal_position`,
              [name]
            );
            introspectedCols = colRows.map((c) => ({ name: c.column_name, type: c.data_type }));
          }
        } catch (err) {
          console.warn(`${prefix} ${name}: failed to introspect columns — ${err.message}`);
        }
      }

      console.log(`${prefix} pulling "${name}"…`);
      const tableStart = Date.now();

      try {
        let rowCount;
        if (dbType === "mysql") {
          rowCount = await syncOneTableMySQL(sqliteDb, mysqlConn, tableConfig, introspectedCols);
        } else {
          rowCount = await syncOneTablePostgres(sqliteDb, pgClient, tableConfig, introspectedCols);
        }
        const ms = Date.now() - tableStart;
        console.log(`${prefix} ✓ "${name}" — ${rowCount.toLocaleString()} rows (${ms}ms)`);

        sqliteDb.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, last_sync_at, row_count, error)
          VALUES (?, ?, ?, NULL)
        `).run(name, new Date().toISOString(), rowCount);

        syncState.tables[name] = {
          rows: rowCount,
          syncedAt: new Date().toISOString(),
          error: null,
        };
        tablesOk++;
        totalRows += rowCount;
      } catch (err) {
        const msg = err.message || String(err);
        const ms = Date.now() - tableStart;
        console.warn(`${prefix} ✗ "${name}" — ${msg} (${ms}ms)`);

        sqliteDb.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, last_sync_at, row_count, error)
          VALUES (?, ?, 0, ?)
        `).run(name, new Date().toISOString(), msg.slice(0, 500));

        syncState.tables[name] = { rows: 0, syncedAt: new Date().toISOString(), error: msg };
        tablesErr++;
      }
    }

    const totalMs = Date.now() - syncStart;
    syncState.lastSyncAt = new Date().toISOString();
    console.log(`[db-sync-custom] ── sync complete ────────────────────────────────`);
    console.log(`[db-sync-custom]    ${tablesOk}/${total} tables OK  |  ${totalRows.toLocaleString()} total rows  |  ${tablesErr} errors  |  ${(totalMs / 1000).toFixed(1)}s`);
    writeSkillMd();
  } catch (err) {
    syncState.lastSyncError = err.message || String(err);
    console.error(`[db-sync-custom] fatal sync error: ${syncState.lastSyncError}`);
  } finally {
    if (pgClient) { try { await pgClient.end(); } catch {} }
    if (mysqlConn) { try { await mysqlConn.end(); } catch {} }
    if (sqliteDb) { try { sqliteDb.close(); } catch {} }
    closeTunnel(tunnel);
    syncState.running = false;
    syncState.nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Initialize the custom DB sync service. Runs an immediate sync then schedules
 * recurring syncs at SYNC_INTERVAL_MS intervals.
 *
 * The ranchUuid param is unused — kept for interface parity with db-sync.js.
 */
export function initSync(_ranchUuid, dbPath) {
  const dbName = process.env.CUSTOM_DB_NAME?.trim();
  if (!dbName) {
    console.warn("[db-sync-custom] CUSTOM_DB_NAME not set — sync service disabled");
    return;
  }

  syncState.initialized = true;

  const dbType = process.env.CUSTOM_DB_TYPE?.trim().toLowerCase() || "postgres";
  const sshHost = process.env.SSH_HOST?.trim();
  console.log(
    `[db-sync-custom] initialized — type=${dbType} db=${dbName}` +
      (sshHost ? ` via SSH ${sshHost}` : " (direct connect)")
  );
  console.log(`[db-sync-custom] sync interval: ${SYNC_INTERVAL_MS / 1000}s`);

  // Run first sync immediately
  runSync(null, dbPath).catch((err) => {
    console.error(`[db-sync-custom] initial sync failed: ${err.message}`);
  });

  // Schedule recurring syncs
  syncTimer = setInterval(() => {
    runSync(null, dbPath).catch((err) => {
      console.error(`[db-sync-custom] scheduled sync failed: ${err.message}`);
    });
  }, SYNC_INTERVAL_MS);

  if (syncTimer.unref) syncTimer.unref();
  syncState.nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
}

/**
 * Stop the sync scheduler.
 */
export function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
