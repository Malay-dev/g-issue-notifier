import { resolveUser, isAuthorized } from "../lib/resolveUser.js";
import { sendMessage, buildIssueMessage } from "../lib/telegram.js";

export default {
  async fetch(request, env) {
    // Dispatcher is cron-only, not meant to be called via HTTP
    return new Response("Dispatcher is running on schedule.", { status: 200 });
  },

  async queue(batch, env) {
    console.log(
      `[dispatcher] Processing batch with ${batch.messages.length} messages`,
    );
    for (const message of batch.messages) {
      try {
        console.log(
          `[dispatcher] Processing message, repo: ${message.body.repo}`,
        );
        await handleIssueEvent(message.body, env);
        console.log(`[dispatcher] Message acknowledged`);
        message.ack(); // confirm processed
      } catch (err) {
        console.error("[dispatcher] Dispatcher error:", err);
        console.log(`[dispatcher] Retrying message`);
        message.retry(); // put back in queue
      }
    }
  },
};

async function handleIssueEvent(event, env) {
  const { repo, issue, action, triggerLabel } = event;
  console.log(
    `[handleIssueEvent] Processing ${action} for ${repo}#${issue.number} by @${issue.user.login}`,
  );

  // ── Find all active subscriptions for this repo ───────────────
  const subs = await env.DB.prepare(
    `
      SELECT s.id, s.user_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.repo = ?
        AND s.is_active = TRUE
        AND u.is_active = TRUE
    `,
  )
    .bind(repo)
    .all();
  console.log(
    `[handleIssueEvent] Found ${subs.results?.length || 0} active subscriptions for ${repo}`,
  );

  // ── In single tenant mode there are no users rows ─────────────
  // ── so we manually resolve the one owner ─────────────────────
  let recipients = [];

  if (env.MULTI_TENANT === "false") {
    console.log(
      `[handleIssueEvent] Single tenant mode, checking owner subscription`,
    );
    // Check if owner has a subscription for this repo
    const ownerSub = await env.DB.prepare(
      `
        SELECT id FROM subscriptions
        WHERE user_id = ? AND repo = ? AND is_active = TRUE
      `,
    )
      .bind(env.OWNER_ID, repo)
      .first();

    if (!ownerSub) {
      console.log(
        `[handleIssueEvent] Owner not subscribed to ${repo}, skipping`,
      );
      return;
    } // owner not subscribed to this repo
    console.log(`[handleIssueEvent] Owner subscription found`);

    recipients = [
      {
        sub_id: ownerSub.id,
        user_id: env.OWNER_ID,
        chat_id: Number(env.OWNER_CHAT_ID),
        gh_username: env.OWNER_GH_USER,
        gh_pat: env.GH_PAT,
      },
    ];
  } else {
    // Multi tenant — build recipients from D1 join results
    recipients = await Promise.all(
      subs.results.map(async (sub) => {
        const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
          .bind(sub.user_id)
          .first();
        return { ...user, sub_id: sub.id };
      }),
    );
  }

  // ── For each recipient, check label filters then notify ───────
  for (const recipient of recipients) {
    console.log(
      `[handleIssueEvent] Checking label filter for user ${recipient.user_id}`,
    );
    const shouldNotify = await checkLabelFilter(
      env,
      recipient.sub_id,
      issue.labels?.map((l) => l.name) || [],
      triggerLabel,
    );

    if (!shouldNotify) {
      console.log(
        `[handleIssueEvent] Label filter failed for user ${recipient.user_id}, skipping`,
      );
      continue;
    }
    console.log(`[handleIssueEvent] Notifying user ${recipient.user_id}`);

    // ── Format and send Telegram message ─────────────────────────
    const watchingLabels = await getWatchingLabels(env, recipient.sub_id);
    const text = buildIssueMessage(issue, repo, watchingLabels);

    // ── Inline buttons ────────────────────────────────────────────
    const inline_keyboard = [
      [
        {
          text: "Claim Issue",
          callback_data: `claim:${repo}:${issue.number}`,
        },
        {
          text: "Open on GitHub",
          url: issue.html_url,
        },
      ],
    ];

    await sendMessage(env.BOT_TOKEN, recipient.chat_id, text, {
      reply_markup: { inline_keyboard },
    });

    // ── Store claim context in KV for 7 days ──────────────────────
    await env.CLAIM_CTX.put(
      `claim:${repo}:${issue.number}`,
      JSON.stringify({
        repo,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_url: issue.html_url,
        user_id: recipient.user_id,
        chat_id: recipient.chat_id,
      }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
  }
}

// ── Check if this issue matches the user's label filters ─────────
// If user has no filters → notify on everything
// If user has filters → only notify if issue has at least one match
async function checkLabelFilter(env, sub_id, issueLabels, triggerLabel) {
  const filters = await env.DB.prepare(
    `SELECT label FROM label_filters WHERE subscription_id = ?`,
  )
    .bind(sub_id)
    .all();

  if (filters.results.length === 0) return true; // no filter = all labels

  const watchList = filters.results.map((f) => f.label.toLowerCase());
  const candidates = [
    ...issueLabels.map((l) => l.toLowerCase()),
    triggerLabel?.toLowerCase(),
  ].filter(Boolean);

  return candidates.some((l) => watchList.includes(l));
}

// ── Get labels user is watching for this subscription ────────────
async function getWatchingLabels(env, sub_id) {
  const filters = await env.DB.prepare(
    `SELECT label FROM label_filters WHERE subscription_id = ?`,
  )
    .bind(sub_id)
    .all();
  return filters.results.map((f) => f.label);
}
