#!/bin/bash
# Reads secrets from .dev.vars and pushes to all three workers
# Usage: bash scripts/publish-secrets.sh

set -e

WORKERS=(
  "g-issue-notifier-bot"
  "g-issue-notifier-poller"
  "g-issue-notifier-dispatcher"
)

SECRET_KEYS=(
  "BOT_TOKEN"
  "GH_PAT"
  "WEBHOOK_SECRET"
  "ENCRYPTION_KEY"
  "OWNER_CHAT_ID"
  "OWNER_GH_USER"
  "OWNER_ID"
)

DEV_VARS_PATH=".dev.vars"

# ── Read .dev.vars ─────────────────────────────────────────────────
if [ ! -f "$DEV_VARS_PATH" ]; then
  echo "❌ .dev.vars file not found. Create it from .dev.vars.example first."
  exit 1
fi

declare -A secrets
while IFS='=' read -r key value; do
  # Skip empty lines and comments
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  secrets["$key"]="$value"
done < "$DEV_VARS_PATH"

# ── Validate all required secrets are present ──────────────────────
missing=()
for key in "${SECRET_KEYS[@]}"; do
  if [ -z "${secrets[$key]}" ]; then
    missing+=("$key")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ Missing secrets in .dev.vars: ${missing[*]}"
  exit 1
fi

echo -e "\nAll secrets found in .dev.vars"

# ── Publish to each worker ─────────────────────────────────────────
for worker in "${WORKERS[@]}"; do
  echo -e "\nPublishing secrets to $worker..."

  for key in "${SECRET_KEYS[@]}"; do
    value="${secrets[$key]}"
    printf "   Setting %s... " "$key"

    echo "$value" | npx wrangler secret put "$key" --name "$worker" > /dev/null 2>&1

    if [ $? -eq 0 ]; then
      echo "OK"
    else
      echo "FAILED"
    fi
  done
done

echo -e "\nAll secrets published successfully!\n"