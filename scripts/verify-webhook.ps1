# Reads BOT_TOKEN from .dev.vars and verifies Telegram webhook
# Usage: .\scripts\verify-webhook.ps1

$DEV_VARS_PATH = ".dev.vars"

if (-not (Test-Path $DEV_VARS_PATH)) {
  Write-Error ".dev.vars file not found."
  exit 1
}

# Read .dev.vars
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

if (-not $BOT_TOKEN) {
  Write-Error "BOT_TOKEN not found in .dev.vars"
  exit 1
}

Write-Host "Verifying Telegram webhook..." -ForegroundColor Cyan

$info = Invoke-RestMethod `
  -Uri ('https://api.telegram.org/bot' + $BOT_TOKEN + '/getWebhookInfo') `
  -Method GET

if ($null -eq $info) {
  Write-Error "Failed to retrieve webhook info."
  exit 1
}

Write-Host "Webhook info:" -ForegroundColor Green
Write-Host ($info | ConvertTo-Json -Depth 5)

if ($WORKER_URL) {
  $currentUrl = $info.result.url
  if ($currentUrl -eq $WORKER_URL) {
    Write-Host "Webhook URL matches configured WORKER_URL." -ForegroundColor Green
  } else {
    Write-Host "Configured WORKER_URL: $WORKER_URL" -ForegroundColor Yellow
    Write-Host "Current webhook URL: $currentUrl" -ForegroundColor Yellow
    if (-not $currentUrl) {
      Write-Host "No webhook URL is currently set." -ForegroundColor Red
    }
  }
}

if ($info.result.pending_update_count -gt 0) {
  Write-Host "Pending update count: $($info.result.pending_update_count)" -ForegroundColor Yellow
} else {
  Write-Host "No pending updates." -ForegroundColor Green
}
