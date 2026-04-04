#!/bin/bash
# Reads BOT_TOKEN from .dev.vars and registers Telegram webhook
# Usage: bash scripts/register-webhook.sh

set -e

DEV_VARS_PATH=".dev.vars"
if [ ! -f "$DEV_VARS_PATH" ]; then
  echo ".dev.vars file not found."
  exit 1
fi

declare -A secrets
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line="${line#${line%%[![:space:]]*}}"
  line="${line%${line##*[![:space:]]}}"
  [ -z "$line" ] && continue

  IFS='=' read -r key value <<< "$line"
  key="${key#${key%%[![:space:]]*}}"
  key="${key%${key##*[![:space:]]}}"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"

  secrets["$key"]="$value"
done < "$DEV_VARS_PATH"

BOT_TOKEN="${secrets[BOT_TOKEN]}"
WORKER_URL="${secrets[WORKER_URL]:-https://g-issue-notifier-bot.malay-dev.workers.dev}"

if [ -z "$BOT_TOKEN" ]; then
  echo "BOT_TOKEN not found in .dev.vars"
  exit 1
fi

echo "Registering Telegram webhook..."
echo "   URL: $WORKER_URL"

body=$(cat <<EOF
{"url":"$WORKER_URL","allowed_updates":["message","callback_query"]}
EOF
)

result=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" -H "Content-Type: application/json" -d "$body")

if echo "$result" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "Webhook registered successfully!"
else
  echo "Failed: $result"
  exit 1
fi

echo "Verifying webhook..."
info=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
if [ -z "$info" ]; then
  echo "Failed to retrieve webhook info."
  exit 1
fi

echo "$info"
