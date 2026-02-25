#!/usr/bin/env node

import * as p from "@clack/prompts";

// ── Constants ────────────────────────────────────────────────────────────────

const DISCORD_API = "https://discord.com/api/v10";
const SLACK_API = "https://slack.com/api";

const RATE_LIMIT = { discord: 250, slack: 1200, discordBulk: 1000 };
const MAX_RETRIES = 5;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_SCAN = 1000;
const MAX_SCAN = 10_000;
const DISCORD_EPOCH = 1420070400000n;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertNotCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return value;
}

async function runConcurrent(items, fn, concurrency = DEFAULT_CONCURRENCY) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

async function fetchWithRateLimit(url, opts, platform) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, opts);

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const waitMs = retryAfter
        ? Math.ceil(parseFloat(retryAfter) * 1000)
        : (attempt + 1) * 2000;

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Rate limited after ${MAX_RETRIES} retries on ${platform}`);
    }

    return res;
  }
}

function snowflakeToTimestamp(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

// ── Discord ──────────────────────────────────────────────────────────────────

function discordHeaders(token, isBot) {
  return { Authorization: isBot ? `Bot ${token}` : token };
}

async function discordGetUser(token, isBot) {
  const res = await fetchWithRateLimit(
    `${DISCORD_API}/users/@me`,
    { headers: discordHeaders(token, isBot) },
    "discord",
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord auth failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function discordFetchMessages(token, isBot, channelId, maxScan, spinner, label) {
  const headers = discordHeaders(token, isBot);
  const messages = [];
  let before = undefined;
  let scanned = 0;

  while (scanned < maxScan) {
    const limit = Math.min(100, maxScan - scanned);
    let url = `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;

    const res = await fetchWithRateLimit(url, { headers }, "discord");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch messages from ${label} (${res.status}): ${body}`);
    }

    const batch = await res.json();
    if (batch.length === 0) break;

    messages.push(...batch);
    scanned += batch.length;
    before = batch[batch.length - 1].id;
    spinner.message(`${label}: scanned ${scanned} messages...`);

    await sleep(RATE_LIMIT.discord);
  }

  return messages;
}

async function discordFetchThreadIds(token, isBot, channelId, mainMessages) {
  const headers = discordHeaders(token, isBot);
  const threadIds = new Set();

  // Active threads from messages that have a thread property
  for (const msg of mainMessages) {
    if (msg.thread) threadIds.add(msg.thread.id);
  }

  // Archived public threads
  try {
    let hasMore = true;
    let before = undefined;
    while (hasMore) {
      let url = `${DISCORD_API}/channels/${channelId}/threads/archived/public?limit=100`;
      if (before) url += `&before=${before}`;
      const res = await fetchWithRateLimit(url, { headers }, "discord");
      if (res.ok) {
        const data = await res.json();
        for (const thread of data.threads || []) threadIds.add(thread.id);
        hasMore = data.has_more ?? false;
        const threads = data.threads || [];
        if (threads.length > 0) {
          before = threads[threads.length - 1].thread_metadata?.archive_timestamp;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
      await sleep(RATE_LIMIT.discord);
    }
  } catch {
    // Ignore — may lack permissions for archived threads
  }

  // Archived private threads
  try {
    let hasMore = true;
    let before = undefined;
    while (hasMore) {
      let url = `${DISCORD_API}/channels/${channelId}/threads/archived/private?limit=100`;
      if (before) url += `&before=${before}`;
      const res = await fetchWithRateLimit(url, { headers }, "discord");
      if (res.ok) {
        const data = await res.json();
        for (const thread of data.threads || []) threadIds.add(thread.id);
        hasMore = data.has_more ?? false;
        const threads = data.threads || [];
        if (threads.length > 0) {
          before = threads[threads.length - 1].thread_metadata?.archive_timestamp;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
      await sleep(RATE_LIMIT.discord);
    }
  } catch {
    // Ignore — may lack permissions
  }

  return [...threadIds];
}

async function discordDeleteFromChannel(token, isBot, channelId, botMessages, spinner, progressState, concurrency) {
  const headers = {
    ...discordHeaders(token, isBot),
    "Content-Type": "application/json",
  };

  const now = Date.now();
  const recent = [];
  const old = [];

  for (const msg of botMessages) {
    const ts = snowflakeToTimestamp(msg.id);
    if (now - ts < FOURTEEN_DAYS_MS) {
      recent.push(msg.id);
    } else {
      old.push(msg.id);
    }
  }

  const updateSpinner = () => {
    spinner.message(`Deleting: ${progressState.deleted + progressState.failed}/${progressState.total}`);
  };

  const deleteOne = async (id) => {
    const r = await fetchWithRateLimit(
      `${DISCORD_API}/channels/${channelId}/messages/${id}`,
      { method: "DELETE", headers },
      "discord",
    );
    if (r.ok || r.status === 404) {
      progressState.deleted++;
    } else {
      progressState.failed++;
      const key = `HTTP ${r.status}`;
      progressState.errors[key] = (progressState.errors[key] || 0) + 1;
    }
    updateSpinner();
    await sleep(RATE_LIMIT.discord);
  };

  if (isBot) {
    // Bulk delete recent messages (bot-only, batches of 100, min 2 messages)
    for (let i = 0; i < recent.length; i += 100) {
      const batch = recent.slice(i, i + 100);

      if (batch.length >= 2) {
        const res = await fetchWithRateLimit(
          `${DISCORD_API}/channels/${channelId}/messages/bulk-delete`,
          { method: "POST", headers, body: JSON.stringify({ messages: batch }) },
          "discord",
        );

        if (res.ok) {
          progressState.deleted += batch.length;
        } else {
          await runConcurrent(batch, deleteOne, concurrency);
        }

        updateSpinner();
        await sleep(RATE_LIMIT.discordBulk);
      } else {
        await runConcurrent(batch, deleteOne, concurrency);
      }
    }
  } else {
    // Personal accounts: individual delete for all recent messages
    await runConcurrent(recent, deleteOne, concurrency);
  }

  // Individual delete for old messages (>14 days)
  await runConcurrent(old, deleteOne, concurrency);
}

// ── Slack ────────────────────────────────────────────────────────────────────

async function slackGetUser(token) {
  const res = await fetchWithRateLimit(
    `${SLACK_API}/auth.test`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
    "slack",
  );
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack auth failed: ${data.error}`);
  return data;
}

async function slackFetchMessages(token, channelId, threadTs, maxScan, spinner, label) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const messages = [];
  let cursor = undefined;
  let scanned = 0;

  const endpoint = threadTs ? "conversations.replies" : "conversations.history";

  while (scanned < maxScan) {
    const limit = Math.min(200, maxScan - scanned);
    const params = new URLSearchParams({ channel: channelId, limit: String(limit) });
    if (threadTs) params.set("ts", threadTs);
    if (cursor) params.set("cursor", cursor);

    const res = await fetchWithRateLimit(
      `${SLACK_API}/${endpoint}`,
      { method: "POST", headers, body: params.toString() },
      "slack",
    );
    const data = await res.json();
    if (!data.ok) throw new Error(`Failed to fetch messages from ${label}: ${data.error}`);

    const batch = data.messages || [];
    messages.push(...batch);
    scanned += batch.length;
    spinner.message(`${label}: scanned ${scanned} messages...`);

    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;

    await sleep(RATE_LIMIT.slack);
  }

  return messages;
}

async function slackDeleteMessages(token, channelId, messages, spinner, concurrency) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let deleted = 0;
  let failed = 0;
  const total = messages.length;
  const errors = {};

  await runConcurrent(messages, async (msg) => {
    const res = await fetchWithRateLimit(
      `${SLACK_API}/chat.delete`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: channelId, ts: msg.ts }),
      },
      "slack",
    );
    const data = await res.json();
    if (data.ok) {
      deleted++;
    } else {
      failed++;
      const key = data.needed
        ? `${data.error} (needed: ${data.needed}, provided: ${data.provided || "none"})`
        : data.error;
      errors[key] = (errors[key] || 0) + 1;
    }

    spinner.message(`Deleting: ${deleted + failed}/${total}`);
    await sleep(RATE_LIMIT.slack);
  }, concurrency);

  return { deleted, failed, errors };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  p.intro("Bot Message Cleanup");

  // 1. Platform selection
  const platform = assertNotCancelled(
    await p.select({
      message: "Which platform?",
      options: [
        { value: "discord", label: "Discord" },
        { value: "slack", label: "Slack" },
      ],
    }),
  );

  // 2. Account type
  const accountType = assertNotCancelled(
    await p.select({
      message: "Account type?",
      options: [
        { value: "bot", label: "Bot account", hint: platform === "discord" ? "uses Bot token" : "xoxb- token" },
        { value: "personal", label: "Personal account", hint: platform === "discord" ? "uses user token from DevTools" : "xoxp- token" },
      ],
    }),
  );

  const isBot = accountType === "bot";

  // 3. Credentials & target
  let token, channelId, threadTs, includeThreads, discordTarget;

  if (platform === "discord") {
    token = assertNotCancelled(
      await p.password({
        message: isBot ? "Discord bot token:" : "Discord user token:",
        validate: (v) => {
          if (!v || v.trim().length === 0) return "Token is required";
        },
      }),
    );

    discordTarget = assertNotCancelled(
      await p.select({
        message: "What do you want to clean?",
        options: [
          { value: "channel", label: "Server channel", hint: "text channel in a server" },
          { value: "thread", label: "Thread", hint: "thread or forum post (pass its ID)" },
          { value: "dm", label: "DM channel", hint: "direct message conversation" },
        ],
      }),
    );

    const idLabel =
      discordTarget === "channel" ? "Channel ID" :
      discordTarget === "thread" ? "Thread ID" :
      "DM Channel ID";

    channelId = assertNotCancelled(
      await p.text({
        message: `${idLabel}:`,
        placeholder: "e.g. 1234567890123456789",
        validate: (v) => {
          if (!v || !/^\d{17,20}$/.test(v.trim())) return "Must be a 17-20 digit snowflake ID";
        },
      }),
    );
    channelId = channelId.trim();

    if (discordTarget === "channel") {
      includeThreads = assertNotCancelled(
        await p.confirm({ message: "Also scan and clean threads in this channel?", initialValue: false }),
      );
    }
  } else {
    // Slack
    const tokenPrefix = isBot ? "xoxb-" : "xoxp-";
    token = assertNotCancelled(
      await p.password({
        message: `Slack token (${tokenPrefix}...):`,
        validate: (v) => {
          if (!v || !v.trim().startsWith(tokenPrefix))
            return `Must start with ${tokenPrefix}`;
        },
      }),
    );

    channelId = assertNotCancelled(
      await p.text({
        message: "Channel or DM ID:",
        placeholder: "e.g. C01ABC23DEF or D01ABC23DEF",
        validate: (v) => {
          if (!v || !/^[CD][A-Z0-9]{8,}$/.test(v.trim()))
            return "Must start with C (channel) or D (DM) followed by alphanumeric chars";
        },
      }),
    );
    channelId = channelId.trim();

    const slackTarget = assertNotCancelled(
      await p.select({
        message: "What do you want to clean?",
        options: [
          { value: "channel", label: "Entire channel/DM", hint: "top-level messages" },
          { value: "thread", label: "Specific thread", hint: "replies in a single thread" },
        ],
      }),
    );

    if (slackTarget === "thread") {
      threadTs = assertNotCancelled(
        await p.text({
          message: "Thread timestamp (ts):",
          placeholder: "e.g. 1234567890.123456",
          validate: (v) => {
            if (!v || !/^\d+\.\d+$/.test(v.trim()))
              return "Must be a Slack timestamp (e.g. 1234567890.123456)";
          },
        }),
      );
      threadTs = threadTs.trim();
    } else {
      includeThreads = assertNotCancelled(
        await p.confirm({ message: "Also scan and clean thread replies?", initialValue: false }),
      );
    }
  }

  // 4. Scan limit
  const limitScan = assertNotCancelled(
    await p.confirm({ message: "Limit the number of messages to scan?", initialValue: false }),
  );

  let maxScan = DEFAULT_SCAN;
  if (limitScan) {
    const input = assertNotCancelled(
      await p.text({
        message: `Max messages to scan (up to ${MAX_SCAN}):`,
        placeholder: String(DEFAULT_SCAN),
        initialValue: String(DEFAULT_SCAN),
        validate: (v) => {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return "Must be a positive number";
          if (n > MAX_SCAN) return `Maximum is ${MAX_SCAN}`;
        },
      }),
    );
    maxScan = parseInt(input, 10);
  }

  // 5. Verify token
  const verifySpinner = p.spinner();
  verifySpinner.start("Verifying token...");

  let userId, userName;

  try {
    if (platform === "discord") {
      const user = await discordGetUser(token, isBot);
      userId = user.id;
      userName = user.global_name || user.username;
    } else {
      const auth = await slackGetUser(token);
      userId = auth.user_id;
      userName = auth.user;
    }
    verifySpinner.stop(`Authenticated as: ${userName} (${accountType})`);
  } catch (err) {
    verifySpinner.stop("Authentication failed");
    p.log.error(err.message);
    p.outro("Fix your token and try again.");
    process.exit(1);
  }

  // 6. Scan messages
  const scanSpinner = p.spinner();
  scanSpinner.start("Scanning messages...");

  // Discord: Map<channelOrThreadId, botMessages[]>
  // Slack:   flat array of messages (all deleted via same channel ID)
  let discordMessagesByChannel; // Map
  let slackMessages; // Array
  let totalScanned = 0;
  let totalFound = 0;
  let threadCount = 0;

  try {
    if (platform === "discord") {
      discordMessagesByChannel = new Map();

      // Scan main channel / thread / DM
      const label = discordTarget === "thread" ? "Thread" : discordTarget === "dm" ? "DM" : "Channel";
      const mainMessages = await discordFetchMessages(token, isBot, channelId, maxScan, scanSpinner, label);
      totalScanned += mainMessages.length;

      const myMsgs = mainMessages.filter((m) => m.author?.id === userId);
      if (myMsgs.length > 0) {
        discordMessagesByChannel.set(channelId, myMsgs);
      }

      // Discover and scan threads if requested
      if (includeThreads && discordTarget === "channel") {
        scanSpinner.message("Discovering threads...");
        const threadIds = await discordFetchThreadIds(token, isBot, channelId, mainMessages);
        threadCount = threadIds.length;

        if (threadIds.length > 0) {
          scanSpinner.message(`Found ${threadIds.length} threads, scanning...`);
        }

        for (let i = 0; i < threadIds.length; i++) {
          const tid = threadIds[i];
          const threadLabel = `Thread ${i + 1}/${threadIds.length}`;
          const threadMsgs = await discordFetchMessages(token, isBot, tid, maxScan, scanSpinner, threadLabel);
          totalScanned += threadMsgs.length;

          const threadMyMsgs = threadMsgs.filter((m) => m.author?.id === userId);
          if (threadMyMsgs.length > 0) {
            discordMessagesByChannel.set(tid, threadMyMsgs);
          }
        }
      }

      for (const msgs of discordMessagesByChannel.values()) {
        totalFound += msgs.length;
      }
    } else {
      // Slack
      const label = threadTs ? "Thread" : "Channel";
      const mainMessages = await slackFetchMessages(token, channelId, threadTs, maxScan, scanSpinner, label);
      totalScanned += mainMessages.length;

      const myMsgs = mainMessages.filter((m) => m.user === userId || m.bot_id === userId);

      // Scan thread replies if requested
      if (includeThreads && !threadTs) {
        const threadParents = mainMessages.filter(
          (m) => m.reply_count > 0 || (m.thread_ts && m.thread_ts === m.ts),
        );
        threadCount = threadParents.length;

        if (threadParents.length > 0) {
          scanSpinner.message(`Found ${threadParents.length} threads, scanning replies...`);
        }

        const seenTs = new Set(mainMessages.map((m) => m.ts));

        for (let i = 0; i < threadParents.length; i++) {
          const parent = threadParents[i];
          const threadLabel = `Thread ${i + 1}/${threadParents.length}`;
          const replies = await slackFetchMessages(
            token, channelId, parent.ts, maxScan, scanSpinner, threadLabel,
          );
          totalScanned += replies.length;

          for (const reply of replies) {
            if (!seenTs.has(reply.ts) && (reply.user === userId || reply.bot_id === userId)) {
              myMsgs.push(reply);
              seenTs.add(reply.ts);
            }
          }
        }
      }

      slackMessages = myMsgs;
      totalFound = myMsgs.length;
    }
  } catch (err) {
    scanSpinner.stop("Scan failed");
    p.log.error(err.message);
    p.outro("Could not scan messages.");
    process.exit(1);
  }

  const threadInfo = threadCount > 0 ? ` (+ ${threadCount} threads)` : "";
  scanSpinner.stop(
    `Scanned ${totalScanned} messages${threadInfo}, found ${totalFound} from ${userName}`,
  );

  if (totalFound === 0) {
    p.outro("Nothing to clean — no matching messages found.");
    process.exit(0);
  }

  // 7. Summary
  const targetLabel =
    platform === "discord"
      ? discordTarget === "dm" ? "DM" : discordTarget === "thread" ? "Thread" : "Channel"
      : threadTs ? "Thread" : channelId.startsWith("D") ? "DM" : "Channel";

  p.note(
    [
      `Platform:  ${platform}`,
      `Account:   ${userName} (${accountType})`,
      `Target:    ${targetLabel}`,
      `${targetLabel} ID: ${channelId}`,
      threadTs ? `Thread ts: ${threadTs}` : null,
      includeThreads && threadCount > 0 ? `Threads:   ${threadCount} scanned` : null,
      `Found:     ${totalFound} messages to delete`,
    ]
      .filter(Boolean)
      .join("\n"),
    "Scan Summary",
  );

  // 8. Confirm deletion
  const proceed = assertNotCancelled(
    await p.confirm({
      message: `Delete ${totalFound} messages? This cannot be undone.`,
      initialValue: false,
    }),
  );

  if (!proceed) {
    p.outro("Aborted — no messages were deleted.");
    process.exit(0);
  }

  // 9. Delete
  const deleteSpinner = p.spinner();
  deleteSpinner.start(`Deleting messages (concurrency: ${DEFAULT_CONCURRENCY})...`);

  let result;

  try {
    if (platform === "discord") {
      const progress = { deleted: 0, failed: 0, total: totalFound, errors: {} };

      for (const [chId, msgs] of discordMessagesByChannel) {
        await discordDeleteFromChannel(token, isBot, chId, msgs, deleteSpinner, progress, DEFAULT_CONCURRENCY);
      }

      result = { deleted: progress.deleted, failed: progress.failed, errors: progress.errors };
    } else {
      result = await slackDeleteMessages(token, channelId, slackMessages, deleteSpinner, DEFAULT_CONCURRENCY);
    }
  } catch (err) {
    deleteSpinner.stop("Deletion encountered an error");
    p.log.error(err.message);
    p.outro("Deletion did not complete successfully.");
    process.exit(1);
  }

  deleteSpinner.stop("Deletion complete");

  // 10. Summary
  if (result.failed > 0 && result.errors && Object.keys(result.errors).length > 0) {
    const errorDetails = Object.entries(result.errors)
      .map(([reason, count]) => `  ${reason}: ${count}`)
      .join("\n");
    p.log.error(`Failed to delete ${result.failed} messages:\n${errorDetails}`);
  }

  p.outro(`Done! Deleted: ${result.deleted}, Failed: ${result.failed}`);
}

// ── Entry ────────────────────────────────────────────────────────────────────

process.on("SIGINT", () => {
  p.cancel("Operation cancelled.");
  process.exit(0);
});

main().catch((err) => {
  p.log.error(err.message);
  process.exit(1);
});
