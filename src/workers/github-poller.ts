import { Env } from "../types/index.js";
import { isMaintainer } from "../lib/github.js";

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
    console.log(`[github-poller] Scheduled event triggered`);
    ctx.waitUntil(pollAllSubscriptions(env));
  },
};

async function pollAllSubscriptions(env: Env): Promise<void> {
  console.log(`[pollAllSubscriptions] Starting polling cycle`);
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
  console.log(
    `[pollAllSubscriptions] Found ${subs.results?.length || 0} subscriptions to poll`,
  );

  if (!subs.results.length) {
    console.log(`[pollAllSubscriptions] No subscriptions, exiting`);
    return;
  }

  const now = new Date();

  for (const sub of subs.results) {
    try {
      console.log(
        `[pollAllSubscriptions] Processing subscription for ${sub.repo}`,
      );
      const lastChecked = new Date(sub.last_checked_at);
      const minutesSince = (now.getTime() - lastChecked.getTime()) / 1000 / 60;

      // Only poll if enough time has passed
      if (minutesSince < sub.poll_interval) {
        console.log(
          `[pollAllSubscriptions] Skipping ${sub.repo} — ${minutesSince.toFixed(1)} mins since last check, interval is ${sub.poll_interval} mins`,
        );
        continue;
      }

      console.log(
        `[pollAllSubscriptions] Polling ${sub.repo} after ${minutesSince.toFixed(1)} minutes`,
      );
      await pollRepo(sub, env, now);
    } catch (err) {
      console.error(`[pollAllSubscriptions] Error polling ${sub.repo}:`, err);
    }
  }
}
async function pollRepo(
  sub: { id: string; repo: string; last_checked_at: string; user_id: string },
  env: Env,
  now: Date,
): Promise<void> {
  const { id, repo, last_checked_at, user_id } = sub;

  // Single tenant always uses Worker Secret — never D1
  const pat =
    env.MULTI_TENANT === "false" ? env.GH_PAT : await getUserPat(env, user_id);

  if (!pat) {
    console.error(`[pollRepo] No PAT available for ${repo}`);
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
    console.error(`[pollRepo] GitHub API error for ${repo}: ${res.status}`);
    await updateLastChecked(env, id, now);
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

  console.log(
    `[pollRepo] ${repo}: ${newIssues.length} new issues since ${since}`,
  );

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

  await updateLastChecked(env, id, now);
}

async function updateLastChecked(
  env: Env,
  sub_id: string,
  now: Date,
): Promise<void> {
  console.log(
    `[updateLastChecked] Updating subscription ${sub_id} to ${now.toISOString()}`,
  );
  await env.DB.prepare(
    `UPDATE subscriptions SET last_checked_at = ? WHERE id = ?`,
  )
    .bind(now.toISOString(), sub_id)
    .run();
  console.log(`[updateLastChecked] Update complete`);
}

async function getUserPat(
  env: Env,
  user_id: string,
): Promise<string | undefined> {
  console.log(`[getUserPat] Retrieving PAT for user ${user_id}`);
  const user = await env.DB.prepare(`SELECT gh_pat FROM users WHERE id = ?`)
    .bind(user_id)
    .first();
  console.log(`[getUserPat] PAT retrieved for user ${user_id}`);
  return user?.gh_pat as string | undefined;
}
