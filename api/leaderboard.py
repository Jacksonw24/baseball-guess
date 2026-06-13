"""
GET  /api/leaderboard       → { scores: [{ username, score }, ...] }  (top 50)
POST /api/leaderboard       { username, points }  → cumulative add

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

UPSTASH_URL = os.environ.get("KV_REST_API_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
SCORES_KEY = "scores"
ROUNDS_KEY = "rounds"
EXTREME_KEY = "extreme:users"

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{2,20}$")
MAX_POINTS_PER_ROUND = 100  # sanity cap — no one round should give more than this


def kv(command: list[str]):
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        raise RuntimeError("KV backend not configured (set KV_REST_API_URL + KV_REST_API_TOKEN).")
    req = urllib.request.Request(
        UPSTASH_URL,
        method="POST",
        data=json.dumps(command).encode(),
        headers={
            "Authorization": f"Bearer {UPSTASH_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"KV HTTP {e.code}: {e.read().decode(errors='replace')[:200]}")


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
            # Set of users who've ever beaten Extreme
            extreme_users: set[str] = set()
            try:
                ext_r = kv(["SMEMBERS", EXTREME_KEY])
                extreme_users = set(ext_r.get("result") or [])
            except Exception:
                pass
            # Rounds (plays) per shown user
            rounds_map: dict[str, int] = {}
            try:
                for s in scores:
                    rr = kv(["ZSCORE", ROUNDS_KEY, s["username"]])
                    val = rr.get("result")
                    if val is not None:
                        rounds_map[s["username"]] = int(float(val))
            except Exception:
                pass
            for s in scores:
                s["rounds"] = rounds_map.get(s["username"], 0)
                s["extreme"] = s["username"] in extreme_users
            return self._send(200, {"scores": scores})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = json.loads(self.rfile.read(length) or b"{}")
            username = (body.get("username") or "").strip()
            points = int(body.get("points", 0))
            extreme = bool(body.get("extreme", False))
            if not USERNAME_RE.match(username):
                return self._send(400, {"error": "Invalid username: 2-20 chars, A-Z 0-9 _ . - only."})
            if points < 0 or points > MAX_POINTS_PER_ROUND:
                return self._send(400, {"error": f"Invalid points (0-{MAX_POINTS_PER_ROUND})."})
            kv(["ZINCRBY", SCORES_KEY, str(points), username])
            kv(["ZINCRBY", ROUNDS_KEY, "1", username])
            if extreme:
                kv(["SADD", EXTREME_KEY, username])
            return self._send(200, {"ok": True})
        except json.JSONDecodeError:
            return self._send(400, {"error": "Invalid JSON."})
        except Exception as e:
            return self._send(500, {"error": str(e)})
