# Check subscription status with local timezone timestamps
# Usage: .\scripts\check-subscriptions.ps1

# Capture full output as a single string
$rawOutput = npx wrangler d1 execute issuebot-db --remote `
  --command "SELECT repo, is_active, poll_interval, last_checked_at FROM subscriptions ORDER BY last_checked_at DESC" `
  --json 2>&1

# Join all lines and extract the JSON array
$fullText = $rawOutput -join "`n"
$jsonStart = $fullText.IndexOf('[')
$jsonEnd   = $fullText.LastIndexOf(']')

if ($jsonStart -eq -1 -or $jsonEnd -eq -1) {
  Write-Host "Failed to find JSON in output. Raw output:" -ForegroundColor Red
  Write-Host $fullText
  exit 1
}

$jsonStr = $fullText.Substring($jsonStart, $jsonEnd - $jsonStart + 1)

try {
  $json = $jsonStr | ConvertFrom-Json
} catch {
  Write-Host "Failed to parse JSON: $_" -ForegroundColor Red
  Write-Host "Raw JSON string: $jsonStr"
  exit 1
}

$rows = $json[0].results

if (-not $rows -or $rows.Count -eq 0) {
  Write-Host "No subscriptions found." -ForegroundColor Yellow
  exit 0
}

$now = Get-Date

Write-Host ""
Write-Host "======================================================================================" -ForegroundColor Cyan
Write-Host " Subscription Status" -ForegroundColor Cyan
Write-Host "======================================================================================" -ForegroundColor Cyan
Write-Host ""

foreach ($row in $rows) {
  $utcTime     = [DateTime]::Parse($row.last_checked_at, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
  $localTime   = $utcTime.ToLocalTime()
  $minutesAgo  = [math]::Round(($now - $localTime).TotalMinutes, 1)
  $nextPoll    = $localTime.AddMinutes($row.poll_interval)
  $minsUntil   = [math]::Round(($nextPoll - $now).TotalMinutes, 1)
  $active      = if ($row.is_active) { "ACTIVE" } else { "PAUSED" }
  $activeColor = if ($row.is_active) { "Green" } else { "Red" }

  if ($minsUntil -le 0) {
    $nextPollStr = "due now"
    $nextColor   = "Yellow"
  } else {
    $nextPollStr = "in $minsUntil mins"
    $nextColor   = "Cyan"
  }

  Write-Host " Repo         : " -NoNewline; Write-Host $row.repo -ForegroundColor White
  Write-Host " Status       : " -NoNewline; Write-Host $active -ForegroundColor $activeColor
  Write-Host " Interval     : every $($row.poll_interval) mins"
  Write-Host " Last Checked : $($localTime.ToString('yyyy-MM-dd HH:mm:ss')) ($minutesAgo mins ago)"
  Write-Host " Next Poll    : $($nextPoll.ToString('yyyy-MM-dd HH:mm:ss')) " -NoNewline
  Write-Host "($nextPollStr)" -ForegroundColor $nextColor
  Write-Host "--------------------------------------------------------------------------------------"
}

Write-Host ""
Write-Host " Local timezone : $([System.TimeZoneInfo]::Local.DisplayName)" -ForegroundColor DarkGray
Write-Host " Current time   : $($now.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor DarkGray
Write-Host ""