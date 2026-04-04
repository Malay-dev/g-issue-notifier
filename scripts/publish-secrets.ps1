# Reads secrets from .dev.vars and pushes to all three workers
# Usage: .\scripts\publish-secrets.ps1

$WORKERS = @(
  "g-issue-notifier-bot",
  "g-issue-notifier-poller",
  "g-issue-notifier-dispatcher"
)

# Secrets to publish (must match .dev.vars keys)
$SECRET_KEYS = @(
  "BOT_TOKEN",
  "GH_PAT",
  "WEBHOOK_SECRET",
  "ENCRYPTION_KEY",
  "OWNER_CHAT_ID",
  "OWNER_GH_USER",
  "OWNER_ID"
)

# Read .dev.vars
$DEV_VARS_PATH = ".dev.vars"

if (-not (Test-Path $DEV_VARS_PATH)) {
  Write-Error ".dev.vars file not found. Create it from .dev.vars.example first."
  exit 1
}

$secrets = @{}
foreach ($line in Get-Content $DEV_VARS_PATH) {
  if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }

  $parts = $line -split '=', 2
  if ($parts.Length -eq 2) {
    $key   = $parts[0].Trim()
    $value = $parts[1].Trim()
    $secrets[$key] = $value
  }
}

$missing = @()
foreach ($key in $SECRET_KEYS) {
  if (-not $secrets.ContainsKey($key) -or $secrets[$key] -eq "") {
    $missing += $key
  }
}

if ($missing.Length -gt 0) {
  Write-Error "Missing secrets in .dev.vars: $($missing -join ', ')"
  exit 1
}

Write-Host "`nAll secrets found in .dev.vars" -ForegroundColor Green

foreach ($worker in $WORKERS) {
  Write-Host "`nPublishing secrets to $worker..." -ForegroundColor Cyan

  foreach ($key in $SECRET_KEYS) {
    $value = $secrets[$key]
    Write-Host "   Setting $key..." -NoNewline

    $value | npx wrangler secret put $key --name $worker 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
      Write-Host " OK" -ForegroundColor Green
    } else {
      Write-Host " FAILED" -ForegroundColor Red
    }
  }
}

Write-Host "`nAll secrets published successfully.`n" -ForegroundColor Green