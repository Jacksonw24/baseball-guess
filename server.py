"""
Baseball player guessing game — local server.

Run:  python3 server.py
Then open http://localhost:8000 on your phone (same Wi-Fi) or laptop.
"""
import http.server
import json
import os
import random
import re
import socketserver
import unicodedata
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).parent
PORT = 8000
UA = "Mozilla/5.0 (baseball-guess prototype; personal use)"
BR_BASE = "https://www.baseball-reference.com/players"
FETCH_TIMEOUT = 10
PAGE_CACHE: dict[str, str] = {}


def load_players() -> list[dict]:
    return json.loads((ROOT / "players.json").read_text())


# ---------- BR page fetch + parse ----------

def fetch_player_page(br_id: str) -> str:
    if br_id in PAGE_CACHE:
        return PAGE_CACHE[br_id]
    url = f"{BR_BASE}/{br_id[0]}/{br_id}.shtml"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        raw = resp.read()
    # BR sometimes serves gzip even without Accept-Encoding; urllib doesn't auto-decode.
    if raw[:2] == b"\x1f\x8b":
        import gzip
        raw = gzip.decompress(raw)
    html = raw.decode("utf-8", errors="replace")
    PAGE_CACHE[br_id] = html
    return html


def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def first_match(pattern: str, html: str, group: int = 1) -> str | None:
    m = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
    return m.group(group).strip() if m else None


TEAM_ABBR = {
    "ANA": "Angels", "LAA": "Angels", "CAL": "Angels",
    "ARI": "Diamondbacks",
    "ATL": "Braves", "BSN": "Braves", "MLN": "Braves",
    "BAL": "Orioles", "SLB": "Browns",
    "BOS": "Red Sox",
    "CHC": "Cubs", "CHW": "White Sox",
    "CIN": "Reds",
    "CLE": "Guardians",
    "COL": "Rockies",
    "DET": "Tigers",
    "HOU": "Astros",
    "KCR": "Royals", "KCA": "A's",
    "LAD": "Dodgers", "BRO": "Dodgers",
    "MIA": "Marlins", "FLA": "Marlins",
    "MIL": "Brewers",
    "MIN": "Twins",
    "NYM": "Mets",
    "NYY": "Yankees", "NYG": "Giants",
    "OAK": "Athletics", "PHA": "Athletics",
    "PHI": "Phillies",
    "PIT": "Pirates",
    "SDP": "Padres",
    "SEA": "Mariners",
    "SFG": "Giants",
    "STL": "Cardinals",
    "TBR": "Rays", "TBD": "Devil Rays",
    "TEX": "Rangers", "WSH": "Senators",
    "TOR": "Blue Jays",
    "WSN": "Nationals", "MON": "Expos",
}


def extract_meta_block(html: str) -> str:
    """Grab the area around id='meta' generously so awards/teams text is included."""
    m = re.search(r'id=["\']meta["\']', html)
    if not m:
        return ""
    start = m.start()
    return strip_tags(html[start:start + 60000])


def extract_position(meta: str) -> str | None:
    m = re.search(r"Position[s]?:\s*([A-Za-z,\s/-]+?)(?=\s+(?:Bats|Throws|Born|Height|Weight|\d|$))", meta)
    return m.group(1).strip().rstrip(",") if m else None


def extract_bats_throws(meta: str) -> tuple[str | None, str | None]:
    bats = first_match(r"Bats:\s*([A-Za-z]+)", meta)
    throws = first_match(r"Throws:\s*([A-Za-z]+)", meta)
    return bats, throws


def extract_debut_final(html: str) -> tuple[str | None, str | None]:
    meta = extract_meta_block(html)
    debut = first_match(r"Debut[^A-Za-z0-9]*[A-Za-z]+\s+\d+,?\s+(\d{4})", meta) \
            or first_match(r"Debut[^0-9]{0,40}(\d{4})", meta)
    last = first_match(r"Last\s+(?:Game|Played|MLB Game)[^A-Za-z0-9]*[A-Za-z]+\s+\d+,?\s+(\d{4})", meta) \
           or first_match(r"Last\s+(?:Game|Played|MLB Game)[^0-9]{0,40}(\d{4})", meta)
    return debut, last


HIDDEN_COLS = {"awards"}


def parse_career_totals(html: str, table_id: str) -> dict:
    """Pull the 'N Yrs' career totals row from the table's tfoot."""
    m = re.search(rf'<table[^>]+id=["\']{table_id}["\'][^>]*>(.*?)</table>', html, re.DOTALL)
    if not m:
        return {}
    tf = re.search(r"<tfoot>(.*?)</tfoot>", m.group(1), re.DOTALL)
    if not tf:
        return {}
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", tf.group(1), re.DOTALL):
        cells = {}
        for c in re.finditer(r'<t[hd][^>]*data-stat=["\']([^"\']+)["\'][^>]*>(.*?)</t[hd]>', tr.group(1), re.DOTALL):
            cells[c.group(1)] = strip_tags(c.group(2))
        yr = cells.get("year_id", "")
        if re.match(r"^\d+\s*Yrs?$", yr):
            return cells
    return {}


def best_season_war(table: dict, war_stat: str) -> float | None:
    best = None
    for row in table.get("rows", []):
        # Skip combined multi-team rows so we score the single-team peak.
        if row.get("team_name_abbr", "").endswith("TM"):
            continue
        val = row.get(war_stat, "").strip()
        try:
            v = float(val)
        except ValueError:
            continue
        if best is None or v > best:
            best = v
    return best


def parse_stats_table(html: str, table_id: str) -> dict | None:
    m = re.search(rf'<table[^>]+id=["\']{table_id}["\'][^>]*>(.*?)</table>', html, re.DOTALL)
    if not m:
        return None
    table = m.group(1)

    thead_m = re.search(r"<thead>(.*?)</thead>", table, re.DOTALL)
    if not thead_m:
        return None
    headers: list[dict] = []
    for th in re.finditer(r'<th[^>]*data-stat=["\']([^"\']+)["\'][^>]*>(.*?)</th>', thead_m.group(1), re.DOTALL):
        stat = th.group(1)
        label = strip_tags(th.group(2)) or stat
        headers.append({"stat": stat, "label": label})

    tbody_m = re.search(r"<tbody>(.*?)</tbody>", table, re.DOTALL)
    if not tbody_m:
        return None

    rows: list[dict] = []
    for tr in re.finditer(r"<tr([^>]*)>(.*?)</tr>", tbody_m.group(1), re.DOTALL):
        tr_attrs, tr_inner = tr.group(1), tr.group(2)
        if "thead" in tr_attrs or "spacer" in tr_attrs or "minors_table" in tr_attrs:
            continue
        cells: dict[str, str] = {}
        for cell in re.finditer(r'<t[hd][^>]*data-stat=["\']([^"\']+)["\'][^>]*>(.*?)</t[hd]>', tr_inner, re.DOTALL):
            cells[cell.group(1)] = strip_tags(cell.group(2))
        if cells.get("year_id") or cells.get("age"):
            rows.append(cells)

    return {"headers": headers, "rows": rows}


def extract_teams(html: str) -> list[str]:
    """Pull team abbreviations from the player's own stat table, in order of first appearance."""
    chunks = []
    for table_id in ("players_standard_batting", "players_standard_pitching"):
        m = re.search(rf'id=["\']{table_id}["\'].*?</table>', html, re.DOTALL)
        if m:
            chunks.append(m.group(0))
    if not chunks:
        return []
    seen, ordered = set(), []
    for chunk in chunks:
        for a in re.findall(r'/teams/([A-Z]{2,3})/\d{4}\.shtml', chunk):
            if a not in seen:
                seen.add(a)
                ordered.append(a)
    return [TEAM_ABBR.get(a, a) for a in ordered]


def extract_awards(html: str) -> list[str]:
    """Look for award/honor blurbs — All-Star counts, MVP, Cy Young, HoF, etc."""
    awards = []
    text = extract_meta_block(html)
    patterns = [
        (r"(\d+)[x×]\s*All[- ]Star", lambda m: f"{m.group(1)}x All-Star"),
        (r"(\d+)[x×]\s*World Series", lambda m: f"{m.group(1)}x World Series champ"),
        (r"(\d+)[x×]\s*MVP",         lambda m: f"{m.group(1)}x MVP"),
        (r"(\d+)[x×]\s*Cy Young",    lambda m: f"{m.group(1)}x Cy Young"),
        (r"(\d+)[x×]\s*Gold Glove",  lambda m: f"{m.group(1)}x Gold Glove"),
        (r"(\d+)[x×]\s*Silver Slugger", lambda m: f"{m.group(1)}x Silver Slugger"),
        (r"(\d+)[x×]\s*Batting Title",  lambda m: f"{m.group(1)}x batting title"),
        (r"Inducted as (?:Player|Manager|Pioneer|Executive)", lambda m: "Hall of Famer"),
        (r"Rookie of the Year",      lambda m: "Rookie of the Year"),
        (r"(\d+)[x×]\s*Triple Crown", lambda m: f"{m.group(1)}x Triple Crown"),
        (r"\bTriple Crown\b",        lambda m: "Triple Crown"),
    ]
    for pat, fmt in patterns:
        m = re.search(pat, text)
        if m:
            awards.append(fmt(m))
    # Dedupe: skip a bare award if a "Nx <same award>" version is already present.
    out: list[str] = []
    for a in awards:
        if a in out:
            continue
        # if this is a bare keyword (no "Nx " prefix) and we already have a counted version, skip
        if not re.match(r"\d+x ", a) and any(a in prior for prior in out):
            continue
        out.append(a)
    return out[:6]


def build_hints(canonical_name: str, html: str, table: dict | None = None) -> list[str]:
    meta = extract_meta_block(html)
    pos = extract_position(meta) or "Unknown"
    bats, throws = extract_bats_throws(meta)
    awards = extract_awards(html)

    # Career totals + best WAR depend on which table we used.
    is_pitching = (table or {}).get("kind") == "pitching"
    totals_id = "players_standard_pitching" if is_pitching else "players_standard_batting"
    totals = parse_career_totals(html, totals_id)
    war_stat = "p_war" if is_pitching else "b_war"
    best_war = best_season_war(table or {}, war_stat) if table else None

    if is_pitching:
        career_line = None
        wins, ks, era = totals.get("p_w"), totals.get("p_so"), totals.get("p_earned_run_avg")
        bits = []
        if wins: bits.append(f"{wins} wins")
        if ks:   bits.append(f"{ks} K")
        if era:  bits.append(f"{era} ERA")
        if bits: career_line = "Career: " + ", ".join(bits)
    else:
        career_line = None
        hr, h_, ba = totals.get("b_hr"), totals.get("b_h"), totals.get("b_batting_avg")
        bits = []
        if hr is not None: bits.append(f"{hr} HR")
        if h_ is not None: bits.append(f"{h_} hits")
        if ba:             bits.append(f"{ba} BA")
        if bits: career_line = "Career: " + ", ".join(bits)

    hints: list[str] = []

    # 1: position + handedness
    bt = []
    if bats:   bt.append(f"bats {bats}")
    if throws: bt.append(f"throws {throws}")
    hints.append(f"Position: {pos}" + (f" — {', '.join(bt)}" if bt else ""))

    # 2: best single-season WAR
    if best_war is not None:
        hints.append(f"Best single-season WAR: {best_war:.1f}")
    else:
        hints.append("Best single-season WAR: unavailable")

    # 3: career totals
    hints.append(career_line or "Career totals unavailable")

    # 4: awards
    hints.append("Accolades: " + (", ".join(awards) if awards else "no major awards parsed"))

    # 5: last-name initial (skip Jr./Sr./II/III/IV suffixes)
    tokens = [t for t in canonical_name.split() if t.rstrip(".").lower() not in {"jr", "sr", "ii", "iii", "iv"}]
    last_name = tokens[-1] if tokens else canonical_name
    initial = next((c for c in last_name if c.isalpha()), "?").upper()
    hints.append(f"Last name starts with: {initial}")

    return hints


# ---------- guess normalization ----------

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    # strip common suffixes that trip people up
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", s)
    return s


def guess_matches(guess: str, canonical: str) -> bool:
    g, c = normalize(guess), normalize(canonical)
    if not g:
        return False
    if g == c:
        return True
    # last name match if it's at least 5 chars (avoid "jr"/"jones" collisions on small inputs)
    last = c.rsplit(" ", 1)[-1]
    if len(last) >= 5 and g == last:
        return True
    # first + last initials? skip — too lenient
    return False


# ---------- HTTP handler ----------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        # keep console tidy; uncomment to debug
        # super().log_message(fmt, *args)
        pass

    def _json(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/player":
            return self.handle_new_player()
        if parsed.path == "/api/guess":
            qs = urllib.parse.parse_qs(parsed.query)
            return self.handle_guess(qs.get("g", [""])[0], qs.get("name", [""])[0])
        return super().do_GET()

    def handle_new_player(self):
        players = load_players()
        random.shuffle(players)
        last_err = None
        for p in players[:6]:
            try:
                html = fetch_player_page(p["id"])
                primary_pos = (extract_position(extract_meta_block(html)) or "").strip()
                is_pitcher = primary_pos.lower().startswith("pitcher")
                first_id  = "players_standard_pitching" if is_pitcher else "players_standard_batting"
                second_id = "players_standard_batting"  if is_pitcher else "players_standard_pitching"
                kind = "pitching" if is_pitcher else "batting"
                table = parse_stats_table(html, first_id)
                if not table or not table["rows"]:
                    table = parse_stats_table(html, second_id)
                    kind = "batting" if kind == "pitching" else "pitching"
                if not table or not table["rows"]:
                    raise RuntimeError("no stats table parsed")
                hints = build_hints(p["name"], html, {"kind": kind, **table})
                return self._json(200, {
                    "name": p["name"],
                    "id": p["id"],
                    "hints": hints,
                    "br_url": f"{BR_BASE}/{p['id'][0]}/{p['id']}.shtml",
                    "table": {"kind": kind, **table},
                    "hidden_cols": sorted(HIDDEN_COLS),
                })
            except Exception as e:
                last_err = f"{p['id']}: {e}"
                continue
        return self._json(502, {"error": "could not load any player", "detail": last_err})

    def handle_guess(self, guess: str, name: str):
        return self._json(200, {"correct": guess_matches(guess, name)})


def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving baseball-guess on http://localhost:{PORT}")
        print(f"  (on your phone over Wi-Fi, use http://<your-mac-ip>:{PORT})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")


if __name__ == "__main__":
    main()
