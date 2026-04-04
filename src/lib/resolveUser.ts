import { Env, ResolvedUser } from "../types/index.js";
import { decryptPat } from "./crypto.js";

export async function resolveUser(
  env: Env,
  chat_id: number,
): Promise<ResolvedUser> {
  if (env.MULTI_TENANT === "false") {
    const user: ResolvedUser = {
      id: env.OWNER_ID,
      chat_id: Number(env.OWNER_CHAT_ID),
      gh_username: env.OWNER_GH_USER,
      gh_pat: env.GH_PAT, // always from Worker Secret
    };

    // Ensure owner row exists for FK constraints
    // gh_pat intentionally NULL in D1 for single-tenant
    await env.DB.prepare(
      `
        INSERT OR IGNORE INTO users (id, chat_id, gh_username, gh_pat)
        VALUES (?, ?, ?, NULL)
      `,
    )
      .bind(user.id, user.chat_id, user.gh_username)
      .run();

    return user;
  }

  // ── Multi-tenant ──────────────────────────────────────────────
  const row = await env.DB.prepare(
    `SELECT * FROM users WHERE chat_id = ? AND is_active = TRUE`,
  )
    .bind(chat_id)
    .first<{
      id: string;
      chat_id: number;
      gh_username: string;
      gh_pat: string | null;
    }>();

  if (!row) throw new Error("UNAUTHORIZED");
  if (!row.gh_pat) throw new Error("NO_PAT");

  // Decrypt PAT using ENCRYPTION_KEY Worker Secret
  const decrypted = await decryptPat(row.gh_pat, env.ENCRYPTION_KEY);

  return {
    id: row.id,
    chat_id: row.chat_id,
    gh_username: row.gh_username,
    gh_pat: decrypted,
  };
}

export function isAuthorized(env: Env, chat_id: number): boolean {
  if (env.MULTI_TENANT === "false") {
    return String(chat_id) === String(env.OWNER_CHAT_ID);
  }
  return true;
}
