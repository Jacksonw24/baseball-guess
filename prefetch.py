"""
Build the static dataset for baseball-guess.

Reads:  data/raw/{People,Batting,Pitching,AwardsPlayers,HallOfFame,AllstarFull,
                  Appearances,war_bat,war_pit}.csv|.txt
Writes: data/manifest.json
        data/players/{slug}.json

Run:    python3 prefetch.py
"""
import csv
import json
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "players"
OUT.mkdir(parents=True, exist_ok=True)

CAREER_PA_MIN = 400  # for hitters; pitchers gated separately on innings


# ---------------- helpers ----------------

def i(s, default=0):
    try: return int(s) if s not in ("", None) else default
    except ValueError: return default

def f(s, default=0.0):
    try: return float(s) if s not in ("", None) else default
    except ValueError: return default

def pct(num, den, digits=3):
    if not den: return ""
    v = num / den
    return f"{v:.{digits}f}".lstrip("0") if 0 <= v < 1 else f"{v:.{digits}f}"

def fmt_ip(ipouts):
    full, rem = divmod(int(ipouts), 3)
    return f"{full}.{rem}"

TEAM_NORMALIZE = {
    "NYA":"NYY","NYN":"NYM","CHN":"CHC","CHA":"CHW","CWS":"CHW",
    "SLN":"STL","LAN":"LAD","SFN":"SFG","SF":"SFG","SDN":"SDP","SD":"SDP",
    "KCA":"KCR","KC":"KCR","TBA":"TBR","TB":"TBR","TBD":"TBR",
    "CAL":"LAA","ANA":"LAA","FLO":"MIA","FLA":"MIA",
    "WAS":"WSN","WSH":"WSN","ATH":"OAK","ML4":"MIL","AZ":"ARI",
}

def norm_team(t):
    return TEAM_NORMALIZE.get(t, t) if t else t


COUNTRY_NORMALIZE_PREFETCH = {
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
    return f"Born in {COUNTRY_NORMALIZE_PREFETCH.get(country, country)}"

def fmt_height_weight(inches_str, weight_str):
    parts = []
    try:
        h = int(inches_str)
        parts.append(f"{h // 12}'{h % 12}\"")
    except (ValueError, TypeError): pass
    try:
        w = int(float(weight_str))
        parts.append(f"{w} lb")
    except (ValueError, TypeError): pass
    if not parts: return None
    return "Build: " + ", ".join(parts)


def safe_div(num, den):
    return num / den if den else 0.0


# ---------------- load reference data ----------------

print("Loading People…")
people = {}  # playerID -> dict
with open(RAW / "People.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        people[r["playerID"]] = {
            "name": f'{r["nameFirst"]} {r["nameLast"]}'.strip(),
            "bbref": r["bbrefID"] or r["playerID"],
            "bats": r["bats"], "throws": r["throws"],
            "born_state": r.get("birthState",""), "born_city": r.get("birthCity",""),
            "debut": r["debut"][:4] if r["debut"] else "",
            "final": r["finalGame"][:4] if r["finalGame"] else "",
            "born_country": r["birthCountry"],
            "weight": r["weight"], "height": r["height"],
        }

print(f"  {len(people)} players")

print("Loading Appearances → primary position…")
pos_games = defaultdict(lambda: defaultdict(int))
POS_KEYS = ["G_p", "G_c", "G_1b", "G_2b", "G_3b", "G_ss", "G_lf", "G_cf", "G_rf", "G_dh"]
POS_LABEL = {"G_p": "Pitcher", "G_c": "Catcher",
             "G_1b": "First Baseman", "G_2b": "Second Baseman",
             "G_3b": "Third Baseman", "G_ss": "Shortstop",
             "G_lf": "Leftfielder", "G_cf": "Centerfielder",
             "G_rf": "Rightfielder", "G_dh": "Designated Hitter"}
with open(RAW / "Appearances.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        pid = r["playerID"]
        for k in POS_KEYS:
            pos_games[pid][k] += i(r.get(k, 0))

primary_pos = {}
for pid, gs in pos_games.items():
    best = max(POS_KEYS, key=lambda k: gs[k])
    primary_pos[pid] = best  # POS_KEYS key like "G_ss"

print("Loading AwardsPlayers…")
awards_by_player = defaultdict(lambda: defaultdict(int))
with open(RAW / "AwardsPlayers.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        awards_by_player[r["playerID"]][r["awardID"]] += 1

print("Loading HallOfFame…")
hof = set()
with open(RAW / "HallOfFame.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        if r["inducted"] == "Y" and r["category"] == "Player":
            hof.add(r["playerID"])

print("Loading All-Star selections…")
allstar_count = defaultdict(int)
with open(RAW / "AllstarFull.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        allstar_count[r["playerID"]] += 1

print("Loading bWAR (batting)…")
war_bat = defaultdict(float)   # (playerID, year) -> WAR
ops_plus_year = defaultdict(float)
with open(RAW / "war_bat.txt", newline="") as fh:
    for r in csv.DictReader(fh):
        pid = r["player_ID"]; year = r["year_ID"]
        try: war_bat[(pid, year)] += float(r["WAR"] or 0)
        except ValueError: pass
        try: ops_plus_year[(pid, year)] = max(ops_plus_year[(pid, year)], float(r["OPS_plus"] or 0))
        except ValueError: pass

print("Loading bWAR (pitching)…")
war_pit = defaultdict(float)
era_plus_year = defaultdict(float)
with open(RAW / "war_pit.txt", newline="") as fh:
    for r in csv.DictReader(fh):
        pid = r["player_ID"]; year = r["year_ID"]
        try: war_pit[(pid, year)] += float(r["WAR"] or 0)
        except ValueError: pass
        try: era_plus_year[(pid, year)] = max(era_plus_year[(pid, year)], float(r["ERA_plus"] or 0))
        except ValueError: pass


# ---------------- load season stats ----------------

print("Loading Batting…")
batting = defaultdict(list)  # playerID -> [row dict]
with open(RAW / "Batting.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        batting[r["playerID"]].append(r)

print("Loading Pitching…")
pitching = defaultdict(list)
with open(RAW / "Pitching.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        pitching[r["playerID"]].append(r)


# ---------------- build per-player ----------------

BATTING_HEADERS = [
    ("year_id", "Season"),
    ("age", "Age"),
    ("team_name_abbr", "Team"),
    ("comp_name_abbr", "Lg"),
    ("b_war", "WAR"),
    ("b_games", "G"),
    ("b_pa", "PA"),
    ("b_ab", "AB"),
    ("b_r", "R"),
    ("b_h", "H"),
    ("b_doubles", "2B"),
    ("b_triples", "3B"),
    ("b_hr", "HR"),
    ("b_rbi", "RBI"),
    ("b_sb", "SB"),
    ("b_cs", "CS"),
    ("b_bb", "BB"),
    ("b_so", "SO"),
    ("b_batting_avg", "BA"),
    ("b_onbase_perc", "OBP"),
    ("b_slugging_perc", "SLG"),
    ("b_onbase_plus_slugging", "OPS"),
    ("b_onbase_plus_slugging_plus", "OPS+"),
]

PITCHING_HEADERS = [
    ("year_id", "Season"),
    ("age", "Age"),
    ("team_name_abbr", "Team"),
    ("comp_name_abbr", "Lg"),
    ("p_war", "WAR"),
    ("p_w", "W"),
    ("p_l", "L"),
    ("p_earned_run_avg", "ERA"),
    ("p_g", "G"),
    ("p_gs", "GS"),
    ("p_cg", "CG"),
    ("p_sho", "SHO"),
    ("p_sv", "SV"),
    ("p_ip", "IP"),
    ("p_h", "H"),
    ("p_er", "ER"),
    ("p_hr", "HR"),
    ("p_bb", "BB"),
    ("p_so", "SO"),
    ("p_era_plus", "ERA+"),
]

# Awards we surface in hints
AWARD_MAP = {
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


def age_at(year: int, birth_year: int) -> str:
    if not birth_year: return ""
    return str(year - birth_year)


def build_batting_row(player: dict, r: dict) -> dict:
    pid = r["playerID"]; year = r["yearID"]
    ab = i(r["AB"]); bb = i(r["BB"]); hbp = i(r["HBP"]); sf = i(r["SF"]); sh = i(r["SH"])
    h = i(r["H"]); _2b = i(r["2B"]); _3b = i(r["3B"]); hr = i(r["HR"])
    pa = ab + bb + hbp + sf + sh
    tb = h + _2b + 2 * _3b + 3 * hr
    ba = safe_div(h, ab)
    obp = safe_div(h + bb + hbp, ab + bb + hbp + sf)
    slg = safe_div(tb, ab)
    ops = obp + slg
    war = war_bat.get((pid, year), 0.0)
    ops_plus = ops_plus_year.get((pid, year), 0.0)
    birth = i(player.get("birth_year"))
    return {
        "year_id": year,
        "age": age_at(int(year), birth),
        "team_name_abbr": norm_team(r["teamID"]),
        "comp_name_abbr": r["lgID"],
        "b_war": f"{war:.1f}" if war else "",
        "b_games": r["G"],
        "b_pa": str(pa),
        "b_ab": r["AB"],
        "b_r": r["R"],
        "b_h": r["H"],
        "b_doubles": r["2B"],
        "b_triples": r["3B"],
        "b_hr": r["HR"],
        "b_rbi": r["RBI"],
        "b_sb": r["SB"],
        "b_cs": r["CS"],
        "b_bb": r["BB"],
        "b_so": r["SO"],
        "b_batting_avg": pct(h, ab) if ab else "",
        "b_onbase_perc": pct(h + bb + hbp, ab + bb + hbp + sf) if (ab + bb + hbp + sf) else "",
        "b_slugging_perc": pct(tb, ab) if ab else "",
        "b_onbase_plus_slugging": f"{ops:.3f}".lstrip("0") if ops else "",
        "b_onbase_plus_slugging_plus": str(int(ops_plus)) if ops_plus else "",
        # for internal use, not displayed
        "_pa": pa, "_h": h, "_hr": hr, "_rbi": i(r["RBI"]), "_ab": ab, "_war": war,
    }


def build_pitching_row(player: dict, r: dict) -> dict:
    pid = r["playerID"]; year = r["yearID"]
    ipouts = i(r["IPouts"])
    ip = ipouts / 3.0
    er = i(r["ER"])
    era = (er * 9.0) / ip if ip else 0.0
    war = war_pit.get((pid, year), 0.0)
    era_plus = era_plus_year.get((pid, year), 0.0)
    birth = i(player.get("birth_year"))
    return {
        "year_id": year,
        "age": age_at(int(year), birth),
        "team_name_abbr": norm_team(r["teamID"]),
        "comp_name_abbr": r["lgID"],
        "p_war": f"{war:.1f}" if war else "",
        "p_w": r["W"], "p_l": r["L"],
        "p_earned_run_avg": f"{era:.2f}" if ip else "",
        "p_g": r["G"], "p_gs": r["GS"], "p_cg": r["CG"], "p_sho": r["SHO"], "p_sv": r["SV"],
        "p_ip": fmt_ip(ipouts) if ipouts else "",
        "p_h": r["H"], "p_er": r["ER"], "p_hr": r["HR"], "p_bb": r["BB"], "p_so": r["SO"],
        "p_era_plus": str(int(era_plus)) if era_plus else "",
        # internal
        "_w": i(r["W"]), "_so": i(r["SO"]), "_ipouts": ipouts, "_er": er, "_war": war,
    }


def normalize_awards(pid: str) -> list[str]:
    bag = awards_by_player.get(pid, {})
    out = []
    if pid in hof:
        out.append("Hall of Famer")
    asg = allstar_count.get(pid, 0)
    if asg:
        out.append(f"{asg}x All-Star")
    for k, label in AWARD_MAP.items():
        n = bag.get(k, 0)
        if n:
            out.append(f"{n}x {label}" if n > 1 else label)
    return out


def classify_tiers(career_war: float, career_pa: int, career_ipouts: int,
                   pid: str, asg_count: int) -> list[str]:
    """Cumulative tier membership: well_known ⊂ ball_knowledge ⊂ stathead ⊂ psycho."""
    is_hof = pid in hof
    mvps = awards_by_player[pid].get("Most Valuable Player", 0)
    cys  = awards_by_player[pid].get("Cy Young Award", 0)
    well_known     = is_hof or mvps >= 2 or cys >= 2 or career_war >= 70 or asg_count >= 10
    ball_knowledge = well_known or mvps >= 1 or cys >= 1 or career_war >= 35 or asg_count >= 5
    stathead       = ball_knowledge or career_pa >= 4000 or career_ipouts >= 3000
    tiers = ["psycho"]                          # everyone
    if stathead:       tiers.append("stathead")
    if ball_knowledge: tiers.append("ball_knowledge")
    if well_known:     tiers.append("well_known")
    return tiers


def build_player(pid: str, person: dict) -> dict | None:
    # Decide kind by primary position
    pos_key = primary_pos.get(pid, "")
    is_pitcher = (pos_key == "G_p")
    rows_src = pitching[pid] if is_pitcher else batting[pid]
    if not rows_src:
        rows_src = pitching[pid] or batting[pid]
        is_pitcher = bool(pitching[pid]) and not batting[pid]
    if not rows_src:
        return None

    # Inject birth_year for age calc
    person = dict(person)
    person["birth_year"] = person.get("birth_year") or ""

    if is_pitcher:
        built = [build_pitching_row(person, r) for r in rows_src]
        career_ipouts = sum(r["_ipouts"] for r in built)
        career_pa = 0
        # Gate pitchers separately — need at least 50 IP career to be playable
        if career_ipouts < 150:
            return None
    else:
        built = [build_batting_row(person, r) for r in rows_src]
        career_pa = sum(r["_pa"] for r in built)
        career_ipouts = 0
        if career_pa < CAREER_PA_MIN:
            return None

    # Career totals
    if is_pitcher:
        career_w = sum(r["_w"] for r in built)
        career_so = sum(r["_so"] for r in built)
        career_er = sum(r["_er"] for r in built)
        career_ip = career_ipouts / 3.0
        career_era = (career_er * 9.0) / career_ip if career_ip else 0.0
        career_line = f"{career_w} wins, {career_so} K, {career_era:.2f} ERA" if career_ip else None
    else:
        career_h = sum(r["_h"] for r in built)
        career_hr = sum(r["_hr"] for r in built)
        career_ab = sum(r["_ab"] for r in built)
        career_ba = safe_div(career_h, career_ab)
        career_line = f"{career_hr} HR, {career_h} hits, " + pct(career_h, career_ab) + " BA"

    # Best single-season WAR (sum stints by year, then max)
    war_by_year = defaultdict(float)
    for r in built:
        try: war_by_year[r["year_id"]] += float(r.get("b_war") or r.get("p_war") or 0)
        except ValueError: pass
    best_war = max(war_by_year.values(), default=0.0)
    career_war = sum(war_by_year.values())

    # Build display rows (drop internal _ keys)
    headers = PITCHING_HEADERS if is_pitcher else BATTING_HEADERS
    display_rows = []
    for r in built:
        display_rows.append([r.get(stat, "") for stat, _label in headers])

    # Position label
    pos_label = POS_LABEL.get(pos_key, "Unknown")

    # Awards
    awards = normalize_awards(pid)
    asg = allstar_count.get(pid, 0)
    tiers = classify_tiers(career_war, career_pa, career_ipouts, pid, asg)

    # Hints
    hand = {"L": "Left", "R": "Right", "B": "Both", "S": "Switch"}
    bt = []
    if person.get("bats"):   bt.append(f"bats {hand.get(person['bats'], person['bats'])}")
    if person.get("throws"): bt.append(f"throws {hand.get(person['throws'], person['throws'])}")
    hints = [
        f"Position: {pos_label}" + (f" — {', '.join(bt)}" if bt else ""),
        f"Career: {career_line}" if career_line else "Career totals unavailable",
    ]
    # Hometown + Build (height/weight)
    home = fmt_hometown(person.get("born_country"), person.get("born_state"), person.get("born_city"))
    if home: hints.append(home)
    build = fmt_height_weight(person.get("height"), person.get("weight"))
    if build: hints.append(build)
    # Last-name initial
    last = person["name"].split()[-1] if person["name"] else ""
    initial = next((c for c in last if c.isalpha()), "?").upper()
    hints.append(f"Last name starts with: {initial}")

    slug = person["bbref"] or pid
    return {
        "slug": slug,
        "name": person["name"],
        "br_url": f"https://www.baseball-reference.com/players/{slug[0]}/{slug}.shtml",
        "kind": "pitching" if is_pitcher else "batting",
        "headers": [{"stat": s, "label": l} for s, l in headers],
        "rows": display_rows,
        "hidden_cols": [],
        "hints": hints,
        "tiers": tiers,
        "career_pa": career_pa,
        "career_ipouts": career_ipouts,
    }


# ---------------- main loop ----------------

print("Building players…")
# Attach birth years
for pid, p in people.items():
    # Re-open People to get birthYear; cheaper to re-read once than refactor
    pass
# Read birth years
birth_years = {}
with open(RAW / "People.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        birth_years[r["playerID"]] = r["birthYear"]
for pid, p in people.items():
    p["birth_year"] = birth_years.get(pid, "")

manifest = {"well_known": [], "ball_knowledge": [], "stathead": [], "psycho": []}
written = 0
skipped = 0
all_ids = set(batting.keys()) | set(pitching.keys())
for pid in sorted(all_ids):
    if pid not in people:
        skipped += 1; continue
    person = people[pid]
    if not person["name"].strip():
        skipped += 1; continue
    try:
        data = build_player(pid, person)
    except Exception as e:
        print(f"  ! skip {pid}: {e}")
        skipped += 1; continue
    if not data:
        skipped += 1; continue
    slug = data["slug"]
    (OUT / f"{slug}.json").write_text(json.dumps({
        k: v for k, v in data.items() if k not in ("tiers", "career_pa", "career_ipouts")
    }, separators=(",", ":")))
    entry = {"id": slug, "name": data["name"]}
    # Cumulative membership: each tier the player qualifies for gets a copy
    for tier in data["tiers"]:
        manifest[tier].append(entry)
    written += 1

(ROOT / "data" / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
print(f"Done. Wrote {written} players, skipped {skipped}.")
for t in ("well_known", "ball_knowledge", "stathead", "psycho"):
    print(f"  {t:<15} {len(manifest[t]):>6}")
