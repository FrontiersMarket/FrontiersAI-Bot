import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dir, "../../..");
export const ENV_PATH = resolve(ROOT, ".env");
export const RESOURCES_SRC = resolve(ROOT, "resources");
export const RESOURCES_DEST = resolve(ROOT, ".tmpdata", "resources");
export const WORKSPACE_SRC = resolve(ROOT, "workspace");
export const WORKSPACE_DEST = resolve(ROOT, ".tmpdata", "workspace");
export const GCP_KEY_FILE = "openclaw-gbq-key.json";
export const SCOPE_FILE = "SCOPE.md";
export const DEFAULT_CONTAINER_NAME = "frontiersai-bot";

// Mutable via setContainerName() — ES module live binding ensures all importers
// see the updated value after the container-name setup step runs.
export let CONTAINER_NAME = DEFAULT_CONTAINER_NAME;
export function setContainerName(name) { CONTAINER_NAME = name; }

export const IMAGE_NAME = "frontiersai-bot";
