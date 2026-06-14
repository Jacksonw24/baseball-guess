"""
GET  /api/leaderboard       → { scores: [{ username, score, rounds, extreme, extremes, beta }, …] }
POST /api/leaderboard       { username, points, extreme, sessionToken } → cumulative add

Backed by Vercel KV (Upstash Redis). Required env vars (auto-injected when KV
is connected to the project):
    KV_REST_API_URL
    KV_REST_API_TOKEN
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

UPSTASH_URL   = os.environ.get("KV_REST_API_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")

SCORES_KEY         = "scores"
ROUNDS_KEY         = "rounds"
EXTREME_COUNT_KEY  = "extreme:wins"
EXTREME_LEGACY_KEY = "extreme:users"
BETA_SET_KEY       = "beta:testers"
CLAIM_HASH_KEY     = "username:claim"      # username → sessionToken (lowercased)
RATE_PREFIX        = "rate:"               # rate:<ip> → 1 (5s TTL)

USERNAME_RE        = re.compile(r"^[A-Za-z0-9_.\-]{2,20}$")
SESSION_TOKEN_RE   = re.compile(r"^[A-Za-z0-9_\-]{16,64}$")
MAX_POINTS_PER_ROUND = 100
RATE_WINDOW_SEC      = 5

# Profanity / slur filter. Substring match after normalization (lowercase, no
# non-letters). Not exhaustive — catches the obvious public-internet trolls.
BAD_WORDS = {
    "fuck", "shit", "bitch", "cunt", "fag", "faggot", "nigger", "nigga",
    "retard", "tranny", "slut", "whore", "kike", "spic", "chink", "gook",
    "wetback", "dyke", "homo", "pedophile", "pedo", "rapist", "hitler",
    "nazi", "kkk", "white power", "heil", "n1gger", "n1gga", "phaggot",
    "f4ggot", "ngger", "nigg", "fagg", "rape", "kys",
}


def kv(command):
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        raise RuntimeError("KV backend not configured (set KV_REST_API_URL + KV_REST_API_TOKEN).")
    req = urllib.request.Request(
        UPSTASH_URL,
        method="POST",
        data=json.dumps(command).encode(),
        headers={
            "Authorization": f"Bearer {UPSTASH_TOKEN}",
            "Content-Type":  "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"KV HTTP {e.code}: {e.read().decode(errors='replace')[:200]}")


def normalize_username(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def is_profane(username: str) -> bool:
    n = normalize_username(username)
    if not n:
        return True
    for word in BAD_WORDS:
        if word in n:
            return True
    return False


def get_client_ip(headers) -> str:
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or ""
    if xff:
        return xff.split(",")[0].strip()
    return (headers.get("x-real-ip") or headers.get("X-Real-Ip") or "0.0.0.0").strip()


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    # --------- GET: top 50 + per-user extras ---------
    def do_GET(self):
        try:
            r = kv(["ZREVRANGE", SCORES_KEY, "0", "49", "WITHSCORES"])
            arr = r.get("result", []) or []
            scores = []
            for i in range(0, len(arr), 2):
                try:
                    scores.append({"username": arr[i], "score": int(float(arr[i + 1]))})
                except (ValueError, IndexError):
                    continue

            # Extreme-win counts (hash) + legacy set fallback
            extreme_counts = {}
            try:
                h = kv(["HGETALL", EXTREME_COUNT_KEY])
                a = h.get("result", []) or []
                for i in range(0, len(a), 2):
                    try: extreme_counts[a[i]] = int(a[i + 1])
                    except (ValueError, IndexError): continue
            except Exception: pass

            legacy_extreme = set()
            try:
                s_r = kv(["SMEMBERS", EXTREME_LEGACY_KEY])
                legacy_extreme = set(s_r.get("result") or [])
            except Exception: pass

            beta_set = set()
            try:
                br = kv(["SMEMBERS", BETA_SET_KEY])
                beta_set = set(br.get("result") or [])
            except Exception: pass

            rounds_map = {}
            try:
                for s in scores:
                    rr = kv(["ZSCORE", ROUNDS_KEY, s["username"]])
                    v = rr.get("result")
                    if v is not None:
                        rounds_map[s["username"]] = int(float(v))
            except Exception: pass

            for s in scores:
                s["rounds"]   = rounds_map.get(s["username"], 0)
                count = extreme_counts.get(s["username"], 0)
                if not count and s["username"] in legacy_extreme:
                    count = 1
                s["extremes"] = count
                s["extreme"]  = count > 0
                s["beta"]     = s["username"] in beta_set
            return self._send(200, {"scores": scores})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    # --------- POST: add a score ---------
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "Invalid JSON."})

        try:
            username = (body.get("username") or "").strip()
            points = int(body.get("points", 0))
            extreme = bool(body.get("extreme", False))
            session_token = (body.get("sessionToken") or "").strip()

            # 1) Validate input shape
            if not USERNAME_RE.match(username):
                return self._send(400, {"error": "Invalid username (2–20 chars, letters/digits/_.- only)."})
            if is_profane(username):
                return self._send(400, {"error": "Pick a different username."})
            if not SESSION_TOKEN_RE.match(session_token):
                return self._send(400, {"error": "Missing or malformed session token."})
            if points < 0 or points > MAX_POINTS_PER_ROUND:
                return self._send(400, {"error": f"Invalid points (0-{MAX_POINTS_PER_ROUND})."})

            # 2) Rate-limit per IP
            ip = get_client_ip(self.headers)
            rl = kv(["SET", f"{RATE_PREFIX}{ip}", "1", "NX", "EX", str(RATE_WINDOW_SEC)])
            if rl.get("result") != "OK":
                return self._send(429, {"error": "Slow down — try again in a few seconds."})

            # 3) Username claim: first-come-first-served, then locked to session token
            claim = kv(["HGET", CLAIM_HASH_KEY, username]).get("result")
            if claim is None:
                # New name → claim it for this session
                kv(["HSET", CLAIM_HASH_KEY, username, session_token])
            elif claim != session_token:
                return self._send(403, {
                    "error": "That username is already claimed on another device. Pick a different one.",
                })

            # 4) Apply the score
            kv(["ZINCRBY", SCORES_KEY, str(points), username])
            kv(["ZINCRBY", ROUNDS_KEY, "1", username])
            if extreme:
                kv(["HINCRBY", EXTREME_COUNT_KEY, username, "1"])

            return self._send(200, {"ok": True})
        except Exception as e:
            return self._send(500, {"error": str(e)})
