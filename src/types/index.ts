// ─────────────────────────────────────────────────────────────────
// ENVIRONMENT BINDINGS
// ─────────────────────────────────────────────────────────────────
export interface Env {
  // KV Namespaces
  SESSION: KVNamespace;
  CLAIM_CTX: KVNamespace;

  // D1
  DB: D1Database;

  // Queue
  QUEUE: Queue;

  // Secrets
  BOT_TOKEN: string;
  GH_PAT: string;
  WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  OWNER_GH_USER: string;
  OWNER_ID: string;
  ENCRYPTION_KEY: string;

  // Vars
  MULTI_TENANT: "true" | "false";
}

// ─────────────────────────────────────────────────────────────────
// DATABASE ROWS
// ─────────────────────────────────────────────────────────────────
export interface UserRow {
  id: string;
  chat_id: number;
  gh_username: string;
  gh_pat: string | null; // null in single-tenant, encrypted in multi-tenant
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  repo: string;
  is_active: boolean;
  poll_interval: number;
  last_checked_at: string;
  created_at: string;
}

export interface LabelFilterRow {
  id: string;
  subscription_id: string;
  user_id: string;
  label: string;
}

export interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
}

export interface ClaimRow {
  id: string;
  user_id: string;
  subscription_id: string;
  repo: string;
  issue_number: number;
  gh_comment_id: number | null;
  claimed_at: string;
}

// ─────────────────────────────────────────────────────────────────
// RESOLVED USER (runtime, not DB row)
// ─────────────────────────────────────────────────────────────────
export interface ResolvedUser {
  id: string;
  chat_id: number;
  gh_username: string;
  gh_pat: string;
}

// ─────────────────────────────────────────────────────────────────
// GITHUB TYPES
// ─────────────────────────────────────────────────────────────────
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: unknown; // present if it's a PR
  _isMaintainer?: boolean; // enriched by poller
}

export interface GitHubComment {
  id: number;
  html_url: string;
  body: string;
  message?: string; // present on error responses
}

// ─────────────────────────────────────────────────────────────────
// QUEUE MESSAGE
// ─────────────────────────────────────────────────────────────────
export interface IssueQueueMessage {
  repo: string;
  action: "opened" | "labeled" | "reopened";
  issue: GitHubIssue;
  triggerLabel: string | null;
}

// ─────────────────────────────────────────────────────────────────
// TELEGRAM TYPES
// ─────────────────────────────────────────────────────────────────
export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ─────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────
export type SessionStep =
  | "awaiting_label_input"
  | "awaiting_custom_comment"
  | "awaiting_template_name"
  | "awaiting_template_body";

export interface Session {
  step: SessionStep;
  sub_id?: string;
  repo?: string;
  selected?: string[];
  name?: string;
  issue_number?: string;
}

// ─────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  worker: string;
  traceId: string;
  msg: string;
  ts: string;
  [key: string]: unknown; // additional context fields
}
