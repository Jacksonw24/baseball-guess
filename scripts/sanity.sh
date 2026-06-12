#!/usr/bin/env bash
# Spot-check modern stars after running update_recent.py
set -u
cd "$(dirname "$0")/.."

check() {
  local slug="$1"
  local label="$2"
  if [ ! -f "data/players/$slug.json" ]; then
    echo "  MISSING: $label ($slug)"
    return
  fi
  python3 -c "
import json
d = json.load(open('data/players/$slug.json'))
rows = d['rows']
years = sorted({r[0] for r in rows})
last = years[-1] if years else '?'
first = years[0] if years else '?'
print(f'  $label / {d[\"kind\"]} / {first}-{last} ({len(rows)} rows)')
for h in d['hints']: print(f'    - {h}')
"
}

echo "=== Existing players, should now include 2022+ ==="
check troutmi01 "Mike Trout"
check judgeaa01 "Aaron Judge"
check sotoju01  "Juan Soto"
check ohtansh01 "Shohei Ohtani"
check acunaro01 "Ronald Acuna Jr."
check kershcl01 "Clayton Kershaw"

echo
echo "=== Brand-new players (should exist after update_recent.py) ==="
check wittbo02  "Bobby Witt Jr."
check delacel01 "Elly De La Cruz"
check skenepa01 "Paul Skenes"
check chourja01 "Jackson Chourio"
check rodriju01 "Julio Rodríguez"
check hollija01 "Jackson Holliday"
check skubata01 "Tarik Skubal"
