import { Env, IssueQueueMessage } from "../types/index.js";
import { sendMessage, buildIssueMessage } from "../lib/telegram.js";
import { Logger, LoggerLike } from "../lib/logger.js";

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // Dispatcher is cron-only, not meant to be called via HTTP
    return new Response("Dispatcher is running on schedule.", { status: 200 });
  },

  async queue(batch: MessageBatch<IssueQueueMessage>, env: Env): Promise<void> {
    const logger = new Logger("dispatcher", env.LOG_LEVEL ?? "info");
    logger.info("Processing batch", { messageCount: batch.messages.length });

    for (const message of batch.messages) {
      const messageLogger = logger.child({ repo: message.body.repo });
      try {
        messageLogger.info("Processing message", {
          action: message.body.action,
        });
        await handleIssueEvent(message.body, env, messageLogger);
        messageLogger.info("Message acknowledged");
        message.ack(); // confirm processed
      } catch (err) {
        logger.error("Dispatcher error", { error: err });
        logger.info("Retrying message");
        message.retry(); // put back in queue
      }
    }
  },
};

type Recipient = {
  sub_id: string;
  user_id: string;
  chat_id: number;
  gh_username: string;
  gh_pat: string;
};

async function handleIssueEvent(
  event: IssueQueueMessage,
  env: Env,
  logger: LoggerLike,
): Promise<void> {
  const { repo, issue, action, triggerLabel } = event;
  logger.info("Processing issue event", {
    action,
    repo,
    issue_number: issue.number,
    author: issue.user.login,
  });

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
  logger.info("Found active subscriptions", {
    repo,
    count: subs.results?.length || 0,
  });

  // ── In single tenant mode there are no users rows ─────────────
  // ── so we manually resolve the one owner ─────────────────────
  let recipients: Recipient[] = [];

  if (env.MULTI_TENANT === "false") {
    logger.info("Single tenant mode, checking owner subscription", { repo });
    // Check if owner has a subscription for this repo
    const ownerSub = (await env.DB.prepare(
      `
        SELECT id FROM subscriptions
        WHERE user_id = ? AND repo = ? AND is_active = TRUE
      `,
    )
      .bind(env.OWNER_ID, repo)
      .first()) as { id: string } | undefined;

    if (!ownerSub) {
      logger.info("Owner not subscribed, skipping", { repo });
      return;
    } // owner not subscribed to this repo
    logger.info("Owner subscription found", { repo });

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
        const user = (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
          .bind(sub.user_id)
          .first()) as {
          id: string;
          chat_id: number;
          gh_username: string;
          gh_pat: string;
        };
        return {
          sub_id: sub.id as string,
          user_id: user.id,
          chat_id: user.chat_id,
          gh_username: user.gh_username,
          gh_pat: user.gh_pat,
        };
      }),
    );
  }

  // ── For each recipient, check label filters then notify ───────
  for (const recipient of recipients) {
    const recipientLogger = logger.child({
      user_id: recipient.user_id,
      sub_id: recipient.sub_id,
    });
    recipientLogger.info("Checking label filter");
    const shouldNotify = await checkLabelFilter(
      env,
      recipient.sub_id,
      issue.labels?.map((l: { name: string }) => l.name) || [],
      triggerLabel,
    );

    if (!shouldNotify) {
      recipientLogger.info("Label filter failed, skipping", { triggerLabel });
      continue;
    }
    recipientLogger.info("Notifying user");

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
async function checkLabelFilter(
  env: Env,
  sub_id: string,
  issueLabels: string[],
  triggerLabel: string | null,
): Promise<boolean> {
  const filters = await env.DB.prepare(
    `SELECT label FROM label_filters WHERE subscription_id = ?`,
  )
    .bind(sub_id)
    .all();

  if (filters.results.length === 0) return true; // no filter = all labels

  const watchList = filters.results.map((f: any) => f.label.toLowerCase());
  const candidates = [
    ...issueLabels.map((l) => l.toLowerCase()),
    ...(triggerLabel ? [triggerLabel.toLowerCase()] : []),
  ];

  return candidates.some((l) => watchList.includes(l));
}

// ── Get labels user is watching for this subscription ────────────
async function getWatchingLabels(env: Env, sub_id: string): Promise<string[]> {
  const filters = await env.DB.prepare(
    `SELECT label FROM label_filters WHERE subscription_id = ?`,
  )
    .bind(sub_id)
    .all();
  return (filters.results as { label: string }[]).map((f) => f.label);
}
