"""
update_recent.py — backfill 2022+ rows + brand-new players using MLB Stats API.

Reads:  data/raw/war_bat.txt, war_pit.txt
        data/players/*.json (existing)
        data/manifest.json
Writes: updated data/players/*.json
        data/manifest.json

Run:    python3 update_recent.py
"""
import csv
import gzip
import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "players"
MANIFEST_PATH = ROOT / "data" / "manifest.json"

CURRENT_YEAR = datetime.now().year
NEW_YEARS = list(range(2022, CURRENT_YEAR + 1))

UA = "Mozilla/5.0 (baseball-guess update; personal use)"
API = "https://statsapi.mlb.com/api/v1"

CAREER_PA_MIN = 400
CAREER_IPOUTS_MIN = 150  # 50 IP

# ---- HTTP ----

def fetch_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(1 + attempt)
    return {}


# ---- bWAR mapping ----

print("Loading bWAR mappings…")
mlb_to_bbref: dict[str, str] = {}
bbref_to_mlb: dict[str, str] = {}
name_by_bbref: dict[str, str] = {}
war_bat_year: dict[tuple[str, str], float] = defaultdict(float)
war_pit_year: dict[tuple[str, str], float] = defaultdict(float)
ops_plus_year: dict[tuple[str, str], float] = defaultdict(float)
era_plus_year: dict[tuple[str, str], float] = defaultdict(float)

players_with_recent_bat: set[str] = set()  # bbref slugs
players_with_recent_pit: set[str] = set()

with open(RAW / "war_bat.txt", newline="") as fh:
    for r in csv.DictReader(fh):
        bb = r.get("player_ID") or ""
        mlb = r.get("mlb_ID") or ""
        if bb and mlb and mlb != "NA":
            mlb_to_bbref[mlb] = bb
            bbref_to_mlb[bb] = mlb
            name_by_bbref.setdefault(bb, r.get("name_common", ""))
        year = r.get("year_ID", "")
        try:
            war_bat_year[(bb, year)] += float(r.get("WAR") or 0)
        except ValueError: pass
        try:
            ops_plus_year[(bb, year)] = max(ops_plus_year[(bb, year)], float(r.get("OPS_plus") or 0))
        except ValueError: pass
        if year and int(year) >= NEW_YEARS[0]:
            players_with_recent_bat.add(bb)

with open(RAW / "war_pit.txt", newline="") as fh:
    for r in csv.DictReader(fh):
        bb = r.get("player_ID") or ""
        mlb = r.get("mlb_ID") or ""
        if bb and mlb and mlb != "NA":
            mlb_to_bbref[mlb] = bb
            bbref_to_mlb[bb] = mlb
            name_by_bbref.setdefault(bb, r.get("name_common", ""))
        year = r.get("year_ID", "")
        try:
            war_pit_year[(bb, year)] += float(r.get("WAR") or 0)
        except ValueError: pass
        try:
            era_plus_year[(bb, year)] = max(era_plus_year[(bb, year)], float(r.get("ERA_plus") or 0))
        except ValueError: pass
        if year and int(year) >= NEW_YEARS[0]:
            players_with_recent_pit.add(bb)

print(f"  bWAR has {len(players_with_recent_bat | players_with_recent_pit)} players with {NEW_YEARS[0]}+ data")

# Age from bWAR (works for everyone with a 2022+ stint, including brand-new players)
age_by_bbref_year: dict[tuple[str, str], int] = {}
for war_file in ("war_bat.txt", "war_pit.txt"):
    with open(RAW / war_file, newline="") as fh:
        for r in csv.DictReader(fh):
            slug = r.get("player_ID") or ""
            year = r.get("year_ID") or ""
            age  = r.get("age") or ""
            if slug and year and age:
                try: age_by_bbref_year[(slug, year)] = int(age)
                except ValueError: pass
print(f"  age lookup entries: {len(age_by_bbref_year)}")

# Normalize team codes (Lahman + MLB API variants) to BR's modern style.
# Historical-city codes (BRO, BSN, WS1, PHA, MON, etc.) intentionally kept distinct.
TEAM_NORMALIZE = {
    "NYA": "NYY",
    "NYN": "NYM",
    "CHN": "CHC",
    "CHA": "CHW", "CWS": "CHW",
    "SLN": "STL",
    "LAN": "LAD",
    "SFN": "SFG", "SF": "SFG",
    "SDN": "SDP", "SD": "SDP",
    "KCA": "KCR", "KC": "KCR",
    "TBA": "TBR", "TB": "TBR", "TBD": "TBR",
    "CAL": "LAA", "ANA": "LAA",
    "FLO": "MIA", "FLA": "MIA",
    "WAS": "WSN", "WSH": "WSN",
    "ATH": "OAK",
    "ML4": "MIL",
    "AZ":  "ARI",
}


def norm_team(t: str) -> str:
    return TEAM_NORMALIZE.get(t, t) if t else t


# Team abbreviation → league. Covers both MLB Stats API and bWAR styles.
TEAM_TO_LG = {
    # AL
    "BAL":"AL","BOS":"AL","CHW":"AL","CWS":"AL","CHA":"AL","CLE":"AL","DET":"AL",
    "HOU":"AL","KC":"AL","KCR":"AL","KCA":"AL","LAA":"AL","ANA":"AL","CAL":"AL",
    "MIN":"AL","NYY":"AL","NYA":"AL","OAK":"AL","ATH":"AL","PHA":"AL","SEA":"AL",
    "TB":"AL","TBR":"AL","TBD":"AL","TEX":"AL","TOR":"AL","WSA":"AL","SLB":"AL",
    # NL
    "ARI":"NL","ATL":"NL","BSN":"NL","MLN":"NL","CHC":"NL","CHN":"NL","CIN":"NL",
    "COL":"NL","LAD":"NL","LAN":"NL","BRO":"NL","MIA":"NL","FLA":"NL","MIL":"NL",
    "NYM":"NL","NYN":"NL","NYG":"NL","PHI":"NL","PIT":"NL","SD":"NL","SDP":"NL",
    "SDN":"NL","SF":"NL","SFG":"NL","SFN":"NL","STL":"NL","SLN":"NL",
    "WSH":"NL","WSN":"NL","MON":"NL",
}

# Birth years + bats/throws + Lahman ID map from People.csv
birth_year_by_bbref: dict[str, int] = {}
bats_by_bbref: dict[str, str] = {}
throws_by_bbref: dict[str, str] = {}
people_csv = RAW / "People.csv"
playerid_to_bbref: dict[str, str] = {}
if people_csv.exists():
    with open(people_csv, newline="") as fh:
        for r in csv.DictReader(fh):
            slug = r.get("bbrefID") or r.get("playerID")
            by = r.get("birthYear")
            if slug and by:
                try: birth_year_by_bbref[slug] = int(by)
                except ValueError: pass
            if slug:
                if r.get("bats"):   bats_by_bbref[slug]   = r["bats"]
                if r.get("throws"): throws_by_bbref[slug] = r["throws"]
            pid_lahman = r.get("playerID")
            if pid_lahman and slug:
                playerid_to_bbref[pid_lahman] = slug
print(f"  birth-year coverage: {len(birth_year_by_bbref)}, bats/throws: {len(bats_by_bbref)}")

# Lahman awards (through 2021) — for re-deriving accolades fresh each run
LAHMAN_AWARD_MAP = {
    "Most Valuable Player": "MVP",
    "Cy Young Award": "Cy Young",
    "Gold Glove": "Gold Glove",
    "Silver Slugger": "Silver Slugger",
    "Rookie of the Year": "Rookie of the Year",
    "Triple Crown": "Triple Crown",
    "Pitching Triple Crown": "Pitching Triple Crown",
    "World Series MVP": "WS MVP",
    "All-Star Game MVP": "ASG MVP",
}
lahman_awards_by_bbref: dict[str, list[str]] = defaultdict(list)
hof_by_bbref: set[str] = set()
allstar_by_bbref: dict[str, int] = defaultdict(int)

awards_csv = RAW / "AwardsPlayers.csv"
if awards_csv.exists():
    with open(awards_csv, newline="") as fh:
        for r in csv.DictReader(fh):
            slug = playerid_to_bbref.get(r["playerID"])
            label = LAHMAN_AWARD_MAP.get(r["awardID"])
            if slug and label:
                lahman_awards_by_bbref[slug].append(label)

hof_csv = RAW / "HallOfFame.csv"
if hof_csv.exists():
    with open(hof_csv, newline="") as fh:
        for r in csv.DictReader(fh):
            if r.get("inducted") == "Y" and r.get("category") == "Player":
                slug = playerid_to_bbref.get(r["playerID"])
                if slug:
                    hof_by_bbref.add(slug)

allstar_csv = RAW / "AllstarFull.csv"
if allstar_csv.exists():
    with open(allstar_csv, newline="") as fh:
        for r in csv.DictReader(fh):
            slug = playerid_to_bbref.get(r["playerID"])
            if slug:
                allstar_by_bbref[slug] += 1
print(f"  Lahman awards loaded for {len(lahman_awards_by_bbref)} players; HoF={len(hof_by_bbref)}; AS-coverage={len(allstar_by_bbref)}")


# ---- awards backfill ----

print("Fetching awards 2022+…")
AWARDS = {
    "ALMVP": "MVP", "NLMVP": "MVP",
    "ALCY": "Cy Young", "NLCY": "Cy Young",
    "ALROY": "Rookie of the Year", "NLROY": "Rookie of the Year",
    "ALGG": "Gold Glove", "NLGG": "Gold Glove",
    "ALSS": "Silver Slugger", "NLSS": "Silver Slugger",
    "WSMVP": "WS MVP",
}
awards_by_mlb: dict[str, list[str]] = defaultdict(list)
for award_id, label in AWARDS.items():
    for yr in NEW_YEARS:
        try:
            d = fetch_json(f"{API}/awards/{award_id}/recipients?season={yr}")
            for a in d.get("awards", []):
                pid = str(a.get("player", {}).get("id", ""))
                if pid:
                    awards_by_mlb[pid].append(label)
        except Exception as e:
            print(f"  ! {award_id} {yr}: {e}")
        time.sleep(0.05)
print(f"  collected awards for {len(awards_by_mlb)} player-IDs")


# ---- helpers ----

def parse_innings(ip_str: str) -> int:
    """MLB Stats API returns '132.1' meaning 132+1/3 IP → 397 outs."""
    if not ip_str:
        return 0
    try:
        whole, frac = (ip_str.split(".") + ["0"])[:2]
        return int(whole) * 3 + int(frac[:1] or 0)
    except (ValueError, IndexError):
        return 0


def fmt_ip(ipouts: int) -> str:
    full, rem = divmod(ipouts, 3)
    return f"{full}.{rem}"


def ip_to_float(ip_str: str) -> float:
    if not ip_str: return 0.0
    try:
        whole, frac = (ip_str.split(".") + ["0"])[:2]
        return int(whole) + (int(frac[:1] or 0) / 3.0)
    except (ValueError, IndexError):
        return 0.0


def pct(num: float, den: float, digits: int = 3) -> str:
    if not den: return ""
    v = num / den
    return f"{v:.{digits}f}".lstrip("0") if 0 <= v < 1 else f"{v:.{digits}f}"


def fetch_yearbyyear(mlb_id: str, group: str) -> list[dict]:
    url = f"{API}/people/{mlb_id}/stats?stats=yearByYear&group={group}&hydrate=team"
    try:
        d = fetch_json(url)
        return d.get("stats", [{}])[0].get("splits", []) if d.get("stats") else []
    except Exception as e:
        print(f"  ! {group} fetch failed for {mlb_id}: {e}")
        return []


def fetch_person(mlb_id: str) -> dict:
    try:
        d = fetch_json(f"{API}/people/{mlb_id}")
        return d.get("people", [{}])[0]
    except Exception:
        return {}


# ---- per-player builders ----

def build_batting_row(bb_slug: str, mlb_id: str, split: dict, birth_year: int | None) -> dict:
    s = split["stat"]
    year = str(split.get("season", ""))
    team = norm_team(split.get("team", {}).get("abbreviation", ""))
    age_lookup = age_by_bbref_year.get((bb_slug, year))
    age = str(age_lookup) if age_lookup else (str(int(year) - birth_year) if (birth_year and year) else "")
    lg = TEAM_TO_LG.get(team.upper(), "")
    war = war_bat_year.get((bb_slug, year), 0.0)
    ops_plus = ops_plus_year.get((bb_slug, year), 0.0)
    ab = int(s.get("atBats", 0))
    h  = int(s.get("hits", 0))
    bb_ = int(s.get("baseOnBalls", 0))
    hbp = int(s.get("hitByPitch", 0))
    sf = int(s.get("sacFlies", 0))
    sh = int(s.get("sacBunts", 0))
    pa = ab + bb_ + hbp + sf + sh
    return {
        "_pa": pa, "_h": h, "_hr": int(s.get("homeRuns", 0)),
        "_ab": ab, "_war": war, "_year": year,
        "row": [
            year, age, team, lg,
            f"{war:.1f}" if war else "",
            str(s.get("gamesPlayed", "")),
            str(pa) if pa else "",
            str(ab),
            str(s.get("runs", "")),
            str(h),
            str(s.get("doubles", "")),
            str(s.get("triples", "")),
            str(s.get("homeRuns", "")),
            str(s.get("rbi", "")),
            str(s.get("stolenBases", "")),
            str(s.get("caughtStealing", "")),
            str(bb_),
            str(s.get("strikeOuts", "")),
            s.get("avg", ""),
            s.get("obp", ""),
            s.get("slg", ""),
            s.get("ops", ""),
            str(int(ops_plus)) if ops_plus else "",
        ],
    }


def build_pitching_row(bb_slug: str, mlb_id: str, split: dict, birth_year: int | None) -> dict:
    s = split["stat"]
    year = str(split.get("season", ""))
    team = norm_team(split.get("team", {}).get("abbreviation", ""))
    age_lookup = age_by_bbref_year.get((bb_slug, year))
    age = str(age_lookup) if age_lookup else (str(int(year) - birth_year) if (birth_year and year) else "")
    lg = TEAM_TO_LG.get(team.upper(), "")
    war = war_pit_year.get((bb_slug, year), 0.0)
    era_plus = era_plus_year.get((bb_slug, year), 0.0)
    ipouts = parse_innings(s.get("inningsPitched", ""))
    return {
        "_w": int(s.get("wins", 0)),
        "_so": int(s.get("strikeOuts", 0)),
        "_ipouts": ipouts,
        "_er": int(s.get("earnedRuns", 0)),
        "_war": war,
        "_year": year,
        "row": [
            year, age, team, lg,
            f"{war:.1f}" if war else "",
            str(s.get("wins", "")),
            str(s.get("losses", "")),
            s.get("era", ""),
            str(s.get("gamesPitched", "")),
            str(s.get("gamesStarted", "")),
            str(s.get("completeGames", "")),
            str(s.get("shutouts", "")),
            str(s.get("saves", "")),
            s.get("inningsPitched", ""),
            str(s.get("hits", "")),
            str(s.get("earnedRuns", "")),
            str(s.get("homeRuns", "")),
            str(s.get("baseOnBalls", "")),
            str(s.get("strikeOuts", "")),
            str(int(era_plus)) if era_plus else "",
        ],
    }


HAND = {"L": "Left", "R": "Right", "B": "Both", "S": "Switch"}

COUNTRY_NORMALIZE = {
    "USA":"USA","D.R.":"the Dominican Republic","DR":"the Dominican Republic","DO":"the Dominican Republic",
    "P.R.":"Puerto Rico","PR":"Puerto Rico","CAN":"Canada","V.I.":"the U.S. Virgin Islands",
    "Curacao":"Curaçao","Curaçao":"Curaçao",
}

def fmt_hometown(country, state, city):
    country = (country or "").strip()
    state = (state or "").strip()
    city = (city or "").strip()
    if not country: return None
    if country == "USA":
        if city and state: return f"Hometown: {city}, {state}"
        if state:         return f"Hometown: {state}"
        return "Hometown: USA"
    return f"Born in {COUNTRY_NORMALIZE.get(country, country)}"

def fmt_height_weight(inches_str, weight_str):
    parts = []
    try:
        h = int(inches_str); parts.append(f"{h // 12}'{h % 12}\"")
    except (ValueError, TypeError): pass
    try:
        w = int(float(weight_str)); parts.append(f"{w} lb")
    except (ValueError, TypeError): pass
    return ("Build: " + ", ".join(parts)) if parts else None


def build_accolades_line(bb_slug: str, mlb_id: str | None) -> str:
    """Derive accolades fresh: Lahman (≤2021) + MLB API (2022+) + HoF + AS count."""
    counts: dict[str, int] = defaultdict(int)
    for a in lahman_awards_by_bbref.get(bb_slug, []):
        counts[a] += 1
    if mlb_id:
        for a in awards_by_mlb.get(mlb_id, []):
            counts[a] += 1
    parts: list[str] = []
    if bb_slug in hof_by_bbref:
        parts.append("Hall of Famer")
    asg = allstar_by_bbref.get(bb_slug, 0)
    if asg:
        parts.append(f"{asg}x All-Star" if asg > 1 else "All-Star")
    for label, n in counts.items():
        if n <= 0: continue
        parts.append(f"{n}x {label}" if n > 1 else label)
    return "Accolades: " + (", ".join(parts) if parts else "no major awards")


def recompute_hints(player: dict, awards_extra: list[str], bb_slug: str, mlb_id: str | None) -> list[str]:
    """Recompute hints from scratch using player['rows'] + Lahman + MLB API awards."""
    headers = [h["stat"] for h in player["headers"]]
    war_col = "p_war" if player["kind"] == "pitching" else "b_war"
    year_col = "year_id"
    war_idx = headers.index(war_col) if war_col in headers else -1
    year_idx = headers.index(year_col)
    war_by_year: dict[str, float] = defaultdict(float)
    for row in player["rows"]:
        try:
            war_by_year[row[year_idx]] += float(row[war_idx] or 0) if war_idx >= 0 else 0
        except (ValueError, IndexError):
            pass
    best_war = max(war_by_year.values(), default=0.0)

    # Career line
    if player["kind"] == "pitching":
        w_idx = headers.index("p_w"); so_idx = headers.index("p_so")
        er_idx = headers.index("p_er"); ip_idx = headers.index("p_ip")
        wins = sum(int(r[w_idx] or 0) for r in player["rows"])
        ks = sum(int(r[so_idx] or 0) for r in player["rows"])
        er = sum(int(r[er_idx] or 0) for r in player["rows"])
        ipouts = sum(parse_innings(r[ip_idx]) for r in player["rows"])
        ip = ipouts / 3.0
        era = (er * 9.0) / ip if ip else 0.0
        career_line = f"{wins} wins, {ks} K, {era:.2f} ERA"
    else:
        hr_idx = headers.index("b_hr"); h_idx = headers.index("b_h"); ab_idx = headers.index("b_ab")
        hr = sum(int(r[hr_idx] or 0) for r in player["rows"])
        h  = sum(int(r[h_idx]  or 0) for r in player["rows"])
        ab = sum(int(r[ab_idx] or 0) for r in player["rows"])
        career_line = f"{hr} HR, {h} hits, " + pct(h, ab) + " BA"

    accolades_line = build_accolades_line(bb_slug, mlb_id)

    pos = player.get("primary_position", "")
    bats = player.get("bats") or bats_by_bbref.get(bb_slug, "")
    throws = player.get("throws") or throws_by_bbref.get(bb_slug, "")
    bt = []
    if bats: bt.append(f"bats {HAND.get(bats, bats)}")
    if throws: bt.append(f"throws {HAND.get(throws, throws)}")
    pos_label = pos or _extract_position_label_from_hints(player.get("hints", []))
    if not bt:
        # Last-resort fallback: parse the existing position hint
        bt = _extract_bt_from_hints(player.get("hints", []))

    name = player["name"]
    tokens = [t for t in name.split() if t.rstrip(".").lower() not in {"jr", "sr", "ii", "iii", "iv"}]
    last = tokens[-1] if tokens else name
    initial = next((c for c in last if c.isalpha()), "?").upper()

    # Hometown / build — pull from Lahman People.csv first, fall back to whatever
    # was already in the existing hint list, then MLB API would only run on rebuild.
    hometown = (player.get("hometown_hint") or _extract_line(player.get("hints", []),
                ("Hometown:", "Born in ")) or
                fmt_hometown(*lahman_person_for(bb_slug)))
    build = (player.get("build_hint") or _extract_line(player.get("hints", []), ("Build:",)) or
             fmt_height_weight(*lahman_height_weight_for(bb_slug)))

    out = [
        f"Position: {pos_label}" + (f" — {', '.join(bt)}" if bt else ""),
        f"Best single-season WAR: {best_war:.1f}" if best_war else "Best single-season WAR: n/a",
        f"Career: {career_line}",
        accolades_line,
    ]
    if hometown: out.append(hometown)
    if build:    out.append(build)
    out.append(f"Last name starts with: {initial}")
    return out


_LAHMAN_PERSON_CACHE = {}
def lahman_person_for(bb_slug):
    if bb_slug in _LAHMAN_PERSON_CACHE: return _LAHMAN_PERSON_CACHE[bb_slug]
    # birth_year_by_bbref was already loaded; we need broader People.csv data
    if not (RAW / "People.csv").exists():
        _LAHMAN_PERSON_CACHE[bb_slug] = (None, None, None)
        return _LAHMAN_PERSON_CACHE[bb_slug]
    # Build cache on first call
    if not _LAHMAN_PERSON_CACHE:
        with open(RAW / "People.csv", newline="") as fh:
            for r in csv.DictReader(fh):
                slug = r.get("bbrefID") or r.get("playerID")
                if slug:
                    _LAHMAN_PERSON_CACHE[slug] = (
                        r.get("birthCountry"), r.get("birthState"), r.get("birthCity"),
                    )
    return _LAHMAN_PERSON_CACHE.get(bb_slug, (None, None, None))

_LAHMAN_HW_CACHE = {}
def lahman_height_weight_for(bb_slug):
    if bb_slug in _LAHMAN_HW_CACHE: return _LAHMAN_HW_CACHE[bb_slug]
    if not (RAW / "People.csv").exists():
        _LAHMAN_HW_CACHE[bb_slug] = (None, None); return _LAHMAN_HW_CACHE[bb_slug]
    if not _LAHMAN_HW_CACHE:
        with open(RAW / "People.csv", newline="") as fh:
            for r in csv.DictReader(fh):
                slug = r.get("bbrefID") or r.get("playerID")
                if slug:
                    _LAHMAN_HW_CACHE[slug] = (r.get("height"), r.get("weight"))
    return _LAHMAN_HW_CACHE.get(bb_slug, (None, None))


def _extract_line(hints, prefixes):
    for h in hints or []:
        if any(h.startswith(p) for p in prefixes):
            return h
    return None


def _extract_position_label_from_hints(hints: list[str]) -> str:
    if not hints: return ""
    h = hints[0]
    if h.startswith("Position:"):
        body = h[len("Position:"):].strip()
        return body.split(" — ")[0].strip()
    return ""


def _extract_bt_from_hints(hints: list[str]) -> list[str]:
    if not hints: return []
    h = hints[0]
    if " — " not in h:
        return []
    tail = h.split(" — ", 1)[1]
    return [s.strip() for s in tail.split(",") if s.strip()]


POS_LABEL_MAP = {
    "Pitcher": "Pitcher", "Catcher": "Catcher",
    "First Baseman": "First Baseman", "Second Baseman": "Second Baseman",
    "Third Baseman": "Third Baseman", "Shortstop": "Shortstop",
    "Left Fielder": "Leftfielder", "Center Fielder": "Centerfielder",
    "Right Fielder": "Rightfielder", "Outfielder": "Outfielder",
    "Designated Hitter": "Designated Hitter", "Two-Way Player": "Two-Way",
}


# ---- main loop ----

print(f"Updating players with {NEW_YEARS[0]}+ data…")
manifest = json.loads(MANIFEST_PATH.read_text())
manifest_ids = {tier: {p["id"] for p in manifest[tier]} for tier in ("famous", "pros", "alltime")}
manifest_entry = {p["id"]: p for tier in manifest for p in manifest[tier]}

candidates = sorted(players_with_recent_bat | players_with_recent_pit)
print(f"  {len(candidates)} candidate players")

updated_existing = 0
created_new = 0
skipped = 0
for i, bb_slug in enumerate(candidates):
    if i % 50 == 0:
        print(f"  …{i}/{len(candidates)}  (updated={updated_existing} new={created_new} skipped={skipped})")
    mlb_id = bbref_to_mlb.get(bb_slug)
    if not mlb_id:
        skipped += 1; continue

    json_path = OUT / f"{bb_slug}.json"
    is_existing = json_path.exists()

    if is_existing:
        player = json.loads(json_path.read_text())
        kind = player["kind"]
        # Idempotency: drop any 2022+ rows so we rebuild them fresh each run
        player["rows"] = [r for r in player["rows"] if not (r and r[0] and r[0].isdigit() and int(r[0]) >= NEW_YEARS[0])]
        splits = fetch_yearbyyear(mlb_id, "hitting" if kind == "batting" else "pitching")
        birth_year = birth_year_by_bbref.get(bb_slug)
        new_rows = []
        for s in splits:
            yr = str(s.get("season", ""))
            if not yr or int(yr) < NEW_YEARS[0]:
                continue
            # Skip MLB API's "season total" combined row for traded players (no team set)
            if not s.get("team", {}).get("abbreviation"):
                continue
            if kind == "batting":
                built = build_batting_row(bb_slug, mlb_id, s, birth_year)
            else:
                built = build_pitching_row(bb_slug, mlb_id, s, birth_year)
            new_rows.append(built)
        # Append rows in season order (preserve existing order, then add new in season order)
        if new_rows:
            player["rows"].extend(r["row"] for r in sorted(new_rows, key=lambda r: r["_year"]))
        # Always recompute hints so fixes (e.g., bats/throws extraction) take effect on re-run
        awards_extra = awards_by_mlb.get(mlb_id, [])
        player["hints"] = recompute_hints(player, awards_extra, bb_slug, mlb_id)
        json_path.write_text(json.dumps(player, separators=(",", ":")))
        if new_rows:
            updated_existing += 1
        else:
            skipped += 1
        time.sleep(0.04 if not new_rows else 0.08)
        continue

    # Brand-new player
    person = fetch_person(mlb_id)
    name = person.get("fullName") or name_by_bbref.get(bb_slug, "")
    if not name:
        skipped += 1; continue
    birth_year = None
    try: birth_year = int((person.get("birthDate") or "")[:4])
    except ValueError: pass
    bats = (person.get("batSide") or {}).get("code", "")
    throws = (person.get("pitchHand") or {}).get("code", "")
    pos = ((person.get("primaryPosition") or {}).get("name") or "")
    pos_label = POS_LABEL_MAP.get(pos, pos)
    is_pitcher = pos == "Pitcher"

    splits_bat = [] if is_pitcher else fetch_yearbyyear(mlb_id, "hitting")
    splits_pit = fetch_yearbyyear(mlb_id, "pitching") if is_pitcher else []

    if is_pitcher:
        splits_pit = [s for s in splits_pit if s.get("team", {}).get("abbreviation")]
        rows_obj = [build_pitching_row(bb_slug, mlb_id, s, birth_year) for s in splits_pit]
        career_ipouts = sum(r["_ipouts"] for r in rows_obj)
        if career_ipouts < CAREER_IPOUTS_MIN:
            skipped += 1; continue
        kind = "pitching"
        headers = [
            ("year_id", "Season"), ("age", "Age"), ("team_name_abbr", "Team"), ("comp_name_abbr", "Lg"),
            ("p_war", "WAR"), ("p_w", "W"), ("p_l", "L"), ("p_earned_run_avg", "ERA"),
            ("p_g", "G"), ("p_gs", "GS"), ("p_cg", "CG"), ("p_sho", "SHO"), ("p_sv", "SV"),
            ("p_ip", "IP"), ("p_h", "H"), ("p_er", "ER"), ("p_hr", "HR"),
            ("p_bb", "BB"), ("p_so", "SO"), ("p_era_plus", "ERA+"),
        ]
    else:
        splits_bat = [s for s in splits_bat if s.get("team", {}).get("abbreviation")]
        rows_obj = [build_batting_row(bb_slug, mlb_id, s, birth_year) for s in splits_bat]
        career_pa = sum(r["_pa"] for r in rows_obj)
        if career_pa < CAREER_PA_MIN:
            skipped += 1; continue
        kind = "batting"
        headers = [
            ("year_id", "Season"), ("age", "Age"), ("team_name_abbr", "Team"), ("comp_name_abbr", "Lg"),
            ("b_war", "WAR"), ("b_games", "G"), ("b_pa", "PA"), ("b_ab", "AB"),
            ("b_r", "R"), ("b_h", "H"), ("b_doubles", "2B"), ("b_triples", "3B"),
            ("b_hr", "HR"), ("b_rbi", "RBI"), ("b_sb", "SB"), ("b_cs", "CS"),
            ("b_bb", "BB"), ("b_so", "SO"),
            ("b_batting_avg", "BA"), ("b_onbase_perc", "OBP"),
            ("b_slugging_perc", "SLG"), ("b_onbase_plus_slugging", "OPS"),
            ("b_onbase_plus_slugging_plus", "OPS+"),
        ]

    # Sort by year
    rows_obj.sort(key=lambda r: r["_year"])

    player = {
        "slug": bb_slug,
        "name": name,
        "br_url": f"https://www.baseball-reference.com/players/{bb_slug[0]}/{bb_slug}.shtml",
        "kind": kind,
        "headers": [{"stat": s, "label": l} for s, l in headers],
        "rows": [r["row"] for r in rows_obj],
        "hidden_cols": [],
        "primary_position": pos_label,
        "bats": bats, "throws": throws,
        "hints": [],
    }
    awards_extra = awards_by_mlb.get(mlb_id, [])
    player["hints"] = recompute_hints(player, awards_extra, bb_slug, mlb_id)

    # Tier classification
    if kind == "pitching":
        career_war = sum(r["_war"] for r in rows_obj)
        career_pa = 0
        career_ipouts = sum(r["_ipouts"] for r in rows_obj)
    else:
        career_war = sum(r["_war"] for r in rows_obj)
        career_pa = sum(r["_pa"] for r in rows_obj)
        career_ipouts = 0
    is_famous = (
        career_war >= 30
        or any(a in awards_extra for a in ("MVP", "Cy Young", "Rookie of the Year"))
    )
    is_pros = career_pa >= 5000 or career_ipouts >= 4500
    if is_famous:
        tier = "famous"
    elif is_pros:
        tier = "pros"
    else:
        tier = "alltime"

    json_path.write_text(json.dumps({k: v for k, v in player.items() if k not in ("primary_position","bats","throws")}, separators=(",", ":")))
    entry = {"id": bb_slug, "name": name}
    if tier == "famous":
        for t in ("famous", "pros", "alltime"):
            if bb_slug not in manifest_ids[t]:
                manifest[t].append(entry); manifest_ids[t].add(bb_slug)
    elif tier == "pros":
        for t in ("pros", "alltime"):
            if bb_slug not in manifest_ids[t]:
                manifest[t].append(entry); manifest_ids[t].add(bb_slug)
    else:
        if bb_slug not in manifest_ids["alltime"]:
            manifest["alltime"].append(entry); manifest_ids["alltime"].add(bb_slug)
    created_new += 1
    time.sleep(0.08)

# Persist manifest
for tier in manifest:
    manifest[tier].sort(key=lambda p: p["name"])
MANIFEST_PATH.write_text(json.dumps(manifest, separators=(",", ":")))

print(f"\nDone. updated_existing={updated_existing} created_new={created_new} skipped={skipped}")
print(f"  famous: {len(manifest['famous'])}, pros: {len(manifest['pros'])}, alltime: {len(manifest['alltime'])}")
