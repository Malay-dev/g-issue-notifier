export async function resolveUser(env, chat_id) {
  if (env.MULTI_TENANT === "false") {
    const user = {
      id: env.OWNER_ID,
      chat_id: Number(env.OWNER_CHAT_ID),
      gh_username: env.OWNER_GH_USER,
      gh_pat: env.GH_PAT, // always from Worker Secret, never D1
    };

    // Ensure owner row exists for FK constraints
    // gh_pat intentionally stored as NULL in single-tenant
    // real PAT always comes from Worker Secret above
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

  const user = await env.DB.prepare(
    `SELECT * FROM users WHERE chat_id = ? AND is_active = TRUE`,
  )
    .bind(chat_id)
    .first();

  if (!user) throw new Error("UNAUTHORIZED");

  // In multi-tenant, PAT comes from D1 (encrypted at rest by Cloudflare)
  return user;
}

export function isAuthorized(env, chat_id) {
  console.log(`[isAuthorized] Checking authorization for chat_id: ${chat_id}`);
  if (env.MULTI_TENANT === "false") {
    const authorized = String(chat_id) === String(env.OWNER_CHAT_ID);
    console.log(`[isAuthorized] Single tenant mode, authorized: ${authorized}`);
    return authorized;
  }
  console.log(`[isAuthorized] Multi-tenant mode, deferring to resolveUser`);
  return true; // multi-tenant checks happen in resolveUser via D1
}
