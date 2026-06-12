const HINT_LABELS = [
  "Position & handedness",
  "Best single-season WAR",
  "Career stat line",
  "Accolades",
  "Last-name initial",
];

const USERNAME_RE = /^[A-Za-z0-9_.\-]{2,20}$/;

const ERA_RANGES = {
  "2000s": [2000, 2009],
  "2010s": [2010, 2019],
  "2020s": [2020, 2029],
};

const state = {
  manifest: null,
  tier: localStorage.getItem("bg.tier") || "famous",
  era:  localStorage.getItem("bg.era")  || "all",
  pos:  localStorage.getItem("bg.pos")  || "all",
  username: localStorage.getItem("bg.username") || "",
  player: null,
  hidden: new Set(),
  revealed: false,
  hintsUsed: 0,
  guesses: 0,
  score: parseInt(localStorage.getItem("bg.score") || "0", 10),
  round: 0,
  finished: false,
  recent: [],
  ac: { items: [], active: -1, query: "" },
};

const $ = (id) => document.getElementById(id);

function normalize(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeGuess(s) {
  return normalize(s).replace(/\s+(jr|sr|ii|iii|iv)$/, "");
}

function setFeedback(msg, cls = "") {
  const el = $("feedback");
  el.textContent = msg;
  el.className = cls;
}

function renderStatus() {
  $("username-pill").textContent = state.username ? `@${state.username}` : "@—";
  $("round").textContent = `Round ${state.round}`;
  $("score").textContent = `Score: ${state.score}`;
  $("guesses").textContent = `Guesses: ${state.guesses}`;
}

function renderTable() {
  const wrap = $("table-wrap");
  if (!state.player) { wrap.innerHTML = ""; return; }
  const p = state.player;
  const visibleHeaders = p.headers
    .map((h, idx) => ({ ...h, idx }))
    .filter(h => !state.hidden.has(h.stat));
  const thead = `<tr>${visibleHeaders.map(h => `<th title="${h.stat}">${h.label}</th>`).join("")}</tr>`;
  const tbody = p.rows.map(row =>
    `<tr>${visibleHeaders.map(h => `<td>${row[h.idx] ?? ""}</td>`).join("")}</tr>`
  ).join("");
  const caption = `<caption>${p.kind === "pitching" ? "Standard Pitching" : "Standard Batting"}</caption>`;
  wrap.innerHTML = `<div class="scroll"><table class="stats">${caption}<thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

// ---------- Pool filtering ----------

function getFilteredPool() {
  const base = state.manifest?.[state.tier] || [];
  const [eraLo, eraHi] = ERA_RANGES[state.era] || [];
  const pos = state.pos === "all" ? null : state.pos;
  return base.filter(e => {
    if (pos && e.p !== pos) return false;
    if (eraLo != null) {
      if (e.l == null || e.f == null) return false;
      if (e.l < eraLo || e.f > eraHi) return false;
    }
    return true;
  });
}

function renderPoolCount(pool) {
  const el = $("pool-count");
  if (!el) return;
  const parts = [];
  if (state.era !== "all")  parts.push(state.era);
  if (state.pos !== "all")  parts.push(({P:"pitchers",C:"catchers",IF:"infield",OF:"outfield",DH:"DH"})[state.pos]);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  el.textContent = `${pool.length} player${pool.length === 1 ? "" : "s"} in pool${suffix}`;
}

// ---------- Score posting ----------

async function postScore(points) {
  if (!state.username || points <= 0) return;
  try {
    await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.username, points }),
    });
  } catch (e) {}
}

// ---------- Show result + celebrate ----------

function showResult(won) {
  state.finished = true;
  state.revealed = true;
  state.hidden = new Set();
  renderTable();

  $("guess-area").hidden = true;
  const resultEl = $("result");
  resultEl.hidden = false;
  resultEl.classList.toggle("win", won);
  $("result-headline").textContent = won ? "Got it!" : "Out of guesses";
  const points = won ? Math.max(10 - state.guesses - state.hintsUsed * 2, 1) : 0;
  state.score += points;
  localStorage.setItem("bg.score", String(state.score));

  const localStats = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0}');
  localStats.rounds += 1;
  if (won) {
    localStats.wins += 1;
    localStats.total += points;
    if (points > localStats.best) localStats.best = points;
  }
  localStorage.setItem("bg.stats", JSON.stringify(localStats));
  renderStatus();
  $("result-detail").textContent = won
    ? `It was ${state.player.name}. +${points} point${points === 1 ? "" : "s"} (${state.guesses} guesses, ${state.hintsUsed} hint${state.hintsUsed === 1 ? "" : "s"}).`
    : `It was ${state.player.name}.`;
  $("br-link").href = state.player.br_url;
  if (won) {
    celebrate(resultEl);
    postScore(points);
  }
}

function celebrate(resultEl) {
  resultEl.classList.add("win-pulse");
  setTimeout(() => resultEl.classList.remove("win-pulse"), 1300);
  const flash = document.createElement("div");
  flash.className = "flash-bg";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 900);
  const emojis = ["⚾", "⚾", "⚾", "💚", "🟢", "✨", "🎉"];
  for (let i = 0; i < 28; i++) {
    const span = document.createElement("span");
    span.className = "confetti";
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    span.style.left = `${Math.random() * 100}vw`;
    span.style.fontSize = `${18 + Math.random() * 16}px`;
    span.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    span.style.animationDelay = `${Math.random() * 0.25}s`;
    document.body.appendChild(span);
    setTimeout(() => span.remove(), 3500);
  }
}

// ---------- Round lifecycle ----------

function pickRandomId(pool) {
  if (!pool.length) return null;
  const exclude = new Set(state.recent.slice(-30));
  let pick;
  for (let tries = 0; tries < 20; tries++) {
    pick = pool[Math.floor(Math.random() * pool.length)];
    if (!exclude.has(pick.id)) break;
  }
  state.recent.push(pick.id);
  if (state.recent.length > 60) state.recent.shift();
  return pick.id;
}

async function newRound() {
  state.round += 1;
  state.guesses = 0;
  state.hintsUsed = 0;
  state.finished = false;
  state.revealed = false;
  state.player = null;
  state.hidden = new Set();
  setFeedback("");
  $("hint-box").hidden = true;
  $("hint-box").innerHTML = "";
  $("guess-area").hidden = false;
  $("result").hidden = true;
  $("guess-input").value = "";
  closeAutocomplete();
  $("table-wrap").innerHTML = '<div id="table-loading">Loading stat line…</div>';
  renderStatus();

  const pool = getFilteredPool();
  renderPoolCount(pool);
  if (!pool.length) {
    setFeedback("No players match these filters. Try widening Era or Position.", "bad");
    $("table-wrap").innerHTML = "";
    return;
  }

  const id = pickRandomId(pool);
  if (!id) return;

  try {
    const res = await fetch(`data/players/${id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.player = await res.json();
    state.hidden = new Set(state.player.hidden_cols || []);
  } catch (e) {
    setFeedback(`Couldn't load player (${id}). Trying another…`, "bad");
    return newRound();
  }
  renderTable();
  setFeedback("");
  $("guess-input").focus();
}

function revealHint() {
  if (state.finished || !state.player) return;
  const hints = state.player.hints || [];
  if (state.hintsUsed >= hints.length) { setFeedback("No more hints.", "bad"); return; }
  const box = $("hint-box");
  box.hidden = false;
  const div = document.createElement("div");
  div.className = "hint";
  div.innerHTML = `<span class="label">Hint ${state.hintsUsed + 1} — ${HINT_LABELS[state.hintsUsed] || ""}</span>${hints[state.hintsUsed]}`;
  box.appendChild(div);
  state.hintsUsed += 1;
}

function matchesLocal(guess, name) {
  const g = normalizeGuess(guess), n = normalizeGuess(name);
  if (!g) return false;
  if (g === n) return true;
  const last = n.split(" ").pop();
  if (last.length >= 5 && g === last) return true;
  return false;
}

async function submitGuess(e) {
  e.preventDefault();
  if (state.finished || !state.player) return;
  // If the autocomplete has a highlighted item, prefer that
  if (state.ac.active >= 0 && state.ac.items[state.ac.active]) {
    $("guess-input").value = state.ac.items[state.ac.active].name;
  }
  closeAutocomplete();
  const guess = $("guess-input").value.trim();
  if (!guess) return;
  state.guesses += 1;
  renderStatus();
  if (matchesLocal(guess, state.player.name)) { showResult(true); return; }
  $("guess-input").value = "";
  setFeedback(`Not "${guess}" — try again.`, "bad");
  if (state.guesses >= 6) showResult(false);
  else $("guess-input").focus();
}

function giveUp() { if (!state.finished) showResult(false); }

function onTierChange(e) {
  state.tier = e.target.value;
  localStorage.setItem("bg.tier", state.tier);
  newRound();
}
function onEraChange(e) {
  state.era = e.target.value;
  localStorage.setItem("bg.era", state.era);
  newRound();
}
function onPosChange(e) {
  state.pos = e.target.value;
  localStorage.setItem("bg.pos", state.pos);
  newRound();
}

// ---------- Autocomplete ----------

function updateAutocomplete() {
  const raw = $("guess-input").value;
  const q = normalize(raw);
  state.ac.query = q;
  state.ac.active = -1;

  if (!q || q.length < 1) { closeAutocomplete(); return; }

  const pool = getFilteredPool();
  const matches = [];
  for (const e of pool) {
    if (!e._n) e._n = normalize(e.name);
    const n = e._n;
    if (n.startsWith(q) || n.includes(" " + q)) {
      matches.push({ ...e, _starts: n.startsWith(q) ? 0 : 1 });
      if (matches.length >= 30) break;  // cap initial scan for perf
    }
  }
  matches.sort((a, b) => a._starts - b._starts || a.name.length - b.name.length);
  state.ac.items = matches.slice(0, 6);
  renderAutocomplete();
}

function renderAutocomplete() {
  const ul = $("ac-list");
  if (!state.ac.items.length) { ul.hidden = true; ul.innerHTML = ""; return; }
  ul.innerHTML = state.ac.items.map((e, i) => {
    const cls = i === state.ac.active ? " class='ac-item active'" : " class='ac-item'";
    return `<li${cls} data-idx="${i}">${escapeHtml(e.name)}</li>`;
  }).join("");
  ul.hidden = false;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

function closeAutocomplete() {
  state.ac.items = []; state.ac.active = -1;
  const ul = $("ac-list");
  if (ul) { ul.hidden = true; ul.innerHTML = ""; }
}

function selectSuggestion(idx) {
  const e = state.ac.items[idx];
  if (!e) return;
  $("guess-input").value = e.name;
  closeAutocomplete();
  // Auto-submit on tap-select
  $("guess-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

function onGuessKeydown(ev) {
  if (!state.ac.items.length) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    state.ac.active = (state.ac.active + 1) % state.ac.items.length;
    renderAutocomplete();
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    state.ac.active = (state.ac.active - 1 + state.ac.items.length) % state.ac.items.length;
    renderAutocomplete();
  } else if (ev.key === "Escape") {
    closeAutocomplete();
  } else if (ev.key === "Tab" && state.ac.active >= 0) {
    ev.preventDefault();
    $("guess-input").value = state.ac.items[state.ac.active].name;
    closeAutocomplete();
  }
}

// ---------- Username modal ----------

function showUsernameModal() {
  $("username-modal").hidden = false;
  $("username-input").value = state.username || "";
  $("username-input").focus();
}
function hideUsernameModal() { $("username-modal").hidden = true; }
function saveUsername(e) {
  e.preventDefault();
  const v = $("username-input").value.trim();
  if (!USERNAME_RE.test(v)) {
    $("username-error").textContent = "2–20 chars: letters, numbers, _ . -";
    return;
  }
  state.username = v;
  localStorage.setItem("bg.username", v);
  $("username-error").textContent = "";
  hideUsernameModal();
  renderStatus();
}

// ---------- Leaderboard modal ----------

function showLeaderboardModal() {
  $("leaderboard-modal").hidden = false;
  loadLeaderboard();
}
function hideLeaderboardModal() { $("leaderboard-modal").hidden = true; }

function renderLocalStatsCard() {
  const s = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0}');
  const winRate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
  return `
    <div class="stats-card">
      <div class="stat"><span class="label">Your score</span><span class="value">${s.total}</span></div>
      <div class="stat"><span class="label">Wins</span><span class="value">${s.wins}/${s.rounds}</span></div>
      <div class="stat"><span class="label">Win %</span><span class="value">${winRate}%</span></div>
    </div>`;
}

async function loadLeaderboard() {
  const el = $("leaderboard-list");
  el.innerHTML = renderLocalStatsCard() + '<p class="sub">Loading global scores…</p>';
  try {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const scores = data.scores || [];
    const top = scores.length
      ? `<table class="leaderboard">
          <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Rounds</th></tr></thead>
          <tbody>
            ${scores.map((s, i) => {
              const me = state.username && s.username === state.username ? " class='me'" : "";
              return `<tr${me}><td>${i + 1}</td><td>@${s.username}</td><td>${s.score}</td><td>${s.rounds || "–"}</td></tr>`;
            }).join("")}
          </tbody>
        </table>`
      : '<p class="sub">No scores yet — be the first to win a round!</p>';
    el.innerHTML = renderLocalStatsCard() + top;
  } catch (e) {
    el.innerHTML = renderLocalStatsCard() + `
      <div class="setup-hint">
        <strong>Global leaderboard isn't live yet.</strong>
        Your scores still count locally. To enable the shared leaderboard:
        <ol>
          <li>vercel.com → baseball-guess → <strong>Storage</strong> tab</li>
          <li>Click <strong>Create Database</strong> → pick <strong>Upstash for Redis</strong> (free Hobby)</li>
          <li><strong>Connect</strong> to the project</li>
          <li>Deployments → latest → ⋯ → <strong>Redeploy</strong></li>
        </ol>
      </div>`;
  }
}

// ---------- init ----------

async function init() {
  try {
    const res = await fetch("data/manifest.json");
    state.manifest = await res.json();
  } catch (e) {
    setFeedback("Couldn't load player list. Refresh to try again.", "bad");
    return;
  }
  $("tier").value = state.tier;
  $("era").value  = state.era;
  $("pos").value  = state.pos;
  $("tier").addEventListener("change", onTierChange);
  $("era").addEventListener("change", onEraChange);
  $("pos").addEventListener("change", onPosChange);
  $("guess-form").addEventListener("submit", submitGuess);
  $("hint-btn").addEventListener("click", revealHint);
  $("giveup-btn").addEventListener("click", giveUp);
  $("next-btn").addEventListener("click", newRound);
  $("leaderboard-btn").addEventListener("click", showLeaderboardModal);
  $("leaderboard-close").addEventListener("click", hideLeaderboardModal);
  $("username-form").addEventListener("submit", saveUsername);
  $("username-pill").addEventListener("click", showUsernameModal);

  // Autocomplete
  $("guess-input").addEventListener("input", updateAutocomplete);
  $("guess-input").addEventListener("keydown", onGuessKeydown);
  $("guess-input").addEventListener("blur", () => setTimeout(closeAutocomplete, 150));
  $("ac-list").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (li) { e.preventDefault(); selectSuggestion(parseInt(li.dataset.idx, 10)); }
  });

  renderStatus();
  if (!state.username) showUsernameModal();
  newRound();
}

document.addEventListener("DOMContentLoaded", init);
