import { Env } from "../types/index.js";
import { isMaintainer } from "../lib/github.js";
import { Logger, LoggerLike } from "../lib/logger.js";

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // Poller is cron-only, not meant to be called via HTTP
    return new Response("Poller is running on schedule.", { status: 200 });
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const logger = new Logger("github-poller", env.LOG_LEVEL ?? "info");
    logger.info("Scheduled event triggered");
    ctx.waitUntil(pollAllSubscriptions(env, logger));
  },
};

async function pollAllSubscriptions(
  env: Env,
  logger: LoggerLike,
): Promise<void> {
  logger.info("Starting polling cycle");
  // Get all active subscriptions
  const subs = (await env.DB.prepare(
    `
      SELECT s.id, s.repo, s.poll_interval, s.last_checked_at, s.user_id
      FROM subscriptions s
      WHERE s.is_active = TRUE
    `,
  ).all()) as {
    results: Array<{
      id: string;
      repo: string;
      poll_interval: number;
      last_checked_at: string;
      user_id: string;
    }>;
  };
  logger.info("Found subscriptions to poll", {
    count: subs.results?.length || 0,
  });

  if (!subs.results.length) {
    logger.info("No subscriptions, exiting");
    return;
  }

  const now = new Date();

  for (const sub of subs.results) {
    const subLogger: LoggerLike = logger.child({
      repo: sub.repo,
      subscription_id: sub.id,
    });
    try {
      subLogger.info("Processing subscription", { user_id: sub.user_id });
      const lastChecked = new Date(sub.last_checked_at);
      const minutesSince = (now.getTime() - lastChecked.getTime()) / 1000 / 60;

      // Only poll if enough time has passed
      if (minutesSince < sub.poll_interval) {
        subLogger.info("Skipping poll due to interval", {
          minutesSince: minutesSince.toFixed(1),
          poll_interval: sub.poll_interval,
        });
        continue;
      }

      subLogger.info("Polling repository", {
        minutesSince: minutesSince.toFixed(1),
      });
      await pollRepo(sub, env, now, subLogger);
    } catch (err) {
      subLogger.error("Error polling subscription", { error: err });
    }
  }
}
async function pollRepo(
  sub: { id: string; repo: string; last_checked_at: string; user_id: string },
  env: Env,
  now: Date,
  logger: LoggerLike,
): Promise<void> {
  const { id, repo, last_checked_at, user_id } = sub;

  // Single tenant always uses Worker Secret — never D1
  const pat =
    env.MULTI_TENANT === "false"
      ? env.GH_PAT
      : await getUserPat(env, user_id, logger);

  if (!pat) {
    logger.error("No PAT available", { repo });
    return;
  }

  const since = new Date(last_checked_at).toISOString();
  const url = `https://api.github.com/repos/${repo}/issues?since=${since}&state=open&per_page=20&sort=created&direction=asc`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "issue-notifier-bot",
    },
  });

  if (!res.ok) {
    logger.error("GitHub API error", { repo, status: res.status });
    await updateLastChecked(env, id, now, logger);
    return;
  }

  const issues = (await res.json()) as Array<
    import("../types/index.js").GitHubIssue
  >;
  const realIssues = issues.filter((i) => !i.pull_request);
  const newIssues = realIssues.filter(
    (i) =>
      new Date(i.created_at).getTime() > new Date(last_checked_at).getTime(),
  );

  logger.info("New issues found", {
    repo,
    newIssues: newIssues.length,
    since,
  });

  for (const issue of newIssues) {
    const reporterIsMaintainer = await isMaintainer(
      pat,
      repo,
      issue.user.login,
      env.CLAIM_CTX,
    );

    await env.QUEUE.send({
      repo,
      action: "opened",
      issue: { ...issue, _isMaintainer: reporterIsMaintainer },
      triggerLabel: null,
    });
  }

  await updateLastChecked(env, id, now, logger);
}

async function updateLastChecked(
  env: Env,
  sub_id: string,
  now: Date,
  logger: LoggerLike,
): Promise<void> {
  logger.info("Updating subscription last checked", {
    sub_id,
    at: now.toISOString(),
  });
  await env.DB.prepare(
    `UPDATE subscriptions SET last_checked_at = ? WHERE id = ?`,
  )
    .bind(now.toISOString(), sub_id)
    .run();
  logger.info("Update complete", { sub_id });
}

async function getUserPat(
  env: Env,
  user_id: string,
  logger: LoggerLike,
): Promise<string | undefined> {
  logger.info("Retrieving user PAT", { user_id });
  const user = await env.DB.prepare(`SELECT gh_pat FROM users WHERE id = ?`)
    .bind(user_id)
    .first();
  logger.info("PAT retrieved for user", { user_id });
  return user?.gh_pat as string | undefined;
}
