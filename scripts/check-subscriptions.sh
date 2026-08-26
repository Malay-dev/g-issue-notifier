#!/bin/bash
# Check subscription status with local timezone timestamps
# Usage: bash scripts/check-subscriptions.sh

result=$(npx wrangler d1 execute issuebot-db --remote \
  --command "SELECT repo, is_active, poll_interval, last_checked_at FROM subscriptions ORDER BY last_checked_at DESC" \
  --json 2>&1)

# Extract JSON array
json=$(echo "$result" | grep -E '^\[|^\{')

if [ -z "$json" ]; then
  echo "No subscriptions found or failed to parse output."
  exit 1
fi

now=$(date +%s)

echo ""
echo "======================================================================================================"
echo " Subscription Status"
echo "======================================================================================================"
echo ""

echo "$json" | python3 -c "
import sys, json, datetime, time

data = json.load(sys.stdin)
rows = data[0]['results'] if isinstance(data, list) else data['results']
now  = datetime.datetime.now()

for row in rows:
    utc_time   = datetime.datetime.fromisoformat(row['last_checked_at'].replace('Z', '+00:00'))
    local_time = utc_time.astimezone()
    mins_ago   = round((now - local_time.replace(tzinfo=None)).total_seconds() / 60, 1)
    next_poll  = local_time.replace(tzinfo=None) + datetime.timedelta(minutes=row['poll_interval'])
    mins_until = round((next_poll - now).total_seconds() / 60, 1)
    active     = 'ACTIVE' if row['is_active'] else 'PAUSED'
    next_str   = 'due now' if mins_until <= 0 else f'in {mins_until} mins'

    print(f\" Repo         : {row['repo']}\")
    print(f\" Status       : {active}\")
    print(f\" Interval     : every {row['poll_interval']} mins\")
    print(f\" Last Checked : {local_time.strftime('%Y-%m-%d %H:%M:%S')} ({mins_ago} mins ago)\")
    print(f\" Next Poll    : {next_poll.strftime('%Y-%m-%d %H:%M:%S')} ({next_str})\")
    print( \" ------------------------------------------------------------------------------------------------------\")

print(f\"\")
print(f\" Current time : {now.strftime('%Y-%m-%d %H:%M:%S')}\")
print(f\"\")
"