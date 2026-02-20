import { watch, copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_SRC = join(ROOT, "workspace");
const WORKSPACE_DEST = join(ROOT, ".tmpdata", "workspace");
const RESOURCES_SRC = join(ROOT, "resources");
const RESOURCES_DEST = join(ROOT, ".tmpdata", "resources");
const SKILLS_DIR = "skills";
const CONTAINER_NAME = "frontiersai-bot";
const CONTAINER_WORKSPACE = "/data/workspace";

// Directories to exclude from sync (dependency/install artifacts)
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".eggs",
  "site-packages",
]);

const EXCLUDED_SUFFIXES = [".egg-info"];

// Manifest files that trigger dependency installation inside the container
const MANIFEST_HANDLERS = {
  "package.json": {
    type: "node",
    command: (skillDir) => ["npm", "install", "--prefix", skillDir],
  },
  "requirements.txt": {
    type: "python",
    command: (skillDir) => ["pip3", "install", "-r", join(skillDir, "requirements.txt")],
  },
  "pyproject.toml": {
    type: "python",
    command: (skillDir) => ["pip3", "install", skillDir],
  },
};

// In-memory state for tracking manifest changes and pending installs
const manifestHashes = new Map();
const pendingInstalls = new Set();

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function syncFile(src, dest, relPath) {
  try {
    mkdirSync(join(dest, dirname(relPath)), { recursive: true });
    copyFileSync(join(src, relPath), join(dest, relPath));
    console.log(`[${timestamp()}] synced ${relPath}`);
  } catch (err) {
    console.error(`[${timestamp()}] failed to sync ${relPath}: ${err.message}`);
  }
}

function shouldExcludeDir(name) {
  if (EXCLUDED_DIRS.has(name)) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldExcludeDir(entry.name)) continue;
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function syncSkillsDir() {
  const skillsSrc = join(WORKSPACE_SRC, SKILLS_DIR);
  if (!existsSync(skillsSrc)) return 0;
  const files = walkDir(skillsSrc);
  for (const absPath of files) {
    const relPath = absPath.slice(WORKSPACE_SRC.length + 1);
    syncFile(WORKSPACE_SRC, WORKSPACE_DEST, relPath);
  }
  return files.length;
}

function syncWorkspace() {
  mkdirSync(WORKSPACE_DEST, { recursive: true });
  const mdFiles = readdirSync(WORKSPACE_SRC).filter((f) => f.endsWith(".md"));
  for (const file of mdFiles) {
    syncFile(WORKSPACE_SRC, WORKSPACE_DEST, file);
  }
  const skillCount = syncSkillsDir();
  console.log(`[${timestamp()}] workspace sync complete (${mdFiles.length} .md files, ${skillCount} skill files)`);
}

function syncResources() {
  if (!existsSync(RESOURCES_SRC)) return;
  mkdirSync(RESOURCES_DEST, { recursive: true });
  const files = walkDir(RESOURCES_SRC);
  for (const absPath of files) {
    const relPath = absPath.slice(RESOURCES_SRC.length + 1);
    syncFile(RESOURCES_SRC, RESOURCES_DEST, relPath);
  }
  console.log(`[${timestamp()}] resources sync complete (${files.length} files)`);
}

// ---------------------------------------------------------------------------
// Dependency install pipeline
// ---------------------------------------------------------------------------

async function isContainerRunning() {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

function computeManifestHash(filePath) {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function detectChangedManifests() {
  const changed = [];
  const skillsSrc = join(WORKSPACE_SRC, SKILLS_DIR);
  if (!existsSync(skillsSrc)) return changed;

  for (const entry of readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const skillPath = join(skillsSrc, skillName);

    for (const manifestFile of Object.keys(MANIFEST_HANDLERS)) {
      const manifestPath = join(skillPath, manifestFile);
      if (!existsSync(manifestPath)) continue;

      const hashKey = `skills/${skillName}/${manifestFile}`;
      const currentHash = computeManifestHash(manifestPath);
      const previousHash = manifestHashes.get(hashKey);

      if (currentHash && currentHash !== previousHash) {
        manifestHashes.set(hashKey, currentHash);
        changed.push({ skillName, manifestFile });
      }
    }
  }
  return changed;
}

async function runInstallInContainer(skillName, manifestFile) {
  const handler = MANIFEST_HANDLERS[manifestFile];
  if (!handler) return;

  const skillDir = join(CONTAINER_WORKSPACE, "skills", skillName);
  const command = handler.command(skillDir);
  const installKey = `${skillName}::${manifestFile}`;

  if (!(await isContainerRunning())) {
    console.log(`[${timestamp()}] container not running, queuing install for ${skillName} (${manifestFile})`);
    pendingInstalls.add(installKey);
    return;
  }

  console.log(`[${timestamp()}] installing ${handler.type} deps for skill "${skillName}"...`);

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker", ["exec", CONTAINER_NAME, ...command],
      { timeout: 120_000 },
    );

    pendingInstalls.delete(installKey);

    if (stdout.trim()) {
      const lines = stdout.trim().split("\n");
      console.log(`[${timestamp()}] ${skillName} install:\n${lines.slice(-3).join("\n")}`);
    }
    if (stderr.trim()) {
      const errLines = stderr.trim().split("\n")
        .filter((l) => /ERR!|error|Error/.test(l));
      if (errLines.length > 0) {
        console.warn(`[${timestamp()}] ${skillName} install warnings:\n${errLines.join("\n")}`);
      }
    }
    console.log(`[${timestamp()}] ${skillName} deps installed`);
  } catch (err) {
    console.error(`[${timestamp()}] failed to install deps for ${skillName}: ${err.message}`);
    pendingInstalls.add(installKey);
  }
}

async function retryPendingInstalls() {
  if (pendingInstalls.size === 0) return;
  if (!(await isContainerRunning())) return;

  console.log(`[${timestamp()}] retrying ${pendingInstalls.size} pending install(s)...`);
  const pending = [...pendingInstalls];
  for (const key of pending) {
    const [skillName, manifestFile] = key.split("::");
    await runInstallInContainer(skillName, manifestFile);
  }
}

// ---------------------------------------------------------------------------
// Sync orchestration (async with overlap protection)
// ---------------------------------------------------------------------------

async function syncAllAndInstall() {
  syncWorkspace();
  syncResources();

  const changedManifests = detectChangedManifests();
  await retryPendingInstalls();

  for (const { skillName, manifestFile } of changedManifests) {
    await runInstallInContainer(skillName, manifestFile);
  }
}

let syncInProgress = false;
let syncQueuedWhileRunning = false;

async function runSyncCycle() {
  if (syncInProgress) {
    syncQueuedWhileRunning = true;
    return;
  }
  syncInProgress = true;
  try {
    await syncAllAndInstall();
  } catch (err) {
    console.error(`[${timestamp()}] sync error: ${err.message}`);
  } finally {
    syncInProgress = false;
    if (syncQueuedWhileRunning) {
      syncQueuedWhileRunning = false;
      runSyncCycle();
    }
  }
}

// ---------------------------------------------------------------------------
// Initial sync + file watchers
// ---------------------------------------------------------------------------

runSyncCycle();

let debounceTimer = null;

function scheduleSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSyncCycle(), 300);
}

// Watch for changes — fs.watch filenames are unreliable for nested
// paths on macOS, so any change triggers a full (cheap) resync.
watch(WORKSPACE_SRC, { recursive: true }, () => scheduleSync());

if (existsSync(RESOURCES_SRC)) {
  watch(RESOURCES_SRC, { recursive: true }, () => scheduleSync());
}

console.log(`[${timestamp()}] watching workspace/ and resources/ for changes...`);
