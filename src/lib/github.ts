const BASE = "https://api.github.com";

function headers(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "issue-notifier-bot",
  };
}

import { GitHubComment } from "../types/index.js";

export async function postComment(
  pat: string,
  repo: string,
  issueNumber: number | string,
  body: string,
): Promise<GitHubComment> {
  console.log(`[github.postComment] Posting comment to ${repo}#${issueNumber}`);
  console.log(`[github.postComment] Body length: ${body.length} chars`);
  const res = await fetch(
    `${BASE}/repos/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: headers(pat),
      body: JSON.stringify({ body }),
    },
  );
  const result = (await res.json()) as GitHubComment;
  console.log(`[github.postComment] Response status: ${res.status}`);
  return result;
}

export async function isMaintainer(
  pat: string,
  repo: string,
  username: string,
  kv: KVNamespace,
): Promise<boolean> {
  console.log(
    `[github.isMaintainer] Checking if @${username} is maintainer of ${repo}`,
  );
  // Cache result in KV for 1 hour to avoid rate limits
  const cacheKey = `maintainer:${repo}:${username}`;
  const cached = await kv.get(cacheKey);
  if (cached !== null) {
    console.log(`[github.isMaintainer] Cache hit for ${cacheKey}: ${cached}`);
    return cached === "true";
  }
  console.log(`[github.isMaintainer] Cache miss, fetching from GitHub API`);

  const res = await fetch(`${BASE}/repos/${repo}/collaborators/${username}`, {
    headers: headers(pat),
  });

  // 204 = is collaborator/maintainer, 404 = not
  const result = res.status === 204;
  console.log(
    `[github.isMaintainer] GitHub API returned status ${res.status}, is maintainer: ${result}`,
  );
  await kv.put(cacheKey, String(result), { expirationTtl: 3600 });
  console.log(`[github.isMaintainer] Cached result for 1 hour`);
  return result;
}
