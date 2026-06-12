"""
filter_to_modern.py — restrict the manifest to players whose career touches the year 2000+.

Reads:  data/manifest.json + data/players/*.json
Writes: data/manifest.json (overwrites)

Run:    python3 scripts/filter_to_modern.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "players"
MANIFEST = ROOT / "data" / "manifest.json"
MIN_YEAR = 2000

manifest = json.loads(MANIFEST.read_text())

def max_year(slug: str) -> int:
    fp = OUT / f"{slug}.json"
    if not fp.exists():
        return 0
    try:
        d = json.loads(fp.read_text())
        years = [int(r[0]) for r in d.get("rows", []) if r and r[0] and str(r[0]).isdigit()]
        return max(years) if years else 0
    except Exception:
        return 0


before = {t: len(manifest[t]) for t in ("famous", "pros", "alltime")}
year_cache: dict[str, int] = {}

for tier in ("famous", "pros", "alltime"):
    kept = []
    for entry in manifest[tier]:
        slug = entry["id"]
        if slug not in year_cache:
            year_cache[slug] = max_year(slug)
        if year_cache[slug] >= MIN_YEAR:
            kept.append(entry)
    manifest[tier] = kept

after = {t: len(manifest[t]) for t in ("famous", "pros", "alltime")}

MANIFEST.write_text(json.dumps(manifest, separators=(",", ":")))
print("filter_to_modern: kept players whose career touches", MIN_YEAR, "or later")
for t in ("famous", "pros", "alltime"):
    print(f"  {t:>8}: {before[t]:>6}  →  {after[t]:>6}")
