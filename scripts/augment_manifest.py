"""
Augment data/manifest.json entries with metadata needed for client-side filters:
  - kind: "batting" | "pitching"
  - pos:  "P" | "C" | "IF" | "OF" | "DH"
  - first: first year in the player's table
  - last:  last year in the player's table

Run:  python3 scripts/augment_manifest.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "players"
MANIFEST_PATH = ROOT / "data" / "manifest.json"

POS_GROUP = {
    "Pitcher": "P",
    "Catcher": "C",
    "First Baseman": "1B", "First Base": "1B",
    "Second Baseman": "2B", "Second Base": "2B",
    "Third Baseman": "3B", "Third Base": "3B",
    "Shortstop": "SS",
    "Leftfielder": "LF", "Left Fielder": "LF",
    "Centerfielder": "CF", "Center Fielder": "CF",
    "Rightfielder": "RF", "Right Fielder": "RF",
    "Outfielder": "OF",
    "Designated Hitter": "DH",
    "Two-Way": "P",  # treat two-way as pitcher (Ohtani)
}


def extract_pos(hints):
    if not hints: return ""
    h = hints[0]
    if not h.startswith("Position:"): return ""
    body = h[len("Position:"):].strip()
    head = body.split(" — ")[0]
    # Multi-position like "Shortstop and Third Baseman" — take first
    return head.split(" and ")[0].strip()


def player_meta(slug):
    fp = OUT / f"{slug}.json"
    if not fp.exists(): return None
    try:
        d = json.loads(fp.read_text())
    except Exception:
        return None
    years = [int(r[0]) for r in d.get("rows", []) if r and r[0] and str(r[0]).isdigit()]
    if not years: return None
    pos_label = extract_pos(d.get("hints", []))
    pos_group = POS_GROUP.get(pos_label, "")
    if not pos_group:
        pos_group = "P" if d.get("kind") == "pitching" else "OF"  # safe default for hitters
    return {
        "kind": d.get("kind", "batting"),
        "pos":  pos_group,
        "first": min(years),
        "last":  max(years),
    }


manifest = json.loads(MANIFEST_PATH.read_text())

# Dedupe lookups across tiers
unique_ids = set()
for tier in ("famous", "pros", "alltime"):
    for e in manifest[tier]:
        unique_ids.add(e["id"])

meta_cache = {}
for sid in unique_ids:
    m = player_meta(sid)
    if m: meta_cache[sid] = m

# Attach to every tier entry
attached = 0
for tier in ("famous", "pros", "alltime"):
    for e in manifest[tier]:
        m = meta_cache.get(e["id"])
        if not m: continue
        e["k"] = m["kind"][0]   # "b" or "p" — compact
        e["p"] = m["pos"]
        e["f"] = m["first"]
        e["l"] = m["last"]
        attached += 1

MANIFEST_PATH.write_text(json.dumps(manifest, separators=(",", ":")))
print(f"Attached metadata to {attached} entries across {len(unique_ids)} unique players")
print(f"  manifest size: {MANIFEST_PATH.stat().st_size // 1024} KB")
