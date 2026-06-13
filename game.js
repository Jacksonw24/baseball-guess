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

const STREAK_FOR_EXTREME = 5;
const EXTREME_START_YEAR = 2010;

// Each successive Extreme clear escalates difficulty. Index = extremeWins so far.
const EXTREME_LEVELS = [
  { strikes: 3, poolTier: "famous",  showCount: true,  label: "I"   },
  { strikes: 3, poolTier: "pros",    showCount: true,  label: "II"  },
  { strikes: 2, poolTier: "pros",    showCount: true,  label: "III" },
  { strikes: 2, poolTier: "pros",    showCount: false, label: "IV"  },
  { strikes: 2, poolTier: "alltime", showCount: false, label: "V"   },
  { strikes: 1, poolTier: "alltime", showCount: false, label: "VI+" },
];
const TIER_RANK = { famous: 0, pros: 1, alltime: 2 };
const TIERS_BY_RANK = ["famous", "pros", "alltime"];

function getExtremeConfig() {
  return EXTREME_LEVELS[Math.min(state.extremeWins, EXTREME_LEVELS.length - 1)];
}

function getExtremePoolTier() {
  const cfg = getExtremeConfig();
  const userRank = TIER_RANK[state.tier] ?? 0;
  const cfgRank  = TIER_RANK[cfg.poolTier] ?? 0;
  return TIERS_BY_RANK[Math.max(userRank, cfgRank)];
}

const TEAM_ALIASES = {
  ARI: ["diamondbacks","dbacks","d backs","d-backs","arizona diamondbacks","arizona","ari"],
  ATL: ["braves","atlanta","atlanta braves","atl"],
  BAL: ["orioles","baltimore","baltimore orioles","bal","os","birds"],
  BOS: ["red sox","redsox","boston","boston red sox","bosox","bos","sox"],
  CHC: ["cubs","chicago cubs","chc","cubbies","north siders"],
  CHW: ["white sox","whitesox","chicago white sox","chisox","chw","cws","south siders"],
  CIN: ["reds","cincinnati","cincinnati reds","cin"],
  CLE: ["guardians","cleveland","cleveland guardians","cle","indians","cleveland indians"],
  COL: ["rockies","colorado","colorado rockies","col"],
  DET: ["tigers","detroit","detroit tigers","det"],
  HOU: ["astros","houston","houston astros","hou","stros"],
  KCR: ["royals","kansas city","kansas city royals","kc","kcr","kcity"],
  LAA: ["angels","los angeles angels","la angels","anaheim","laa","halos","angeles angels"],
  LAD: ["dodgers","los angeles dodgers","la dodgers","lad","blue crew"],
  MIA: ["marlins","miami","miami marlins","mia","florida","florida marlins","fla","fish"],
  MIL: ["brewers","milwaukee","milwaukee brewers","mil","brew crew"],
  MIN: ["twins","minnesota","minnesota twins","min"],
  NYM: ["mets","new york mets","ny mets","nym","amazins","metropolitans"],
  NYY: ["yankees","new york yankees","ny yankees","nyy","bombers","pinstripes","bronx bombers"],
  OAK: ["athletics","oakland","oakland athletics","oakland as","oakland a's","oak","as","a's","sacramento athletics"],
  PHI: ["phillies","philadelphia","philadelphia phillies","phi","phils"],
  PIT: ["pirates","pittsburgh","pittsburgh pirates","pit","bucs","buccos"],
  SDP: ["padres","san diego","san diego padres","sdp","sd","pads","friars"],
  SEA: ["mariners","seattle","seattle mariners","sea","ms"],
  SFG: ["giants","san francisco","san francisco giants","sf","sfg","sf giants"],
  STL: ["cardinals","st louis","st. louis","saint louis","st louis cardinals","stl","cards","redbirds"],
  TBR: ["rays","tampa bay","tampa","tampa bay rays","tbr","tb","devil rays"],
  TEX: ["rangers","texas","texas rangers","tex"],
  TOR: ["blue jays","toronto","toronto blue jays","jays","tor","bluejays"],
  WSN: ["nationals","washington","washington nationals","wsn","nats","wsh","gnats"],
};
const TEAM_INPUT_LOOKUP = (() => {
  const m = {};
  for (const [abbr, aliases] of Object.entries(TEAM_ALIASES)) {
    for (const a of aliases) m[a] = abbr;
    m[abbr.toLowerCase()] = abbr;
  }
  return m;
})();
const TEAM_DISPLAY = {};
for (const [abbr, aliases] of Object.entries(TEAM_ALIASES)) {
  TEAM_DISPLAY[abbr] = aliases[0].replace(/\b\w/g, c => c.toUpperCase());
}

function matchTeam(input) {
  const norm = input.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  return TEAM_INPUT_LOOKUP[norm] || null;
}

const state = {
  manifest: null,
  tier: localStorage.getItem("bg.tier") || "famous",
  era:  localStorage.getItem("bg.era")  || "all",
  pos:  localStorage.getItem("bg.pos")  || "all",
  username: localStorage.getItem("bg.username") || "",
  player: null,
  lastWon: false,
  hidden: new Set(),
  revealed: false,
  hintsUsed: 0,
  guesses: 0,
  score: parseInt(localStorage.getItem("bg.score") || "0", 10),
  round: 0,
  finished: false,
  recent: [],
  ac: { items: [], active: -1, query: "" },
  shared: null,
  winStreak: parseInt(localStorage.getItem("bg.winStreak") || "0", 10),
  extremeWins: parseInt(localStorage.getItem("bg.extremeWins") || "0", 10),
  maxExtremeLevel: parseInt(localStorage.getItem("bg.maxExtremeLevel") || "0", 10),
  isExtreme: false,
  extreme: null,
  extremeConfig: null,
};

const SLUG_RE = /^[a-z][a-z0-9]{3,14}$/i;

function getSharedFromUrl() {
  const params = new URLSearchParams(location.search);
  const p = params.get("p");
  if (!p || !SLUG_RE.test(p)) return null;
  const from = (params.get("from") || "").trim();
  return { slug: p, from: USERNAME_RE.test(from) ? from : "" };
}

function clearSharedFromUrl() {
  if (!location.search) return;
  const url = new URL(location.href);
  url.searchParams.delete("p");
  url.searchParams.delete("from");
  history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
}

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
  let badge;
  if (state.winStreak >= STREAK_FOR_EXTREME) {
    const nextLevel = EXTREME_LEVELS[Math.min(state.extremeWins, EXTREME_LEVELS.length - 1)].label;
    badge = `🚨 EXTREME ${nextLevel} NEXT`;
  } else if (state.winStreak > 0) {
    badge = `🔥 ${state.winStreak}`;
  } else {
    badge = `Round ${state.round}`;
  }
  $("round").textContent = badge;
  $("score").textContent = `Score: ${state.score}`;
  $("guesses").textContent = `Guesses: ${state.guesses}`;
}

function extractTeams(player) {
  if (!player?.headers) return [];
  const headers = player.headers.map(h => h.stat);
  const ti = headers.indexOf("team_name_abbr");
  if (ti < 0) return [];
  const runs = [];
  let last = null;
  for (const row of player.rows) {
    const t = row[ti];
    if (t && t !== last) { runs.push(t); last = t; }
  }
  return runs;
}

function renderTable() {
  const wrap = $("table-wrap");
  if (!state.player) { wrap.innerHTML = ""; return; }
  const p = state.player;
  const visibleHeaders = p.headers
    .map((h, idx) => ({ ...h, idx }))
    .filter(h => !state.hidden.has(h.stat));
  const teamIdx = visibleHeaders.findIndex(h => h.stat === "team_name_abbr");
  const revealedSet = state.extreme?.revealedSet || null;

  const thead = `<tr>${visibleHeaders.map(h => `<th title="${h.stat}">${h.label}</th>`).join("")}</tr>`;
  const tbody = p.rows.map(row =>
    `<tr>${visibleHeaders.map((h, ci) => {
      let val = row[h.idx] ?? "";
      if (state.isExtreme && !state.revealed && ci === teamIdx) {
        if (!revealedSet || !revealedSet.has(val)) {
          return `<td class="team-hidden">???</td>`;
        }
        return `<td class="team-revealed">${val}</td>`;
      }
      return `<td>${val}</td>`;
    }).join("")}</tr>`
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

function getExtremePool() {
  const tier = getExtremePoolTier();
  const base = state.manifest?.[tier] || [];
  return base.filter(e => (e.f || 9999) >= EXTREME_START_YEAR && (e.t || 0) >= 2);
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

async function postScore(points, extreme = false) {
  if (!state.username || (points <= 0 && !extreme)) return;
  try {
    await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.username, points, extreme }),
    });
  } catch (e) {}
}

// ---------- Show result + celebrate ----------

function showResult(won) {
  state.finished = true;
  state.revealed = true;
  state.lastWon = won;
  state.hidden = new Set();
  renderTable();

  $("guess-area").hidden = true;
  $("extreme-area").hidden = true;
  const resultEl = $("result");
  resultEl.hidden = false;
  resultEl.classList.toggle("win", won);
  resultEl.classList.toggle("extreme-win", won && state.isExtreme);
  $("share-feedback").textContent = "";

  let points = 0;
  if (state.isExtreme) {
    const cfg = state.extremeConfig || { label: "I" };
    $("result-headline").textContent = won ? `🚨 EXTREME ${cfg.label} CLEARED 🚨` : `Extreme ${cfg.label} failed`;
    // Bigger payouts at higher levels: 25 / 35 / 50 / 70 / 100 / 150
    const SCALE = [25, 35, 50, 70, 100, 150];
    points = won ? SCALE[Math.min(state.extremeWins, SCALE.length - 1)] : 0;
    const teamList = state.extreme?.teams?.join(" → ") || "";
    $("result-detail").textContent = won
      ? `${state.player.name} — ${teamList}. +${points} points + 🚨 badge. Chain: ${state.extremeWins + 1}.`
      : `${state.player.name} — the answer was: ${teamList}.`;
  } else {
    $("result-headline").textContent = won ? "Got it!" : "Out of guesses";
    points = won ? Math.max(10 - state.guesses - state.hintsUsed * 2, 1) : 0;
    $("result-detail").textContent = won
      ? `It was ${state.player.name}. +${points} point${points === 1 ? "" : "s"} (${state.guesses} guesses, ${state.hintsUsed} hint${state.hintsUsed === 1 ? "" : "s"}).`
      : `It was ${state.player.name}.`;
  }
  state.score += points;
  localStorage.setItem("bg.score", String(state.score));

  // Local stats
  const localStats = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0,"extreme":false}');
  localStats.rounds += 1;
  if (won) {
    localStats.wins += 1;
    localStats.total += points;
    if (points > localStats.best) localStats.best = points;
    if (state.isExtreme) localStats.extreme = true;
  }
  localStorage.setItem("bg.stats", JSON.stringify(localStats));

  // Streak handling
  if (state.isExtreme) {
    if (won) {
      state.extremeWins += 1;
      if (state.extremeWins > state.maxExtremeLevel) {
        state.maxExtremeLevel = state.extremeWins;
        localStorage.setItem("bg.maxExtremeLevel", String(state.maxExtremeLevel));
      }
    } else {
      state.extremeWins = 0;
    }
    state.winStreak = 0;
  } else if (won) {
    state.winStreak += 1;
  } else {
    state.winStreak = 0;
    state.extremeWins = 0;  // any loss kills the extreme chain
  }
  localStorage.setItem("bg.winStreak", String(state.winStreak));
  localStorage.setItem("bg.extremeWins", String(state.extremeWins));
  renderStatus();

  $("br-link").href = state.player.br_url;
  if (won) {
    celebrate(resultEl, state.isExtreme);
    postScore(points, state.isExtreme);
  }
}

function celebrate(resultEl, isExtreme = false) {
  resultEl.classList.add("win-pulse");
  setTimeout(() => resultEl.classList.remove("win-pulse"), 1300);
  const flash = document.createElement("div");
  flash.className = isExtreme ? "flash-bg flash-red" : "flash-bg";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1200);
  const emojis = isExtreme ? ["🚨","⚾","🔥","💥","⚡","🟥","🎯"] : ["⚾","⚾","⚾","💚","🟢","✨","🎉"];
  const count = isExtreme ? 50 : 28;
  for (let i = 0; i < count; i++) {
    const span = document.createElement("span");
    span.className = "confetti";
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    span.style.left = `${Math.random() * 100}vw`;
    span.style.fontSize = `${18 + Math.random() * 16}px`;
    span.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    span.style.animationDelay = `${Math.random() * 0.3}s`;
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
  state.extreme = null;
  setFeedback("");
  $("hint-box").hidden = true;
  $("hint-box").innerHTML = "";
  $("result").hidden = true;
  $("guess-input").value = "";
  closeAutocomplete();
  $("table-wrap").innerHTML = '<div id="table-loading">Loading stat line…</div>';

  // Decide mode for this round
  const isShared = !!state.shared;
  const wantExtreme = !isShared && state.winStreak >= STREAK_FOR_EXTREME;
  let id, fellBackFromExtreme = false;

  if (isShared) {
    state.isExtreme = false;
    id = state.shared.slug;
    showChallengeBanner(state.shared.from);
    state.shared = null;
    clearSharedFromUrl();
  } else if (wantExtreme) {
    state.extremeConfig = getExtremeConfig();
    const pool = getExtremePool();
    if (pool.length) {
      state.isExtreme = true;
      id = pickRandomId(pool);
    } else {
      // No extreme players in current tier — fall back to normal, don't burn the streak
      fellBackFromExtreme = true;
      state.isExtreme = false;
      const fb = getFilteredPool();
      renderPoolCount(fb);
      if (!fb.length) {
        setFeedback("No players match these filters. Try widening Era or Position.", "bad");
        $("table-wrap").innerHTML = ""; return;
      }
      id = pickRandomId(fb);
    }
  } else {
    state.isExtreme = false;
    hideChallengeBanner();
    const pool = getFilteredPool();
    renderPoolCount(pool);
    if (!pool.length) {
      setFeedback("No players match these filters. Try widening Era or Position.", "bad");
      $("table-wrap").innerHTML = ""; return;
    }
    id = pickRandomId(pool);
  }

  document.body.classList.toggle("extreme-mode", state.isExtreme);
  $("guess-area").hidden = state.isExtreme;
  $("extreme-area").hidden = !state.isExtreme;
  if (state.isExtreme) hideChallengeBanner();

  renderStatus();
  if (fellBackFromExtreme) {
    setFeedback("No 2010+ multi-team players in this tier — easing back to normal. Try Pros tier.", "bad");
  }
  if (!id) return;

  try {
    const res = await fetch(`data/players/${id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.player = await res.json();
    state.hidden = new Set(state.player.hidden_cols || []);
  } catch (e) {
    setFeedback(`Couldn't load that player (${id}).`, "bad");
    return newRound();
  }

  if (state.isExtreme) {
    const teams = extractTeams(state.player);
    state.extreme = { teams, idx: 0, attempts: 0, revealedSet: new Set() };
    initExtremeUI();
  } else {
    state.extremeConfig = null;
    setFeedback("");
  }
  renderTable();
  if (state.isExtreme) {
    $("extreme-input").focus();
  } else {
    $("guess-input").focus();
  }
}

function initExtremeUI() {
  $("extreme-name").textContent = state.player.name;
  $("extreme-feedback").textContent = "";
  $("extreme-input").value = "";
  const tag = document.querySelector(".extreme-tag");
  if (tag) {
    const cfg = state.extremeConfig || { label: "I" };
    tag.textContent = `🚨 EXTREME ${cfg.label} 🚨`;
  }
  renderExtremeProgress();
  renderExtremeStrikes();
}

function renderExtremeProgress() {
  const el = $("extreme-progress");
  if (!state.extreme) { el.innerHTML = ""; return; }
  const cfg = state.extremeConfig || { showCount: true };
  const total = state.extreme.teams.length;
  const idx = state.extreme.idx;
  const pillsArr = [];
  for (let i = 0; i < total; i++) {
    if (i < idx) {
      pillsArr.push(`<span class="team-pill done">${TEAM_DISPLAY[state.extreme.teams[i]] || state.extreme.teams[i]}</span>`);
    } else if (i === idx) {
      pillsArr.push(`<span class="team-pill current">Team ${i + 1}</span>`);
    } else if (cfg.showCount) {
      pillsArr.push(`<span class="team-pill upcoming">?</span>`);
    }
  }
  const prompt = cfg.showCount
    ? `Team ${idx + 1} of ${total}`
    : `Team ${idx + 1} — total hidden`;
  el.innerHTML = `<div class="team-pills">${pillsArr.join("")}</div><div class="extreme-prompt">${prompt}</div>`;
}

function renderExtremeStrikes() {
  const el = $("extreme-strikes");
  const max = state.extremeConfig?.strikes ?? 3;
  const left = max - (state.extreme?.attempts || 0);
  el.textContent = `Strikes left: ${left}/${max}`;
}

function flashExtreme(msg, cls = "") {
  const el = $("extreme-feedback");
  el.textContent = msg;
  el.className = cls;
}

function submitExtreme(e) {
  e.preventDefault();
  if (!state.isExtreme || !state.extreme || state.finished) return;
  const raw = $("extreme-input").value.trim();
  if (!raw) return;
  const matched = matchTeam(raw);
  $("extreme-input").value = "";

  if (!matched) {
    state.extreme.attempts += 1;
    flashExtreme(`Not a team I recognize: "${raw}". Try nickname, city, or 3-letter code.`, "bad");
  } else if (matched === state.extreme.teams[state.extreme.idx]) {
    state.extreme.revealedSet.add(matched);
    state.extreme.idx += 1;
    flashExtreme(`✓ ${TEAM_DISPLAY[matched] || matched}`, "good");
    renderTable();
    renderExtremeProgress();
    if (state.extreme.idx >= state.extreme.teams.length) {
      setTimeout(() => showResult(true), 700);
      return;
    }
  } else if (state.extreme.teams.includes(matched)) {
    state.extreme.attempts += 1;
    flashExtreme(`${TEAM_DISPLAY[matched] || matched} is in there — but not yet. Earlier team first.`, "bad");
  } else {
    state.extreme.attempts += 1;
    flashExtreme(`They never played for ${TEAM_DISPLAY[matched] || matched}.`, "bad");
  }
  renderExtremeStrikes();
  const maxStrikes = state.extremeConfig?.strikes ?? 3;
  if (state.extreme.attempts >= maxStrikes) {
    setTimeout(() => showResult(false), 700);
    return;
  }
  $("extreme-input").focus();
}

function extremeGiveUp() {
  if (state.isExtreme && !state.finished) showResult(false);
}

function showChallengeBanner(from) {
  const el = $("challenge-banner");
  if (!el) return;
  const who = from ? `@${from}` : "A friend";
  el.innerHTML = `<span>🔗 ${who} sent you this player — can you guess them?</span>`;
  el.hidden = false;
}
function hideChallengeBanner() {
  const el = $("challenge-banner");
  if (el) { el.hidden = true; el.innerHTML = ""; }
}

async function shareCurrentPlayer() {
  if (!state.player) return;
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("p", state.player.slug);
  if (state.username) url.searchParams.set("from", state.username);

  const verdict = state.lastWon ? (state.isExtreme ? "🚨" : "🟢") : "💀";
  const who = state.username ? `@${state.username}` : "Someone";
  const mode = state.isExtreme ? "Extreme" : "Baseball Guess";
  const detail = state.lastWon
    ? (state.isExtreme ? "cleared Extreme!" : `${state.guesses} guesses, ${state.hintsUsed} hints`)
    : "stumped";
  const text = `${mode}: ${who} ${verdict} ${detail}\nYour turn: ${url.toString()}`;

  try {
    await navigator.clipboard.writeText(text);
    flashShareFeedback("Copied! Paste it to a friend.");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); flashShareFeedback("Copied! Paste it to a friend."); }
    catch { flashShareFeedback("Copy failed — long-press to copy this link manually.", true); }
    ta.remove();
  }
}

function flashShareFeedback(msg, isErr = false) {
  const el = $("share-feedback");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

function revealHint() {
  if (state.isExtreme || state.finished || !state.player) return;
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
  if (state.isExtreme || state.finished || !state.player) return;
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

function giveUp() { if (!state.isExtreme && !state.finished) showResult(false); }

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
  if (state.isExtreme) return;
  const raw = $("guess-input").value;
  const q = normalize(raw);
  state.ac.query = q;
  state.ac.active = -1;

  if (!q) { closeAutocomplete(); return; }

  const pool = getFilteredPool();
  const matches = [];
  for (const e of pool) {
    if (!e._n) e._n = normalize(e.name);
    const n = e._n;
    if (n.startsWith(q) || n.includes(" " + q)) {
      matches.push({ ...e, _starts: n.startsWith(q) ? 0 : 1 });
      if (matches.length >= 30) break;
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
  const s = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0,"extreme":false}');
  const winRate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
  const maxLvl = state.maxExtremeLevel || 0;
  const extremeBadge = maxLvl > 0
    ? ` 🚨 lv ${EXTREME_LEVELS[Math.min(maxLvl - 1, EXTREME_LEVELS.length - 1)].label}`
    : "";
  return `
    <div class="stats-card">
      <div class="stat"><span class="label">Your score${extremeBadge}</span><span class="value">${s.total}</span></div>
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
              const badge = s.extreme ? "🚨 " : "";
              return `<tr${me}><td>${i + 1}</td><td>${badge}@${s.username}</td><td>${s.score}</td><td>${s.rounds || "–"}</td></tr>`;
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
  $("share-btn").addEventListener("click", shareCurrentPlayer);

  $("extreme-form").addEventListener("submit", submitExtreme);
  $("extreme-giveup").addEventListener("click", extremeGiveUp);

  $("guess-input").addEventListener("input", updateAutocomplete);
  $("guess-input").addEventListener("keydown", onGuessKeydown);
  $("guess-input").addEventListener("blur", () => setTimeout(closeAutocomplete, 150));
  $("ac-list").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (li) { e.preventDefault(); selectSuggestion(parseInt(li.dataset.idx, 10)); }
  });

  state.shared = getSharedFromUrl();
  renderStatus();
  if (!state.username) showUsernameModal();
  newRound();
}

document.addEventListener("DOMContentLoaded", init);
