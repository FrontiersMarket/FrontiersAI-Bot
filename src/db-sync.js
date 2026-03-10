/**
 * db-sync.js — BigQuery → SQLite sync service
 *
 * Pulls all ranch-scoped data from BigQuery `frontiersmarketplace.public` and
 * stores it in a local SQLite database at RANCH_DB_PATH. Runs on a schedule
 * (default: every 5 minutes). The bot queries SQLite via the local-db skill
 * instead of BigQuery directly.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = "frontiersmarketplace";
const DATASET = "public";
const BQ_LOCATION = "us-central1";
const SYNC_INTERVAL_MS = parseInt(
  process.env.DB_SYNC_INTERVAL_MS ?? "300000",
  10
);

// ── Table definitions ────────────────────────────────────────────────────────

const LIVESTOCK_SUB = (uuid) =>
  `livestock_uuid IN (SELECT uuid FROM \`${PROJECT_ID}.${DATASET}.livestock\` WHERE ranch_uuid = '${uuid}')`;

const CAMERA_SUB = (uuid) =>
  `camera_uuid IN (SELECT uuid FROM \`${PROJECT_ID}.${DATASET}.cameras\` WHERE ranch_uuid = '${uuid}')`;

const VIDEO_SUB = (uuid) =>
  `video_uuid IN (SELECT uuid FROM \`${PROJECT_ID}.${DATASET}.camera_videos\` WHERE camera_uuid IN (SELECT uuid FROM \`${PROJECT_ID}.${DATASET}.cameras\` WHERE ranch_uuid = '${uuid}'))`;

const TABLES = [
  // Core ranch entity
  { name: "ranch", filter: (uuid) => `uuid = '${uuid}'` },
  // Direct ranch_uuid tables
  { name: "livestock", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "group", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "land", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "cameras", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "contacts", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "rainfall", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "events", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "equipment", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "tanks", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "semen", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "categories", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "expenses", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "income", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "ranch_settings", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "ranch_association", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "salesbook", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  { name: "prediction_results", filter: (uuid) => `ranch_uuid = '${uuid}'` },
  {
    name: "unverified_weight_records",
    filter: (uuid) => `ranch_uuid = '${uuid}'`,
  },
  // Record tables (livestock-scoped)
  { name: "weight_record", filter: LIVESTOCK_SUB },
  { name: "bcs_record", filter: LIVESTOCK_SUB },
  { name: "vaccination_record", filter: LIVESTOCK_SUB },
  { name: "note_record", filter: LIVESTOCK_SUB },
  { name: "calving_record", filter: LIVESTOCK_SUB },
  { name: "death_record", filter: LIVESTOCK_SUB },
  { name: "pregnancy_check_record", filter: LIVESTOCK_SUB },
  { name: "transfer_record", filter: LIVESTOCK_SUB },
  { name: "harvest_record", filter: LIVESTOCK_SUB },
  { name: "breeding_serv_record", filter: LIVESTOCK_SUB },
  { name: "transaction_record", filter: LIVESTOCK_SUB },
  { name: "doctoring_record", filter: LIVESTOCK_SUB },
  { name: "foot_score_record", filter: LIVESTOCK_SUB },
  { name: "implant_record", filter: LIVESTOCK_SUB },
  { name: "udder_teat_record", filter: LIVESTOCK_SUB },
  { name: "ear_tag_record", filter: LIVESTOCK_SUB },
  { name: "worming_record", filter: LIVESTOCK_SUB },
  { name: "culling_record", filter: LIVESTOCK_SUB },
  { name: "horning_record", filter: LIVESTOCK_SUB },
  { name: "heat_detect_record", filter: LIVESTOCK_SUB },
  { name: "transport_record", filter: LIVESTOCK_SUB },
  { name: "consign_record", filter: LIVESTOCK_SUB },
  { name: "exam_record", filter: LIVESTOCK_SUB },
  { name: "perm_record", filter: LIVESTOCK_SUB },
  // Advanced livestock tables
  { name: "vaccinations", filter: LIVESTOCK_SUB },
  { name: "treatments", filter: LIVESTOCK_SUB },
  { name: "epds", filter: LIVESTOCK_SUB },
  { name: "gain_tests", filter: LIVESTOCK_SUB },
  { name: "measurements", filter: LIVESTOCK_SUB },
  { name: "carcass_data", filter: LIVESTOCK_SUB },
  { name: "breedings", filter: LIVESTOCK_SUB },
  { name: "breed_compositions", filter: LIVESTOCK_SUB },
  { name: "ownerships", filter: LIVESTOCK_SUB },
  { name: "gallery_item", filter: LIVESTOCK_SUB },
  // Camera-scoped tables
  { name: "camera_videos", filter: CAMERA_SUB },
  { name: "land_cameras", filter: CAMERA_SUB },
  { name: "camera_reports", filter: CAMERA_SUB },
  // Video-scoped tables
  { name: "video_events", filter: VIDEO_SUB },
];

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
async function getTableSchema(tableName) {
  const query = `
    SELECT column_name, data_type
    FROM \`${PROJECT_ID}.${DATASET}\`.INFORMATION_SCHEMA.COLUMNS
    WHERE table_name = '${tableName}'
    ORDER BY ordinal_position
  `;
  const [rows] = await bigquery.query({ query, location: BQ_LOCATION });
  return rows;
}

/**
 * Sync one table: query BQ, create SQLite table if needed, replace all rows.
 */
async function syncTable(db, tableName, ranchUuid) {
  const filterFn = TABLES.find((t) => t.name === tableName)?.filter;
  if (!filterFn) throw new Error(`No filter defined for table: ${tableName}`);

  // 1. Get schema
  const schema = await getTableSchema(tableName);
  if (schema.length === 0) {
    console.log(`[db-sync] skipping ${tableName} — no columns in schema`);
    return 0;
  }

  // Filter out STRUCT/RECORD columns (datastream_metadata, etc.)
  const cols = schema.filter((c) => bqTypeToSQLite(c.data_type) !== null);
  if (cols.length === 0) {
    console.log(`[db-sync] skipping ${tableName} — no mappable columns`);
    return 0;
  }

  // 2. Ensure SQLite table exists
  const colDefs = cols
    .map((c) => `"${c.column_name}" ${bqTypeToSQLite(c.data_type)}`)
    .join(", ");
  db.prepare(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`).run();

  // 3. Query BQ for ranch-scoped rows
  const whereClause = filterFn(ranchUuid);
  const columnList = cols.map((c) => `\`${c.column_name}\``).join(", ");
  const bqQuery = `
    SELECT ${columnList}
    FROM \`${PROJECT_ID}.${DATASET}.${tableName}\`
    WHERE ${whereClause}
  `;

  const [rows] = await bigquery.query({
    query: bqQuery,
    location: BQ_LOCATION,
    // Increase max for large ranches; BQ Node client pages automatically
    maxResults: 100000,
  });

  // 4. Replace table contents atomically
  const placeholders = cols.map(() => "?").join(", ");
  const insertSql = `INSERT INTO "${tableName}" (${cols.map((c) => `"${c.column_name}"`).join(", ")}) VALUES (${placeholders})`;

  const replaceAll = db.transaction((bqRows) => {
    db.prepare(`DELETE FROM "${tableName}"`).run();
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

  const db = new Database(dbPath);
  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  try {
    ensureSyncMeta(db);

    for (const tableConfig of TABLES) {
      const { name } = tableConfig;
      try {
        const rowCount = await syncTable(db, name, ranchUuid);
        console.log(`[db-sync] ${name}: ${rowCount} rows`);

        db.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, last_sync_at, row_count, error)
          VALUES (?, ?, ?, NULL)
        `).run(name, new Date().toISOString(), rowCount);

        syncState.tables[name] = {
          rows: rowCount,
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
          console.log(`[db-sync] ${name}: table not found in BQ, skipping`);
        } else {
          console.warn(`[db-sync] ${name}: error — ${msg}`);
        }

        db.prepare(`
          INSERT OR REPLACE INTO _sync_meta (table_name, last_sync_at, row_count, error)
          VALUES (?, ?, 0, ?)
        `).run(name, new Date().toISOString(), msg.slice(0, 500));

        syncState.tables[name] = { rows: 0, syncedAt: new Date().toISOString(), error: msg };
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
      bigquery = new BigQuery({ projectId: PROJECT_ID });
      syncState.initialized = true;

      fs.mkdirSync(path.dirname(dbPath), { recursive: true });

      console.log(`[db-sync] initialized — ranch=${ranchUuid} db=${dbPath}`);
      console.log(`[db-sync] sync interval: ${SYNC_INTERVAL_MS / 1000}s`);

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
