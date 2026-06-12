# Who's the Ballplayer?

A guess-the-MLB-player game built from the year-by-year stat lines on Baseball Reference. Pure static site — no backend in production.

## Play

Three difficulty tiers:

- **Famous** — Hall of Famers, MVP/Cy Young winners, ~600 players
- **Pros** — 5,000+ career PA (or ~1,500+ IP for pitchers), ~1,800 players
- **All-time** — anyone with 400+ career PA, ~11,000 players

Six guesses per round. Optional hints reveal at a 2-point penalty each.

## Data

Built from public-domain sources:

- [Baseball Databank (Lahman)](https://github.com/xorq-labs/baseballdatabank) — season stats through 2021
- [Sean Smith bWAR daily files](https://www.baseball-reference.com/data/) — WAR + OPS+/ERA+

The 2021 cutoff means players who debuted in 2022 or later (Bobby Witt Jr., Elly De La Cruz, Paul Skenes, etc.) aren't included yet.

## Develop

```bash
# Rebuild the dataset (downloads Lahman + bWAR, builds data/players/*.json)
python3 prefetch.py

# Serve locally
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

The static site needs no build step. Push to GitHub, connect the repo on [vercel.com/new](https://vercel.com/new).

### Enabling the leaderboard

The `/api/leaderboard` endpoint needs Vercel KV (Upstash Redis) connected. One-time setup:

1. Open the project on [vercel.com](https://vercel.com) → **Storage** tab.
2. Click **Create Database** (or **Connect Store**). Choose **KV** / **Upstash for Redis** (the dashboard may label it either way).
3. Accept the defaults (free Hobby tier).
4. Click **Connect** to attach it to the `baseball-guess` project. This auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
5. **Redeploy** once (Deployments → latest → ⋯ → Redeploy) so the function picks up the new env vars.

Until KV is connected, the leaderboard UI gracefully shows "Leaderboard not available yet"; the rest of the game still works.
