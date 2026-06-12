const HINT_LABELS = [
  "Position & handedness",
  "Best single-season WAR",
  "Career stat line",
  "Accolades",
  "Last-name initial",
];

const USERNAME_RE = /^[A-Za-z0-9_.\-]{2,20}$/;

const state = {
  manifest: null,
  tier: localStorage.getItem("bg.tier") || "famous",
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
};

const $ = (id) => document.getElementById(id);

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

async function postScore(points) {
  if (!state.username || points <= 0) return;
  try {
    await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.username, points }),
    });
  } catch (e) {
    // Silently ignore — leaderboard is optional.
  }
}

function showResult(won) {
  state.finished = true;
  state.revealed = true;
  state.hidden = new Set();
  renderTable();

  $("guess-area").hidden = true;
  $("result").hidden = false;
  $("result-headline").textContent = won ? "Got it!" : "Out of guesses";
  const points = won ? Math.max(10 - state.guesses - state.hintsUsed * 2, 1) : 0;
  state.score += points;
  localStorage.setItem("bg.score", String(state.score));
  renderStatus();
  $("result-detail").textContent = won
    ? `It was ${state.player.name}. +${points} point${points === 1 ? "" : "s"} (${state.guesses} guesses, ${state.hintsUsed} hint${state.hintsUsed === 1 ? "" : "s"}).`
    : `It was ${state.player.name}.`;
  $("br-link").href = state.player.br_url;
  if (won) postScore(points);
}

function pickRandomId() {
  const pool = state.manifest[state.tier];
  if (!pool || !pool.length) return null;
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
  $("table-wrap").innerHTML = '<div id="table-loading">Loading stat line…</div>';
  renderStatus();

  const id = pickRandomId();
  if (!id) { setFeedback("No players in this tier.", "bad"); return; }

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

function normalize(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim()
    .replace(/\s+(jr|sr|ii|iii|iv)$/, "");
}

function matchesLocal(guess, name) {
  const g = normalize(guess), n = normalize(name);
  if (!g) return false;
  if (g === n) return true;
  const last = n.split(" ").pop();
  if (last.length >= 5 && g === last) return true;
  return false;
}

async function submitGuess(e) {
  e.preventDefault();
  if (state.finished || !state.player) return;
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

async function loadLeaderboard() {
  const el = $("leaderboard-list");
  el.textContent = "Loading…";
  try {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const scores = data.scores || [];
    if (!scores.length) {
      el.innerHTML = '<p class="sub">No scores yet — be the first to win a round!</p>';
      return;
    }
    el.innerHTML = `
      <table class="leaderboard">
        <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Rounds</th></tr></thead>
        <tbody>
          ${scores.map((s, i) => {
            const me = state.username && s.username === state.username ? " class='me'" : "";
            return `<tr${me}><td>${i + 1}</td><td>@${s.username}</td><td>${s.score}</td><td>${s.rounds || "–"}</td></tr>`;
          }).join("")}
        </tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<p class="err">Leaderboard not available yet. (${e.message})</p>`;
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
  const tierSel = $("tier");
  tierSel.value = state.tier;
  tierSel.addEventListener("change", onTierChange);
  $("guess-form").addEventListener("submit", submitGuess);
  $("hint-btn").addEventListener("click", revealHint);
  $("giveup-btn").addEventListener("click", giveUp);
  $("next-btn").addEventListener("click", newRound);
  $("leaderboard-btn").addEventListener("click", showLeaderboardModal);
  $("leaderboard-close").addEventListener("click", hideLeaderboardModal);
  $("username-form").addEventListener("submit", saveUsername);
  $("username-pill").addEventListener("click", showUsernameModal);

  renderStatus();
  if (!state.username) showUsernameModal();
  newRound();
}

document.addEventListener("DOMContentLoaded", init);
