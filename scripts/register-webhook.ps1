# Reads BOT_TOKEN from .dev.vars and registers Telegram webhook
# Usage: .\scripts\register-webhook.ps1

$DEV_VARS_PATH = ".dev.vars"

if (-not (Test-Path $DEV_VARS_PATH)) {
  Write-Error ".dev.vars file not found."
  exit 1
}

# ── Read .dev.vars ─────────────────────────────────────────────────
$secrets = @{}
foreach ($line in Get-Content $DEV_VARS_PATH) {
  if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
  $parts = $line -split '=', 2
  if ($parts.Length -eq 2) {
    $secrets[$parts[0].Trim()] = $parts[1].Trim()
  }
}

$BOT_TOKEN = $secrets["BOT_TOKEN"]
$WORKER_URL = $secrets["WORKER_URL"]
if (-not $WORKER_URL) {
  $WORKER_URL = "https://g-issue-notifier-bot.malay-dev.workers.dev"
}

if (-not $BOT_TOKEN) {
  Write-Error "BOT_TOKEN not found in .dev.vars"
  exit 1
}

# ── Register webhook ───────────────────────────────────────────────
Write-Host "`nRegistering Telegram webhook..." -ForegroundColor Cyan
Write-Host "   URL: $WORKER_URL"

$body = @{
  url             = $WORKER_URL
  allowed_updates = @("message", "callback_query")
} | ConvertTo-Json


$result = Invoke-RestMethod `
  -Uri ('https://api.telegram.org/bot' + $BOT_TOKEN + '/setWebhook') `
  -Method POST `
  -ContentType "application/json" `
  -Body $body

if ($result.ok) {
  Write-Host "`nWebhook registered successfully!" -ForegroundColor Green
} else {
  Write-Host "`nFailed: $($result.description)" -ForegroundColor Red
  exit 1
}

# ── Verify ─────────────────────────────────────────────────────────
Write-Host "`nVerifying webhook..." -ForegroundColor Cyan

$info = Invoke-RestMethod `
  -Uri ('https://api.telegram.org/bot' + $BOT_TOKEN + '/getWebhookInfo')

Write-Host ($info.result | ConvertTo-Json -Depth 5)