const BASE = "https://api.telegram.org/bot";

import { GitHubIssue } from "../types/index.js";

export async function sendMessage(
  token: string,
  chat_id: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  console.log(
    `[telegram.sendMessage] Sending message to chat ${chat_id}, text length: ${text.length}`,
  );
  const res = await fetch(`${BASE}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: "HTML",
      ...extra,
    }),
  });
  const result = (await res.json()) as { result?: { message_id?: number } };
  console.log(
    `[telegram.sendMessage] Response status: ${res.status}, message_id: ${result.result?.message_id}`,
  );
  return result;
}

export async function answerCallbackQuery(
  token: string,
  callback_query_id: string,
  text = "",
): Promise<Response> {
  console.log(
    `[telegram.answerCallbackQuery] Answering callback query: ${callback_query_id}`,
  );
  const res = await fetch(`${BASE}${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id, text }),
  });
  console.log(`[telegram.answerCallbackQuery] Response status: ${res.status}`);
  return res;
}

export async function editMessageReplyMarkup(
  token: string,
  chat_id: number,
  message_id: number,
  reply_markup: unknown,
): Promise<Response> {
  console.log(
    `[telegram.editMessageReplyMarkup] Editing message ${message_id} in chat ${chat_id}`,
  );
  const res = await fetch(`${BASE}${token}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, message_id, reply_markup }),
  });
  console.log(
    `[telegram.editMessageReplyMarkup] Response status: ${res.status}`,
  );
  return res;
}

export function buildIssueMessage(
  issue: GitHubIssue,
  repo: string,
  watchingLabels: string[] = [],
): string {
  console.log(
    `[telegram.buildIssueMessage] Building message for ${repo}#${issue.number}`,
  );
  const isMaintainer = issue._isMaintainer;
  const labels = issue.labels?.map((l: { name: string }) => l.name) || [];
  const assignees =
    issue.assignees?.map((a: { login: string }) => `@${a.login}`).join(", ") ||
    "None";
  const watching = watchingLabels.length
    ? watchingLabels.join(", ")
    : "All labels";
  console.log(
    `[telegram.buildIssueMessage] Issue labels: [${labels.join(", ")}], is maintainer: ${isMaintainer}`,
  );

  return [
    `<b>New Issue</b>  •  <code>${repo}</code>`,
    ``,
    `<b>#${issue.number} — ${issue.title}</b>`,
    ``,
    `${truncate(issue.body)}`,
    ``,
    `──────────────────────────`,
    `<b>Watching:</b>    ${watching}`,
    `<b>All Labels:</b>  ${labels.join(", ") || "None"}`,
    `<b>Reporter:</b>    @${issue.user.login}`,
    `<b>Maintainer:</b>  ${isMaintainer ? "Yes" : "No"}`,
    `<b>Assignees:</b>   ${assignees}`,
    `<b>Comments:</b>    ${issue.comments}`,
    `<b>Opened:</b>      ${timeAgo(issue.created_at)}`,
    `──────────────────────────`,
  ].join("\n");
}

export function truncate(text: string | null, max = 300): string {
  if (!text) return "No description provided.";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function timeAgo(dateString: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
