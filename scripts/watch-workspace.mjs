import { watch, copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_SRC = join(ROOT, "workspace");
const WORKSPACE_DEST = join(ROOT, ".tmpdata", "workspace");
const RESOURCES_SRC = join(ROOT, "resources");
const RESOURCES_DEST = join(ROOT, ".tmpdata", "resources");
const SKILLS_DIR = "skills";

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

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
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

function syncAll() {
  syncWorkspace();
  syncResources();
}

// Initial sync
syncAll();

// Watch for changes — fs.watch filenames are unreliable for nested
// paths on macOS, so any change triggers a full (cheap) resync.
let debounceTimer = null;

watch(WORKSPACE_SRC, { recursive: true }, (_eventType, _filename) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncAll(), 300);
});

if (existsSync(RESOURCES_SRC)) {
  watch(RESOURCES_SRC, { recursive: true }, (_eventType, _filename) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => syncAll(), 300);
  });
}

console.log(`[${timestamp()}] watching workspace/ and resources/ for changes...`);
