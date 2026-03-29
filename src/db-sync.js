/**
 * db-sync.js — BigQuery → SQLite sync service (multi-dataset)
 *
 * Pulls ranch-scoped data from multiple BigQuery datasets and stores it in a
 * local SQLite database at RANCH_DB_PATH. Runs on a schedule (default: every
 * 5 minutes). The bot queries SQLite via the local-db skill instead of
 * BigQuery directly.
 *
 * Table definitions and dataset sources are driven by config/sync-tables.json.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYNC_INTERVAL_MS = parseInt(
  process.env.DB_SYNC_INTERVAL_MS ?? "300000",
  10
);

// ── Config loader ────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(__dirname, "..", "config", "sync-tables.json");

function loadSyncConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const config = JSON.parse(raw);

  if (!config.sources || !config.tables) {
    throw new Error("sync-tables.json must have 'sources' and 'tables' keys");
  }

  return config;
}

// ── Filter builders ──────────────────────────────────────────────────────────
// Each filter type is a function (ranchUuid, source) → WHERE clause string.
// `source` has { project, dataset } for cross-dataset subquery references.
// The "public" source is always used for core lookup tables (livestock, cameras).

function buildFilterFn(filterType, sources) {
  const pub = sources.public;
  if (!pub) throw new Error("sync config must include a 'public' source");

  const fqPublic = (table) => `\`${pub.project}.${pub.dataset}.${table}\``;

  switch (filterType) {
    case "ranch_uuid":
      return (uuid) => `ranch_uuid = '${uuid}'`;

    case "ranch_uuid_is_uuid":
      return (uuid) => `uuid = '${uuid}'`;

    case "livestock_sub":
      return (uuid) =>
        `livestock_uuid IN (SELECT uuid FROM ${fqPublic("livestock")} WHERE ranch_uuid = '${uuid}')`;

    case "camera_sub":
      return (uuid) =>
        `camera_uuid IN (SELECT uuid FROM ${fqPublic("cameras")} WHERE ranch_uuid = '${uuid}')`;

    case "video_sub":
      return (uuid) =>
        `video_uuid IN (SELECT uuid FROM ${fqPublic("camera_videos")} WHERE camera_uuid IN (SELECT uuid FROM ${fqPublic("cameras")} WHERE ranch_uuid = '${uuid}'))`;

    case "camera_name_sub":
      return (uuid) =>
        `camera_name IN (SELECT name FROM ${fqPublic("cameras")} WHERE ranch_uuid = '${uuid}')`;

    default:
      throw new Error(`Unknown filter type: ${filterType}`);
  }
}

// ── Priority ordering ────────────────────────────────────────────────────────

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortByPriority(tables) {
  return [...tables].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );
}

// ── Type helpers ─────────────────────────────────────────────────────────────

/**
 * Map a BigQuery column data_type to a SQLite column type.
 * Returns null for types that should be skipped (STRUCT/RECORD).
 */
function bqTypeToSQLite(bqType) {
  const base = bqType.toUpperCase().split("<")[0].trim();
  switch (base) {
    case "STRING":
      return "TEXT";
    case "INT64":
    case "INTEGER":
    case "BOOL":
    case "BOOLEAN":
      return "INTEGER";
    case "FLOAT64":
    case "FLOAT":
    case "NUMERIC":
    case "BIGNUMERIC":
      return "REAL";
    case "TIMESTAMP":
    case "DATETIME":
    case "DATE":
    case "TIME":
      return "TEXT";
    case "JSON":
      return "TEXT";
    case "STRUCT":
    case "RECORD":
      return null; // skip — e.g. datastream_metadata
    case "ARRAY":
      return "TEXT"; // store as JSON string
    default:
      return "TEXT";
  }
}

/**
 * Serialize a BigQuery row value to a SQLite-compatible value.
 */
function serializeValue(val, bqType) {
  if (val === null || val === undefined) return null;

  const base = bqType.toUpperCase().split("<")[0].trim();

  switch (base) {
    case "BOOL":
    case "BOOLEAN":
      return val ? 1 : 0;

    case "INT64":
    case "INTEGER":
      return typeof val === "bigint" ? Number(val) : Number(val);

    case "FLOAT64":
    case "FLOAT":
    case "NUMERIC":
    case "BIGNUMERIC":
      return Number(val);

    case "TIMESTAMP":
    case "DATETIME":
      // BQ Node client returns BigQueryTimestamp object with .value (ISO string)
      if (val && typeof val === "object" && val.value) return val.value;
      if (val instanceof Date) return val.toISOString();
      return String(val);

    case "DATE":
    case "TIME":
      if (val && typeof val === "object" && val.value) return val.value;
      return String(val);

    case "JSON":
      return typeof val === "object" ? JSON.stringify(val) : String(val);

    case "ARRAY":
      return Array.isArray(val) ? JSON.stringify(val) : String(val);

    default:
      return typeof val === "object" ? JSON.stringify(val) : String(val);
  }
}

// ── Sync state ────────────────────────────────────────────────────────────────

export const syncState = {
  running: false,
  initialized: false,
  lastSyncAt: null,
  lastSyncError: null,
  nextSyncAt: null,
  tables: {}, // { tableName: { rows, syncedAt, error } }
};

let syncTimer = null;
let bigquery = null;

// ── Core sync logic ───────────────────────────────────────────────────────────

/**
 * Query INFORMATION_SCHEMA to get column definitions for a table.
 * Returns array of { column_name, data_type } objects.
 */
async function getTableSchema(tableName, source) {
  const query = `
    SELECT column_name, data_type
    FROM \`${source.project}.${source.dataset}\`.INFORMATION_SCHEMA.COLUMNS
    WHERE table_name = '${tableName}'
    ORDER BY ordinal_position
  `;
  const [rows] = await bigquery.query({ query, location: source.location });
  return rows;
}

/**
 * Sync one table: query BQ, create SQLite table if needed, replace all rows.
 */
async function syncTable(db, tableConfig, ranchUuid, sources) {
  const { name, source: sourceKey, filter: filterType } = tableConfig;
  const source = sources[sourceKey];
  if (!source) throw new Error(`Unknown source '${sourceKey}' for table '${name}'`);

  const filterFn = buildFilterFn(filterType, sources);

  // 1. Get schema
  const schema = await getTableSchema(name, source);
  if (schema.length === 0) {
    console.log(`[db-sync] skipping ${name} — no columns in schema`);
    return 0;
  }

  // Filter out STRUCT/RECORD columns (datastream_metadata, etc.)
  const cols = schema.filter((c) => bqTypeToSQLite(c.data_type) !== null);
  if (cols.length === 0) {
    console.log(`[db-sync] skipping ${name} — no mappable columns`);
    return 0;
  }

  // 2. Ensure SQLite table exists
  const colDefs = cols
    .map((c) => `"${c.column_name}" ${bqTypeToSQLite(c.data_type)}`)
    .join(", ");
  db.prepare(`CREATE TABLE IF NOT EXISTS "${name}" (${colDefs})`).run();

  // 3. Query BQ for ranch-scoped rows
  const whereClause = filterFn(ranchUuid);
  const columnList = cols.map((c) => `\`${c.column_name}\``).join(", ");
  const bqQuery = `
    SELECT ${columnList}
    FROM \`${source.project}.${source.dataset}.${name}\`
    WHERE ${whereClause}
  `;

  const [rows] = await bigquery.query({
    query: bqQuery,
    location: source.location,
    // Increase max for large ranches; BQ Node client pages automatically
    maxResults: 100000,
  });

  // 4. Replace table contents atomically
  const placeholders = cols.map(() => "?").join(", ");
  const insertSql = `INSERT INTO "${name}" (${cols.map((c) => `"${c.column_name}"`).join(", ")}) VALUES (${placeholders})`;

  const replaceAll = db.transaction((bqRows) => {
    db.prepare(`DELETE FROM "${name}"`).run();
    const stmt = db.prepare(insertSql);
    for (const row of bqRows) {
      const values = cols.map((c) =>
        serializeValue(row[c.column_name], c.data_type)
      );
      stmt.run(values);
    }
  });

  replaceAll(rows);
  return rows.length;
}

/**
 * Ensure the _sync_meta table exists in SQLite for tracking sync state.
 */
function ensureSyncMeta(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS _sync_meta (
      table_name TEXT PRIMARY KEY,
      source TEXT,
      last_sync_at TEXT,
      row_count INTEGER,
      error TEXT
    )
  `).run();
}

/**
 * Run a full sync of all tables for the given ranch UUID.
 */
export async function runSync(ranchUuid, dbPath) {
  if (syncState.running) {
    console.log("[db-sync] sync already in progress, skipping");
    return;
  }

  syncState.running = true;
  syncState.lastSyncError = null;
  const startedAt = new Date().toISOString();
  console.log(`[db-sync] starting full sync for ranch ${ranchUuid}`);

  let config;
  try {
    config = loadSyncConfig();
  } catch (err) {
    syncState.running = false;
    syncState.lastSyncError = `Failed to load sync config: ${err.message}`;
    console.error(`[db-sync] ${syncState.lastSyncError}`);
    return;
  }

  const { sources, tables } = config;
  const enabledTables = tables.filter((t) => t.enabled !== false);
  const sorted = sortByPriority(enabledTables);

  console.log(
    `[db-sync] ${sorted.length} tables enabled (${enabledTables.filter((t) => t.priority === "high").length} high, ` +
    `${enabledTables.filter((t) => t.priority === "medium").length} medium, ` +
    `${enabledTables.filter((t) => t.priority === "low").length} low)`
  );

  const db = new Database(dbPath);
  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  try {
    ensureSyncMeta(db);

    for (const tableConfig of sorted) {
      const { name, source: sourceKey } = tableConfig;
      try {
        const rowCount = await syncTable(db, tableConfig, ranchUuid, sources);
        console.log(`[db-sync] ${sourceKey}.${name}: ${rowCount} rows`);

        db.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, source, last_sync_at, row_count, error)
          VALUES (?, ?, ?, ?, NULL)
        `).run(name, sourceKey, new Date().toISOString(), rowCount);

        syncState.tables[name] = {
          rows: rowCount,
          source: sourceKey,
          syncedAt: new Date().toISOString(),
          error: null,
        };
      } catch (err) {
        const msg = err.message || String(err);
        // Table not found or no data — non-fatal
        if (
          msg.includes("Not found") ||
          msg.includes("not found") ||
          msg.includes("does not exist")
        ) {
          console.log(`[db-sync] ${sourceKey}.${name}: table not found in BQ, skipping`);
        } else {
          console.warn(`[db-sync] ${sourceKey}.${name}: error — ${msg}`);
        }

        db.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, source, last_sync_at, row_count, error)
          VALUES (?, ?, ?, 0, ?)
        `).run(name, sourceKey, new Date().toISOString(), msg.slice(0, 500));

        syncState.tables[name] = { rows: 0, source: sourceKey, syncedAt: new Date().toISOString(), error: msg };
      }
    }

    syncState.lastSyncAt = new Date().toISOString();
    console.log(`[db-sync] full sync complete (started ${startedAt})`);
  } catch (err) {
    syncState.lastSyncError = err.message || String(err);
    console.error(`[db-sync] fatal sync error: ${syncState.lastSyncError}`);
  } finally {
    db.close();
    syncState.running = false;
    syncState.nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Initialize the sync service. Runs an immediate sync then schedules
 * recurring syncs at SYNC_INTERVAL_MS intervals.
 *
 * @param {string} ranchUuid  The scoped ranch UUID
 * @param {string} dbPath     Path to the SQLite database file
 */
export function initSync(ranchUuid, dbPath) {
  if (!ranchUuid) {
    console.warn("[db-sync] RANCH_UUID not set — sync service disabled");
    return;
  }

  // Validate UUID format before using in SQL
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(ranchUuid)) {
    console.error(`[db-sync] invalid RANCH_UUID format: ${ranchUuid}`);
    return;
  }

  // Lazy-load BigQuery to avoid import-time errors when credentials are missing
  import("@google-cloud/bigquery")
    .then(({ BigQuery }) => {
      bigquery = new BigQuery({ projectId: "frontiersmarketplace" });
      syncState.initialized = true;

      fs.mkdirSync(path.dirname(dbPath), { recursive: true });

      console.log(`[db-sync] initialized — ranch=${ranchUuid} db=${dbPath}`);
      console.log(`[db-sync] sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
      console.log(`[db-sync] config: ${CONFIG_PATH}`);

      // Run first sync immediately
      runSync(ranchUuid, dbPath).catch((err) => {
        console.error(`[db-sync] initial sync failed: ${err.message}`);
      });

      // Schedule recurring syncs
      syncTimer = setInterval(() => {
        runSync(ranchUuid, dbPath).catch((err) => {
          console.error(`[db-sync] scheduled sync failed: ${err.message}`);
        });
      }, SYNC_INTERVAL_MS);

      // Don't block process exit
      if (syncTimer.unref) syncTimer.unref();

      syncState.nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
    })
    .catch((err) => {
      console.error(
        `[db-sync] failed to load @google-cloud/bigquery: ${err.message}`
      );
      console.error("[db-sync] sync service disabled — install dependencies");
    });
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
