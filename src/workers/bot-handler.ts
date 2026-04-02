import {
  Env,
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
} from "../types/index.js";
import { isAuthorized, resolveUser } from "../lib/resolveUser.js";
import { sendMessage, answerCallbackQuery } from "../lib/telegram.js";
import { postComment } from "../lib/github.js";
import { generateId } from "../lib/utils.js";
import { Logger, LoggerLike } from "../lib/logger.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const logger = new Logger("bot-handler", env.LOG_LEVEL ?? "info");
    logger.info("Incoming request", { method: request.method });
    if (request.method !== "POST") {
      logger.info("Non-POST request, returning OK");
      return new Response("OK", { status: 200 });
    }

    const update = (await request.json()) as TelegramUpdate;
    logger.info("Received update", {
      type: update.message
        ? "message"
        : update.callback_query
          ? "callback_query"
          : "unknown",
    });

    // ── Route to correct handler ──────────────────────────────────
    if (update.message) {
      logger.info("Routing to handleMessage", {
        chat_id: update.message.chat.id,
      });
      return handleMessage(update.message, env, logger);
    }

    if (update.callback_query) {
      logger.info("Routing to handleCallback", {
        data: update.callback_query.data,
      });
      return handleCallback(update.callback_query, env, logger);
    }

    logger.info("Unknown update type, returning OK");

    return new Response("OK", { status: 200 });
  },
};

// ─────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────
async function handleMessage(
  message: TelegramMessage,
  env: Env,
  logger: LoggerLike,
): Promise<Response> {
  const chat_id = message.chat.id;
  const text = message.text || "";
  logger.info("Processing message", {
    chat_id,
    excerpt: `${text.substring(0, 50)}${text.length > 50 ? "..." : ""}`,
  });

  // ── Auth check ────────────────────────────────────────────────
  if (!isAuthorized(env, chat_id)) {
    logger.warn("Unauthorized chat_id", { chat_id });
    return new Response("OK", { status: 200 });
  }
  logger.info("Authorization passed", { chat_id });

  // ── Check if user is in a session (e.g. awaiting custom text) ─
  const sessionRaw = await env.SESSION.get(`session:${chat_id}`);
  const session = sessionRaw ? JSON.parse(sessionRaw) : null;

  if (session?.step === "awaiting_custom_comment") {
    return handleCustomComment(chat_id, text, session, env);
  }

  if (session?.step === "awaiting_template_name") {
    return handleNewTemplateName(chat_id, text, session, env);
  }

  if (session?.step === "awaiting_template_body") {
    return handleNewTemplateBody(chat_id, text, session, env);
  }

  if (session?.step === "awaiting_label_input") {
    return handleLabelInput(chat_id, text, session, env);
  }

  // ── Command routing ───────────────────────────────────────────
  if (text.startsWith("/start")) {
    return cmdStart(chat_id, env);
  }

  if (text.startsWith("/subscribe")) {
    return cmdSubscribe(chat_id, text, env);
  }

  if (text.startsWith("/unsubscribe")) {
    return cmdUnsubscribe(chat_id, env);
  }

  if (text.startsWith("/subscriptions")) {
    return cmdListSubscriptions(chat_id, env);
  }

  if (text.startsWith("/templates")) {
    return cmdTemplates(chat_id, env);
  }

  if (text.startsWith("/newtemplate")) {
    return cmdNewTemplate(chat_id, env);
  }

  if (text.startsWith("/help")) {
    return cmdHelp(chat_id, env);
  }

  if (text.startsWith("/setinterval")) {
    return cmdSetInterval(chat_id, text, env);
  }

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    "Unknown command. Send /help to see available commands.",
  );
  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// CALLBACK HANDLER (inline button taps)
// ─────────────────────────────────────────────────────────────────
async function handleCallback(
  query: TelegramCallbackQuery,
  env: Env,
  logger: LoggerLike,
): Promise<Response> {
  const chat_id = query.message.chat.id;
  const data = query.data ?? "";

  logger.info("Handling callback", { chat_id, data });

  if (!isAuthorized(env, chat_id)) {
    return new Response("OK", { status: 200 });
  }

  await answerCallbackQuery(env.BOT_TOKEN, query.id);

  // claim:owner/repo:123
  if (data.startsWith("claim:")) {
    return handleClaimStart(chat_id, data, env);
  }

  // use_template:owner/repo:123
  if (data.startsWith("use_template:")) {
    return handleShowTemplates(chat_id, data, env);
  }

  // write_custom:owner/repo:123
  if (data.startsWith("write_custom:")) {
    return handleWriteCustom(chat_id, data, env);
  }

  // pick_template:{template_id}:{repo}:{issue_number}
  if (data.startsWith("pick_template:")) {
    return handlePickTemplate(chat_id, data, env);
  }

  // unsub:{subscription_id}
  if (data.startsWith("unsub:")) {
    return handleUnsubConfirm(chat_id, data, env);
  }

  // del_template:{template_id}
  if (data.startsWith("del_template:")) {
    return handleDeleteTemplate(chat_id, data, env);
  }

  // label_toggle:{sub_id}:{label} — during subscribe label picker
  if (data.startsWith("label_toggle:")) {
    return handleLabelToggle(chat_id, data, query.message, env);
  }

  // label_done:{sub_id}
  if (data.startsWith("label_done:")) {
    return handleLabelDone(chat_id, data, env);
  }

  // setinterval:{sub_id}:{minutes}
  if (data.startsWith("setinterval:")) {
    return handleSetIntervalConfirm(chat_id, data, env);
  }

  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────────
async function cmdStart(chat_id: number, env: Env): Promise<Response> {
  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `👋 <b>Welcome to Issue Notifier!</b>\n\n` +
      `I'll notify you when issues are opened on GitHub repos you watch.\n\n` +
      `<b>Commands:</b>\n` +
      `/subscribe owner/repo — watch a repo\n` +
      `/unsubscribe — remove a subscription\n` +
      `/subscriptions — list active subscriptions\n` +
      `/templates — manage reply templates\n` +
      `/newtemplate — create a new template\n` +
      `/setinterval [mins] — set how often to check for new issues (default: 10)\n` +
      `/help — show this message`,
  );
  return new Response("OK", { status: 200 });
}

async function cmdHelp(chat_id: number, env: Env): Promise<Response> {
  return cmdStart(chat_id, env);
}

async function cmdSubscribe(
  chat_id: number,
  text: string,
  env: Env,
): Promise<Response> {
  const parts = text.trim().split(/\s+/);
  const repo = parts[1];

  if (!repo || !repo.includes("/")) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "Usage: /subscribe owner/repo\nExample: /subscribe torvalds/linux",
    );
    return new Response("OK", { status: 200 });
  }

  const user = await resolveUser(env, chat_id);

  // ── Upsert subscription ───────────────────────────────────────
  const existing = await env.DB.prepare(
    `SELECT id, is_active FROM subscriptions WHERE user_id = ? AND repo = ?`,
  )
    .bind(user.id, repo)
    .first();

  let sub_id;

  if (existing) {
    sub_id = existing.id;
    if (existing.is_active) {
      await sendMessage(
        env.BOT_TOKEN,
        chat_id,
        `You're already subscribed to <code>${repo}</code>.\n\nUse /unsubscribe to manage subscriptions.`,
      );
      return new Response("OK", { status: 200 });
    }
    // Reactivate
    await env.DB.prepare(
      `UPDATE subscriptions SET is_active = TRUE WHERE id = ?`,
    )
      .bind(sub_id)
      .run();
  } else {
    sub_id = generateId();
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, repo) VALUES (?, ?, ?)`,
    )
      .bind(sub_id, user.id, repo)
      .run();
  }

  // ── Ask for label filters ─────────────────────────────────────
  // Store pending sub in SESSION so label picker knows which sub
  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({ step: "picking_labels", sub_id, repo, selected: [] }),
    { expirationTtl: 600 },
  );

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `Subscribed to <code>${repo}</code>!\n\n` +
      `<b>Which labels do you want to watch?</b>\n` +
      `Type label names one by one, then tap <b>Done</b> when finished.\n` +
      `Or tap Done now to receive notifications for <b>all labels</b>.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Done — notify on all labels",
              callback_data: `label_done:${sub_id}`,
            },
          ],
        ],
      },
    },
  );

  // ── Also listen for text input for labels ─────────────────────
  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({
      step: "awaiting_label_input",
      sub_id,
      repo,
      selected: [],
    }),
    { expirationTtl: 600 },
  );

  return new Response("OK", { status: 200 });
}

async function cmdUnsubscribe(chat_id: number, env: Env): Promise<Response> {
  const user = await resolveUser(env, chat_id);

  const subs = await env.DB.prepare(
    `SELECT id, repo FROM subscriptions WHERE user_id = ? AND is_active = TRUE`,
  )
    .bind(user.id)
    .all();

  if (subs.results.length === 0) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "You have no active subscriptions.",
    );
    return new Response("OK", { status: 200 });
  }

  const inline_keyboard = subs.results.map((s) => [
    {
      text: `${s.repo}`,
      callback_data: `unsub:${s.id}`,
    },
  ]);

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    "Select a subscription to remove:",
    { reply_markup: { inline_keyboard } },
  );

  return new Response("OK", { status: 200 });
}

async function cmdListSubscriptions(
  chat_id: number,
  env: Env,
): Promise<Response> {
  const user = await resolveUser(env, chat_id);

  const subs = await env.DB.prepare(
    `SELECT id, repo FROM subscriptions WHERE user_id = ? AND is_active = TRUE`,
  )
    .bind(user.id)
    .all();

  if (subs.results.length === 0) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "No active subscriptions.\n\nUse /subscribe owner/repo to add one.",
    );
    return new Response("OK", { status: 200 });
  }

  const lines = await Promise.all(
    subs.results.map(async (s) => {
      const labels = await env.DB.prepare(
        `SELECT label FROM label_filters WHERE subscription_id = ?`,
      )
        .bind(s.id)
        .all();
      const labelList = labels.results.length
        ? labels.results.map((l) => l.label).join(", ")
        : "all labels";
      return `• <code>${s.repo}</code> — watching: ${labelList}`;
    }),
  );

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>Active Subscriptions:</b>\n\n${lines.join("\n")}`,
  );

  return new Response("OK", { status: 200 });
}

async function cmdTemplates(chat_id: number, env: Env): Promise<Response> {
  const user = await resolveUser(env, chat_id);

  const templates = await env.DB.prepare(
    `SELECT * FROM templates WHERE user_id = ? ORDER BY created_at`,
  )
    .bind(user.id)
    .all();

  if (templates.results.length === 0) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "No templates yet.\n\nUse /newtemplate to create one.",
    );
    return new Response("OK", { status: 200 });
  }

  const inline_keyboard = templates.results.map((t) => [
    { text: `🗑 ${t.name}`, callback_data: `del_template:${t.id}` },
  ]);

  const lines = templates.results
    .map((t) => `<b>${t.name}</b>\n<i>${t.body}</i>`)
    .join("\n\n");

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>Your Templates:</b>\n\n${lines}\n\nTap a template name to delete it.`,
    { reply_markup: { inline_keyboard } },
  );

  return new Response("OK", { status: 200 });
}

async function cmdNewTemplate(chat_id: number, env: Env): Promise<Response> {
  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({ step: "awaiting_template_name" }),
    { expirationTtl: 600 },
  );

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    "What do you want to call this template?\n\nSend the <b>name</b> e.g. <i>I'll take this</i>",
  );

  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// CLAIM FLOW
// ─────────────────────────────────────────────────────────────────
async function handleClaimStart(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  // data = "claim:owner/repo:123"
  const parts = data.split(":");
  const repo = `${parts[1]}/${parts[2]}`;
  const issueNumber = parts[3];

  const inline_keyboard = [
    [
      {
        text: "📋 Use Template",
        callback_data: `use_template:${repo}:${issueNumber}`,
      },
      {
        text: "✍️ Write Custom",
        callback_data: `write_custom:${repo}:${issueNumber}`,
      },
    ],
  ];

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>Claim Issue #${issueNumber}</b>\n\nHow do you want to respond?`,
    { reply_markup: { inline_keyboard } },
  );

  return new Response("OK", { status: 200 });
}

async function handleShowTemplates(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  // data = "use_template:owner/repo:123"
  const parts = data.split(":");
  const repo = `${parts[1]}/${parts[2]}`;
  const issueNumber = parts[3];

  const user = await resolveUser(env, chat_id);

  const templates = await env.DB.prepare(
    `SELECT * FROM templates WHERE user_id = ? ORDER BY created_at`,
  )
    .bind(user.id)
    .all();

  if (templates.results.length === 0) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "You have no templates yet. Use /newtemplate to create one.\n\nOr tap Write Custom to type a comment now.",
    );
    return new Response("OK", { status: 200 });
  }

  const inline_keyboard = templates.results.map((t) => [
    {
      text: t.name,
      callback_data: `pick_template:${t.id}:${repo}:${issueNumber}`,
    },
  ]);

  await sendMessage(env.BOT_TOKEN, chat_id, "Choose a template:", {
    reply_markup: { inline_keyboard },
  });

  return new Response("OK", { status: 200 });
}

async function handleWriteCustom(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  // data = "write_custom:owner/repo:123"
  const parts = data.split(":");
  const repo = `${parts[1]}/${parts[2]}`;
  const issueNumber = parts[3];

  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({
      step: "awaiting_custom_comment",
      repo,
      issue_number: issueNumber,
    }),
    { expirationTtl: 600 },
  );

  await sendMessage(env.BOT_TOKEN, chat_id, "Type your comment and send it:");

  return new Response("OK", { status: 200 });
}

async function handlePickTemplate(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  // data = "pick_template:{template_id}:{repo}:{issue_number}"
  const parts = data.split(":");
  const template_id = parts[1];
  const repo = `${parts[2]}/${parts[3]}`;
  const issueNumber = parts[4];

  const template = (await env.DB.prepare(`SELECT * FROM templates WHERE id = ?`)
    .bind(template_id)
    .first()) as ({ body: string } & { id: string }) | undefined;

  if (!template) {
    await sendMessage(env.BOT_TOKEN, chat_id, "Template not found.");
    return new Response("OK", { status: 200 });
  }

  await postAndConfirm(
    chat_id,
    repo,
    Number(issueNumber),
    template.body,
    template_id ?? null,
    env,
  );
  return new Response("OK", { status: 200 });
}

async function handleCustomComment(
  chat_id: number,
  text: string,
  session: any,
  env: Env,
): Promise<Response> {
  const { repo, issue_number } = session;
  await env.SESSION.delete(`session:${chat_id}`);
  await postAndConfirm(chat_id, repo, Number(issue_number), text, null, env);
  return new Response("OK", { status: 200 });
}

async function postAndConfirm(
  chat_id: number,
  repo: string,
  issueNumber: string | number,
  body: string,
  _template_id: string | null,
  env: Env,
): Promise<Response> {
  const user = await resolveUser(env, chat_id);

  // Post comment to GitHub as you (PAT)
  const comment = await postComment(user.gh_pat, repo, issueNumber, body);

  if (comment.id) {
    // Save to claims table
    const claim_id = generateId();
    const user_obj = await resolveUser(env, chat_id);

    const sub = await env.DB.prepare(
      `SELECT id FROM subscriptions WHERE user_id = ? AND repo = ?`,
    )
      .bind(user_obj.id, repo)
      .first();

    if (sub) {
      await env.DB.prepare(
        `
          INSERT INTO claims (id, user_id, subscription_id, repo, issue_number, gh_comment_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
        .bind(
          claim_id,
          user_obj.id,
          sub.id,
          repo,
          Number(issueNumber),
          comment.id,
        )
        .run();
    }

    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      `<b>Comment posted on #${issueNumber}</b>\n\n` +
        `<i>${body}</i>\n\n` +
        `<a href="${comment.html_url}">View on GitHub</a>`,
    );
  } else {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      `Failed to post comment. GitHub said: ${comment.message || "unknown error"}`,
    );
  }

  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// TEMPLATE CRUD
// ─────────────────────────────────────────────────────────────────
async function handleNewTemplateName(
  chat_id: number,
  text: string,
  _session: any,
  env: Env,
): Promise<Response> {
  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({ step: "awaiting_template_body", name: text.trim() }),
    { expirationTtl: 600 },
  );

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `Got it — <b>${text.trim()}</b>\n\nNow send the <b>body</b> of the comment:`,
  );

  return new Response("OK", { status: 200 });
}

async function handleNewTemplateBody(
  chat_id: number,
  text: string,
  _session: any,
  env: Env,
): Promise<Response> {
  const user = await resolveUser(env, chat_id);
  await env.SESSION.delete(`session:${chat_id}`);

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO templates (id, user_id, name, body) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, user.id, _session.name, text.trim())
    .run();

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>Template <b>${_session.name}</b> saved!</b>\n\nUse /templates to view all templates.`,
  );

  return new Response("OK", { status: 200 });
}

async function handleDeleteTemplate(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  const template_id = data.split(":")[1];

  await env.DB.prepare(`DELETE FROM templates WHERE id = ?`)
    .bind(template_id)
    .run();

  await sendMessage(env.BOT_TOKEN, chat_id, "🗑 Template deleted.");
  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// SUBSCRIPTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────
async function handleUnsubConfirm(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  const sub_id = data.split(":")[1];

  await env.DB.prepare(
    `UPDATE subscriptions SET is_active = FALSE WHERE id = ?`,
  )
    .bind(sub_id)
    .run();

  await sendMessage(env.BOT_TOKEN, chat_id, "Unsubscribed successfully.");
  return new Response("OK", { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// LABEL PICKER (during /subscribe flow)
// ─────────────────────────────────────────────────────────────────
async function handleLabelToggle(
  _chat_id: number,
  data: string,
  message: TelegramMessage,
  env: Env,
): Promise<Response> {
  // label_toggle:{sub_id}:{label}
  const parts = data.split(":");
  const sub_id = parts[1];
  const label = parts.slice(2).join(":");

  const id = generateId();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO label_filters (id, subscription_id, user_id, label) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, sub_id, env.OWNER_ID, label)
    .run();

  await answerCallbackQuery(env.BOT_TOKEN, message.message_id.toString());
  return new Response("OK", { status: 200 });
}

async function handleLabelDone(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  const sub_id = data.split(":")[1];
  await env.SESSION.delete(`session:${chat_id}`);

  const labels = await env.DB.prepare(
    `SELECT label FROM label_filters WHERE subscription_id = ?`,
  )
    .bind(sub_id)
    .all();

  const labelList = labels.results.length
    ? labels.results.map((l) => l.label).join(", ")
    : "all labels";

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>All set!</b>\n\nWatching: <b>${labelList}</b>\n\nI'll notify you when matching issues are opened.`,
  );

  return new Response("OK", { status: 200 });
}

async function handleLabelInput(
  chat_id: number,
  text: string,
  session: any,
  env: Env,
): Promise<Response> {
  const { sub_id, repo, selected } = session;
  const label = text.trim().toLowerCase();

  // Save label to DB
  const id = generateId();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO label_filters (id, subscription_id, user_id, label) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, sub_id, env.OWNER_ID, label)
    .run();

  selected.push(label);

  // Update session with new selected list
  await env.SESSION.put(
    `session:${chat_id}`,
    JSON.stringify({ step: "awaiting_label_input", sub_id, repo, selected }),
    { expirationTtl: 600 },
  );

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `Added label: <b>${label}</b>\n\nCurrent filters: ${selected.join(", ")}\n\nSend another label or tap Done.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Done", callback_data: `label_done:${sub_id}` }],
        ],
      },
    },
  );

  return new Response("OK", { status: 200 });
}

async function cmdSetInterval(
  chat_id: number,
  text: string,
  env: Env,
): Promise<Response> {
  const user = await resolveUser(env, chat_id);
  const parts = text.trim().split(/\s+/);
  const minutes = parseInt(parts[1] ?? "0", 10);

  // If interval provided directly
  if (minutes && minutes >= 5 && minutes <= 1440) {
    // If only one subscription, set it directly
    const subs = await env.DB.prepare(
      `SELECT id, repo FROM subscriptions WHERE user_id = ? AND is_active = TRUE`,
    )
      .bind(user.id)
      .all();

    if (subs.results.length === 0) {
      await sendMessage(
        env.BOT_TOKEN,
        chat_id,
        "You have no active subscriptions. Use /subscribe first.",
      );
      return new Response("OK", { status: 200 });
    }

    if (subs.results.length === 1) {
      const firstSub = subs.results[0];
      if (!firstSub) {
        await sendMessage(
          env.BOT_TOKEN,
          chat_id,
          "Unexpected error finding subscription.",
        );
        return new Response("OK", { status: 200 });
      }

      await env.DB.prepare(
        `UPDATE subscriptions SET poll_interval = ? WHERE id = ?`,
      )
        .bind(minutes, firstSub.id)
        .run();

      await sendMessage(
        env.BOT_TOKEN,
        chat_id,
        `✅ Poll interval for <code>${firstSub.repo}</code> set to <b>${minutes} minutes</b>.`,
      );
      return new Response("OK", { status: 200 });
    }

    // Multiple subs — ask which one
    const inline_keyboard = subs.results.map((s) => [
      {
        text: s.repo,
        callback_data: `setinterval:${s.id}:${minutes}`,
      },
    ]);

    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      `Which subscription do you want to set to <b>${minutes} minutes</b>?`,
      { reply_markup: { inline_keyboard } },
    );
    return new Response("OK", { status: 200 });
  }

  // No interval provided — show current intervals
  const subs = await env.DB.prepare(
    `SELECT id, repo, poll_interval FROM subscriptions WHERE user_id = ? AND is_active = TRUE`,
  )
    .bind(user.id)
    .all();

  if (subs.results.length === 0) {
    await sendMessage(
      env.BOT_TOKEN,
      chat_id,
      "You have no active subscriptions. Use /subscribe first.",
    );
    return new Response("OK", { status: 200 });
  }

  const lines = subs.results
    .map(
      (s) => `• <code>${s.repo}</code> — every <b>${s.poll_interval} mins</b>`,
    )
    .join("\n");

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `<b>Current Poll Intervals:</b>\n\n${lines}\n\n` +
      `To change: /setinterval 15\n` +
      `<i>Min: 5 mins — Max: 1440 mins (24hrs)</i>`,
  );

  return new Response("OK", { status: 200 });
}

async function handleSetIntervalConfirm(
  chat_id: number,
  data: string,
  env: Env,
): Promise<Response> {
  const parts = data.split(":");
  const sub_id = parts[1];
  const minutes = parseInt(parts[2] ?? "0", 10);

  const sub = await env.DB.prepare(
    `SELECT repo FROM subscriptions WHERE id = ?`,
  )
    .bind(sub_id)
    .first();

  if (!sub) {
    await sendMessage(env.BOT_TOKEN, chat_id, "Subscription not found.");
    return new Response("OK", { status: 200 });
  }

  await env.DB.prepare(
    `UPDATE subscriptions SET poll_interval = ? WHERE id = ?`,
  )
    .bind(minutes, sub_id)
    .run();

  await sendMessage(
    env.BOT_TOKEN,
    chat_id,
    `✅ Poll interval for <code>${sub.repo}</code> set to <b>${minutes} minutes</b>.`,
  );

  return new Response("OK", { status: 200 });
}
