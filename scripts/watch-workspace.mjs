import { watch, copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "workspace");
const DEST = join(ROOT, ".tmpdata", "workspace");
const SKILLS_DIR = "skills";

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function syncFile(relPath) {
  try {
    mkdirSync(join(DEST, dirname(relPath)), { recursive: true });
    copyFileSync(join(SRC, relPath), join(DEST, relPath));
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
  const skillsSrc = join(SRC, SKILLS_DIR);
  if (!existsSync(skillsSrc)) return 0;
  const files = walkDir(skillsSrc);
  for (const absPath of files) {
    const relPath = absPath.slice(SRC.length + 1); // e.g. "skills/ranch/SKILL.md"
    syncFile(relPath);
  }
  return files.length;
}

function syncAll() {
  mkdirSync(DEST, { recursive: true });
  const mdFiles = readdirSync(SRC).filter((f) => f.endsWith(".md"));
  for (const file of mdFiles) {
    syncFile(file);
  }
  const skillCount = syncSkillsDir();
  console.log(`[${timestamp()}] initial sync complete (${mdFiles.length} .md files, ${skillCount} skill files)`);
}

// Initial sync
syncAll();

// Watch for changes — fs.watch filenames are unreliable for nested
// paths on macOS, so any change triggers a full (cheap) resync.
let debounceTimer = null;

watch(SRC, { recursive: true }, (_eventType, _filename) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncAll(), 300);
});

console.log(`[${timestamp()}] watching workspace/ for .md and skills/* changes...`);
