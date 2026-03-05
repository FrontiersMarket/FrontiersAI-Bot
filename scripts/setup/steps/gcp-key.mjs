import { confirm, note, log, text } from "@clack/prompts";
import { existsSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { RESOURCES_SRC, RESOURCES_DEST, GCP_KEY_FILE } from "../lib/constants.mjs";
import { bail, guardCancel } from "../lib/utils.mjs";

const KEY_DEST_REPO = resolve(RESOURCES_SRC, GCP_KEY_FILE);
const KEY_DEST_TMPDATA = resolve(RESOURCES_DEST, GCP_KEY_FILE);

function validateKeyFile(filePath) {
  if (!existsSync(filePath)) return `File not found: ${filePath}`;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return "Could not parse JSON — is this a valid key file?";
  }
  if (parsed.type !== "service_account") {
    return `Expected type "service_account", got "${parsed.type ?? "unknown"}"`;
  }
  if (!parsed.client_email) return 'Missing "client_email" field';
  if (!parsed.private_key) return 'Missing "private_key" field';
  return null; // valid
}

function syncKey(srcPath) {
  mkdirSync(RESOURCES_SRC, { recursive: true });
  mkdirSync(RESOURCES_DEST, { recursive: true });
  copyFileSync(srcPath, KEY_DEST_REPO);
  copyFileSync(srcPath, KEY_DEST_TMPDATA);
}

export async function setupGcpKey() {
  const keyPresent = existsSync(KEY_DEST_REPO);

  if (keyPresent) {
    const validationError = validateKeyFile(KEY_DEST_REPO);

    if (validationError) {
      // Existing key is invalid — must replace
      note(
        [
          `  Found: resources/${GCP_KEY_FILE}`,
          `  ✗  Validation failed: ${validationError}`,
          "",
          "  The key file must be replaced before continuing.",
        ].join("\n"),
        "GCP service-account key  ⚠  invalid"
      );
    } else {
      // Valid key — show info and offer to replace
      let serviceAccount = "unknown";
      try {
        serviceAccount = JSON.parse(readFileSync(KEY_DEST_REPO, "utf8")).client_email;
      } catch {}

      note(
        [
          `  Found: resources/${GCP_KEY_FILE}`,
          `  Account: ${serviceAccount}`,
          `  Synced to .tmpdata: ${existsSync(KEY_DEST_TMPDATA) ? "✓" : "will sync now"}`,
        ].join("\n"),
        "GCP service-account key  ✓"
      );

      const replace = guardCancel(
        await confirm({ message: "Replace the existing GCP key?", initialValue: false })
      );

      if (!replace) {
        // Ensure .tmpdata copy is current
        mkdirSync(RESOURCES_DEST, { recursive: true });
        copyFileSync(KEY_DEST_REPO, KEY_DEST_TMPDATA);
        log.success("GCP key synced to .tmpdata/resources/");
        return;
      }
    }
  } else {
    // Key is missing — hard requirement
    note(
      [
        "  The bot requires a GCP service-account JSON key to access BigQuery.",
        "",
        `  Required location: resources/${GCP_KEY_FILE}`,
        "",
        "  How to get it:",
        "  1. Go to GCP Console → IAM & Admin → Service Accounts",
        "  2. Select the service account for this project",
        "  3. Keys tab → Add Key → Create new key → JSON",
        "  4. Download the file",
        "  5. Provide the path below (it will be copied to resources/)",
        "",
        "  Note: resources/ is git-ignored — the key will not be committed.",
      ].join("\n"),
      "GCP service-account key  ✗  missing"
    );
  }

  // Ask for path to the key file
  const keyPath = guardCancel(
    await text({
      message: "Path to service-account JSON key file",
      placeholder: "~/Downloads/my-service-account.json",
      validate: (v) => {
        if (!v || !v.trim()) return "Path is required";
        const p = v.trim().replace(/^~/, process.env.HOME ?? "~");
        return validateKeyFile(p) ?? undefined;
      },
    })
  );

  const resolvedPath = keyPath.trim().replace(/^~/, process.env.HOME ?? "~");

  syncKey(resolvedPath);

  let serviceAccount = "unknown";
  try {
    serviceAccount = JSON.parse(readFileSync(KEY_DEST_REPO, "utf8")).client_email;
  } catch {}

  log.success(`GCP key installed  (${serviceAccount})`);
}
