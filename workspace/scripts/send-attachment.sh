#!/usr/bin/env bash
# send-attachment.sh — send a file inline to iMessage or Slack
#
# Usage:
#   send-attachment.sh --to <recipient> --file <path> --service <imessage|slack> \
#                      [--text <caption>] [--thread-ts <ts>]
#
# Examples (Slack):
#   send-attachment.sh --to "C1234567890" --file "/data/.openclaw/media/chart.png" --service slack --text "Here's your chart!"
#   send-attachment.sh --to "C1234567890" --file "/data/.openclaw/media/chart.png" --service slack --text "Here's your chart!" --thread-ts "1234567890.123456"
#
# Examples (iMessage):
#   send-attachment.sh --to "+15551234567" --file "/data/.openclaw/media/chart.png" --service imessage --text "Here's your chart!"

set -euo pipefail

# Log every invocation for debugging
echo "[$(date -u +%H:%M:%S)] send-attachment.sh called with: $*" >> /tmp/send-attachment.log

TO=""
FILE=""
SERVICE=""
TEXT=""
THREAD_TS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)        TO="$2";        shift 2 ;;
    --file)      FILE="$2";      shift 2 ;;
    --service)   SERVICE="$2";   shift 2 ;;
    --text)      TEXT="$2";      shift 2 ;;
    --thread-ts) THREAD_TS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TO" || -z "$FILE" || -z "$SERVICE" ]]; then
  echo "Error: --to, --file, and --service are required" >&2
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "Error: file not found: $FILE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Slack — all logic in Python to avoid bash quoting fragility
# ---------------------------------------------------------------------------
send_slack() {
  SEND_TO="$TO" \
  SEND_FILE="$FILE" \
  SEND_TEXT="$TEXT" \
  SEND_THREAD_TS="$THREAD_TS" \
  OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}" \
  python3 - <<'PYEOF'
import json, os, sys, urllib.request, urllib.parse, urllib.error

# --- resolve token ---
token = os.environ.get("SLACK_BOT_TOKEN", "")
if not token:
    state_dir = os.environ.get("OPENCLAW_STATE_DIR", "/data/.openclaw")
    config_file = os.path.join(state_dir, "openclaw.json")
    try:
        cfg = json.load(open(config_file))
        token = cfg.get("channels", {}).get("slack", {}).get("botToken", "")
    except Exception as e:
        print(f"Error reading openclaw.json: {e}", file=sys.stderr)

if not token:
    print("Error: Slack bot token not found", file=sys.stderr)
    sys.exit(1)

file_path   = os.environ["SEND_FILE"]
channel_id  = os.environ["SEND_TO"]
text        = os.environ.get("SEND_TEXT", "")
thread_ts   = os.environ.get("SEND_THREAD_TS", "")
filename    = os.path.basename(file_path)
filesize    = os.path.getsize(file_path)

def slack_post_json(endpoint, payload, token):
    """POST with application/json — used for completeUploadExternal."""
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://slack.com/api/{endpoint}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def slack_post_form(endpoint, payload, token):
    """POST with application/x-www-form-urlencoded — used for getUploadURLExternal."""
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        f"https://slack.com/api/{endpoint}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Resolve Slack user ID (U...) to DM channel ID (D...) via conversations.open
if channel_id.startswith("U"):
    open_resp = slack_post_json("conversations.open", {"users": channel_id}, token)
    if open_resp.get("ok"):
        resolved = open_resp["channel"]["id"]
        print(f"Resolved user {channel_id} → DM channel {resolved}")
        channel_id = resolved
    else:
        print(f"Warning: conversations.open failed for {channel_id}: {open_resp}", file=sys.stderr)

# Step 1 — get upload URL
resp = slack_post_form("files.getUploadURLExternal", {"filename": filename, "length": filesize}, token)
if not resp.get("ok"):
    print(f"Error getting upload URL: {resp}", file=sys.stderr)
    sys.exit(1)

upload_url = resp["upload_url"]
file_id    = resp["file_id"]

# Step 2 — upload file bytes
with open(file_path, "rb") as f:
    file_data = f.read()
req = urllib.request.Request(
    upload_url,
    data=file_data,
    headers={"Content-Type": "application/octet-stream"},
    method="POST",
)
try:
    with urllib.request.urlopen(req) as r:
        r.read()
except urllib.error.HTTPError as e:
    print(f"Error uploading file: {e.status} {e.read()}", file=sys.stderr)
    sys.exit(1)

# Step 3 — complete upload and share to channel
complete_payload = {"files": [{"id": file_id}], "channel_id": channel_id}
if text:
    complete_payload["initial_comment"] = text
if thread_ts:
    complete_payload["thread_ts"] = thread_ts

resp = slack_post_json("files.completeUploadExternal", complete_payload, token)
if not resp.get("ok"):
    print(f"Error completing upload: {resp}", file=sys.stderr)
    sys.exit(1)

print(f"Slack: file uploaded to channel {channel_id}" + (f" (thread {thread_ts})" if thread_ts else ""))
PYEOF
}

# ---------------------------------------------------------------------------
# iMessage
# ---------------------------------------------------------------------------
send_imessage() {
  local state_dir="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
  local imsg_script="$state_dir/scripts/imsg-ssh"

  if [[ ! -f "$imsg_script" ]]; then
    echo "Error: imsg-ssh script not found at $imsg_script" >&2
    exit 1
  fi

  local args=(send --to "$TO" --file "$FILE" --service imessage)
  if [[ -n "$TEXT" ]]; then
    args+=(--text "$TEXT")
  fi

  bash "$imsg_script" "${args[@]}"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$SERVICE" in
  slack)    send_slack    ;;
  imessage) send_imessage ;;
  *)
    echo "Error: unknown service '$SERVICE' — use 'slack' or 'imessage'" >&2
    exit 1
    ;;
esac
