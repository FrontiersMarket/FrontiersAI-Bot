import { watch, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "workspace");
const DEST = join(ROOT, ".tmpdata", "workspace");

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function syncFile(filename) {
  try {
    copyFileSync(join(SRC, filename), join(DEST, filename));
    console.log(`[${timestamp()}] synced ${filename}`);
  } catch (err) {
    console.error(`[${timestamp()}] failed to sync ${filename}: ${err.message}`);
  }
}

function syncAll() {
  mkdirSync(DEST, { recursive: true });
  const files = readdirSync(SRC).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    syncFile(file);
  }
  console.log(`[${timestamp()}] initial sync complete (${files.length} files)`);
}

// Initial sync
syncAll();

// Watch for changes
let debounceTimer = null;
const pendingFiles = new Set();

watch(SRC, { recursive: true }, (eventType, filename) => {
  if (!filename || !filename.endsWith(".md")) return;

  pendingFiles.add(basename(filename));

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    for (const file of pendingFiles) {
      syncFile(file);
    }
    pendingFiles.clear();
  }, 300);
});

console.log(`[${timestamp()}] watching workspace/ for .md changes...`);
