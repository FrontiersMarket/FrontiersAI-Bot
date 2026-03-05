import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cancel, isCancel } from "@clack/prompts";
import { ROOT } from "./constants.mjs";

export const execFileAsync = promisify(execFile);

export function bail(message) {
  cancel(message);
  process.exit(1);
}

export function guardCancel(value) {
  if (isCancel(value)) bail("Setup cancelled.");
  return value;
}

export async function checkCommand(cmd, args, parseVersion) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
    return {
      ok: true,
      version: parseVersion ? parseVersion(stdout.trim()) : stdout.trim(),
    };
  } catch {
    return { ok: false, version: null };
  }
}

export async function generateToken() {
  try {
    const { stdout } = await execFileAsync("openssl", ["rand", "-hex", "32"], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    const { randomBytes } = await import("node:crypto");
    return randomBytes(32).toString("hex");
  }
}

/** Spawn a command with stdio: inherit so output streams directly to terminal. */
export function spawnInherited(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`'${cmd}' exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

/** Poll a URL until it responds 2xx or timeout expires. */
export async function pollHealth(url, timeoutMs = 35_000, intervalMs = 2000) {
  const { default: http } = await import("node:http");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      try {
        const req = http.get(url, { timeout: 2000 }, (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
      } catch {
        resolve(false);
      }
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Sleep for ms milliseconds. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
