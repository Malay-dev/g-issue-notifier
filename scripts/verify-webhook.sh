#!/bin/bash
# Reads BOT_TOKEN from .dev.vars and verifies Telegram webhook
# Usage: bash scripts/verify-webhook.sh

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
WORKER_URL="${secrets[WORKER_URL]}"

if [ -z "$BOT_TOKEN" ]; then
  echo "BOT_TOKEN not found in .dev.vars"
  exit 1
fi

echo "Verifying Telegram webhook..."
info=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
if [ -z "$info" ]; then
  echo "Failed to retrieve webhook info."
  exit 1
fi

echo "Webhook info:"
echo "$info"

if [ -n "$WORKER_URL" ]; then
  echo "Configured WORKER_URL: $WORKER_URL"
  current_url=$(node - <<'NODE'
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
const info = JSON.parse(input);
console.log(info.result?.url || '');
NODE
  )
  if [ "$current_url" = "$WORKER_URL" ]; then
    echo "Webhook URL matches configured WORKER_URL."
  else
    echo "Current webhook URL: $current_url"
  fi
fi
