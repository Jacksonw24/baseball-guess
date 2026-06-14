"""
Admin endpoint — gated by an ADMIN_TOKEN env var set in Vercel.

Usage:
    curl -X POST https://baseball-guess.vercel.app/api/admin \
         -H "X-Admin-Token: $ADMIN_TOKEN" \
         -H "Content-Type: application/json" \
         -d '{"action":"delete-user","username":"Jwall2"}'

    curl -X POST https://baseball-guess.vercel.app/api/admin \
         -H "X-Admin-Token: $ADMIN_TOKEN" \
         -H "Content-Type: application/json" \
         -d '{"action":"migrate-beta-testers"}'

Required env vars (Vercel project settings → Environment Variables):
    KV_REST_API_URL
    KV_REST_API_TOKEN
    ADMIN_TOKEN          ← you set this; any random ≥24-char string
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

UPSTASH_URL   = os.environ.get("KV_REST_API_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
ADMIN_TOKEN   = os.environ.get("ADMIN_TOKEN", "")

SCORES_KEY         = "scores"
ROUNDS_KEY         = "rounds"
EXTREME_COUNT_KEY  = "extreme:wins"
EXTREME_LEGACY_KEY = "extreme:users"
BETA_SET_KEY       = "beta:testers"
CLAIM_HASH_KEY     = "username:claim"


def kv(command):
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        raise RuntimeError("KV backend not configured.")
    req = urllib.request.Request(
        UPSTASH_URL,
        method="POST",
        data=json.dumps(command).encode(),
        headers={"Authorization": f"Bearer {UPSTASH_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"KV HTTP {e.code}: {e.read().decode(errors='replace')[:200]}")


def delete_user(username: str) -> dict:
    out = {}
    out["scores"]      = kv(["ZREM", SCORES_KEY, username]).get("result", 0)
    out["rounds"]      = kv(["ZREM", ROUNDS_KEY, username]).get("result", 0)
    out["ex_wins"]     = kv(["HDEL", EXTREME_COUNT_KEY, username]).get("result", 0)
    out["ex_legacy"]   = kv(["SREM", EXTREME_LEGACY_KEY, username]).get("result", 0)
    out["beta"]        = kv(["SREM", BETA_SET_KEY, username]).get("result", 0)
    out["claim"]       = kv(["HDEL", CLAIM_HASH_KEY, username]).get("result", 0)
    return out


def migrate_beta_testers() -> dict:
    """Tag every current leaderboard user as a beta tester (gold name)."""
    r = kv(["ZRANGE", SCORES_KEY, "0", "-1"])
    users = r.get("result") or []
    tagged = 0
    for u in users:
        kv(["SADD", BETA_SET_KEY, u])
        tagged += 1
    return {"tagged": tagged, "users": users}


def release_username(username: str) -> dict:
    """Free up a username claim so the same name can be re-registered."""
    n = kv(["HDEL", CLAIM_HASH_KEY, username]).get("result", 0)
    return {"removed": n}


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self) -> bool:
        if not ADMIN_TOKEN:
            return False
        provided = self.headers.get("x-admin-token") or self.headers.get("X-Admin-Token") or ""
        return provided == ADMIN_TOKEN

    def do_POST(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "invalid json"})

        action = body.get("action")
        try:
            if action == "delete-user":
                u = (body.get("username") or "").strip()
                if not u: return self._send(400, {"error": "username required"})
                return self._send(200, {"ok": True, "result": delete_user(u)})
            if action == "migrate-beta-testers":
                return self._send(200, {"ok": True, "result": migrate_beta_testers()})
            if action == "release-username":
                u = (body.get("username") or "").strip()
                if not u: return self._send(400, {"error": "username required"})
                return self._send(200, {"ok": True, "result": release_username(u)})
            return self._send(400, {"error": f"unknown action: {action}"})
        except Exception as e:
            return self._send(500, {"error": str(e)})
