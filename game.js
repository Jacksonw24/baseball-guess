const HINT_LABELS = [
  "Position & handedness",
  "Career stat line",
  "Hometown",
  "Build",
  "Last-name initial",
];

const USERNAME_RE = /^[A-Za-z0-9_.\-]{2,20}$/;

const ERA_RANGES = {
  "1900s": [1900, 1909],
  "1910s": [1910, 1919],
  "1920s": [1920, 1929],
  "1930s": [1930, 1939],
  "1940s": [1940, 1949],
  "1950s": [1950, 1959],
  "1960s": [1960, 1969],
  "1970s": [1970, 1979],
  "1980s": [1980, 1989],
  "1990s": [1990, 1999],
  "2000s": [2000, 2009],
  "2010s": [2010, 2019],
  "2020s": [2020, 2029],
};

// Rename the legacy tier keys so existing installs don't break
const TIER_MIGRATION = { famous: "well_known", pros: "ball_knowledge", alltime: "stathead" };
(function migrateTierStorage() {
  const t = localStorage.getItem("bg.tier");
  if (t && TIER_MIGRATION[t]) localStorage.setItem("bg.tier", TIER_MIGRATION[t]);
  try {
    const r = JSON.parse(localStorage.getItem("bg.recentByTier") || "{}");
    let dirty = false;
    for (const k of Object.keys(r)) {
      if (TIER_MIGRATION[k]) { r[TIER_MIGRATION[k]] = r[k]; delete r[k]; dirty = true; }
    }
    if (dirty) localStorage.setItem("bg.recentByTier", JSON.stringify(r));
  } catch {}
})();

const STREAK_FOR_EXTREME = 5;
const EXTREME_START_YEAR = 2010;

// Each successive Extreme clear escalates difficulty. Index = extremeWins so far.
const EXTREME_LEVELS = [
  { strikes: 3, poolTier: "well_known",     showCount: true,  label: "I"   },
  { strikes: 3, poolTier: "ball_knowledge", showCount: true,  label: "II"  },
  { strikes: 2, poolTier: "ball_knowledge", showCount: true,  label: "III" },
  { strikes: 2, poolTier: "ball_knowledge", showCount: false, label: "IV"  },
  { strikes: 2, poolTier: "stathead",       showCount: false, label: "V"   },
  { strikes: 1, poolTier: "psycho",         showCount: false, label: "VI+" },
];
const TIER_RANK = { well_known: 0, ball_knowledge: 1, stathead: 2, psycho: 3 };
const TIERS_BY_RANK = ["well_known", "ball_knowledge", "stathead", "psycho"];

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
  tier: localStorage.getItem("bg.tier") || "well_known",
  era:  localStorage.getItem("bg.era")  || "all",
  pos:  localStorage.getItem("bg.pos")  || "all",
  team: localStorage.getItem("bg.team") || "all",
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
  recentByTier: (() => {
    try { return JSON.parse(localStorage.getItem("bg.recentByTier") || "{}"); }
    catch { return {}; }
  })(),
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

// On touch devices, skip the auto-focus calls that pop the soft keyboard.
// Users tap the input themselves when they're ready to guess.
const IS_TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
function maybeFocus(id) {
  if (IS_TOUCH) return;
  const el = $(id);
  if (el) el.focus();
}

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

const MARKER_TITLES = {
  "⭐":  "All-Star",
  "MVP": "Most Valuable Player",
  "CY":  "Cy Young",
  "ROY": "Rookie of the Year",
  "TC":  "Triple Crown",
  "WSM": "World Series MVP",
};

function renderMarkers(markers) {
  if (!markers?.length) return "";
  return markers.map(m => {
    const title = MARKER_TITLES[m] || m;
    const cls = m === "⭐" ? "marker-as" : "marker-award";
    return ` <span class="${cls}" title="${title}">${m}</span>`;
  }).join("");
}

function renderTable() {
  const wrap = $("table-wrap");
  if (!state.player) { wrap.innerHTML = ""; return; }
  const p = state.player;
  const visibleHeaders = p.headers
    .map((h, idx) => ({ ...h, idx }))
    .filter(h => !state.hidden.has(h.stat));
  const teamIdx = visibleHeaders.findIndex(h => h.stat === "team_name_abbr");
  const yearIdx = visibleHeaders.findIndex(h => h.stat === "year_id");
  const revealedSet = state.extreme?.revealedSet || null;
  const markers = p.markers || {};

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
      if (ci === yearIdx) {
        const ms = renderMarkers(markers[val]);
        return `<td class="year-cell">${val}${ms}</td>`;
      }
      return `<td>${val}</td>`;
    }).join("")}</tr>`
  ).join("");

  const caption = `<caption>${p.kind === "pitching" ? "Standard Pitching" : "Standard Batting"}</caption>`;
  wrap.innerHTML = `<div class="scroll"><table class="stats">${caption}<thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

// ---------- Pool filtering ----------

function playerHasTeam(entry, teamCode) {
  if (!entry.tm) return false;
  const list = entry.tm.split(",");
  return list.includes(teamCode);
}

const POS_GROUP_MEMBERS = {
  IF: new Set(["1B", "2B", "3B", "SS"]),
  OF: new Set(["LF", "CF", "RF", "OF"]),
};

function entryMatchesPos(entry, posFilter) {
  if (!posFilter || posFilter === "all") return true;
  const group = POS_GROUP_MEMBERS[posFilter];
  if (group) return group.has(entry.p);
  return entry.p === posFilter;
}

function getFilteredPool() {
  const base = state.manifest?.[state.tier] || [];
  const [eraLo, eraHi] = ERA_RANGES[state.era] || [];
  const pos = state.pos === "all" ? null : state.pos;
  const team = state.team === "all" ? null : state.team;
  return base.filter(e => {
    if (pos && !entryMatchesPos(e, pos)) return false;
    if (eraLo != null) {
      if (e.l == null || e.f == null) return false;
      if (e.l < eraLo || e.f > eraHi) return false;
    }
    if (team && !playerHasTeam(e, team)) return false;
    return true;
  });
}

function getExtremePool() {
  const tier = getExtremePoolTier();
  const base = state.manifest?.[tier] || [];
  return base.filter(e => (e.f || 9999) >= EXTREME_START_YEAR && (e.t || 0) >= 2);
}

const TEAM_DISPLAY_NAMES = {
  ARI:"Diamondbacks",ATL:"Braves",BAL:"Orioles",BOS:"Red Sox",CHC:"Cubs",
  CHW:"White Sox",CIN:"Reds",CLE:"Guardians",COL:"Rockies",DET:"Tigers",
  HOU:"Astros",KCR:"Royals",LAA:"Angels",LAD:"Dodgers",MIA:"Marlins",
  MIL:"Brewers",MIN:"Twins",NYM:"Mets",NYY:"Yankees",OAK:"Athletics",
  PHI:"Phillies",PIT:"Pirates",SDP:"Padres",SEA:"Mariners",SFG:"Giants",
  STL:"Cardinals",TBR:"Rays",TEX:"Rangers",TOR:"Blue Jays",WSN:"Nationals",
};

function renderPoolCount(pool) {
  const el = $("pool-count");
  if (!el) return;
  const parts = [];
  if (state.era !== "all")  parts.push(state.era);
  if (state.pos !== "all")  parts.push(({P:"pitchers",C:"catchers",IF:"infield",OF:"outfield",DH:"DH","1B":"first base","2B":"second base","3B":"third base",SS:"shortstop",LF:"left field",CF:"center field",RF:"right field"})[state.pos] || state.pos);
  if (state.team !== "all") parts.push(TEAM_DISPLAY_NAMES[state.team] || state.team);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  el.textContent = `${pool.length} player${pool.length === 1 ? "" : "s"} in pool${suffix}`;
}

// ---------- Score posting ----------

const POST_QUEUE_KEY = "bg.postQueue";
const SESSION_TOKEN_KEY = "bg.sessionToken";
const EVENTS_KEY        = "bg.events";
const ACHS_KEY          = "bg.achievements";
const COUNTERS_KEY      = "bg.counters";
const MAX_EVENTS        = 10000;

const MODERN_TEAMS = new Set([
  "ARI","ATL","BAL","BOS","CHC","CHW","CIN","CLE","COL","DET",
  "HOU","KCR","LAA","LAD","MIA","MIL","MIN","NYM","NYY","OAK",
  "PHI","PIT","SDP","SEA","SFG","STL","TBR","TEX","TOR","WSN",
]);

// --------------- Achievement definitions ---------------
const CAT_ICON = {
  welcome:"🌱", volume:"📦", streak:"🔥", skill:"🎯",
  variety:"🌎", extreme:"🚨", style:"🎨", hidden:"🕵️", legendary:"💎",
};
const CAT_ORDER = ["welcome","volume","streak","skill","variety","extreme","style","hidden","legendary"];

const ACHIEVEMENTS = [
  // 🌱 Welcome
  { id:"first_pitch",  cat:"welcome",  title:"First Pitch",
    desc:"Win your first round.",
    check: s => s.totalWins >= 1, progress: s => [Math.min(s.totalWins,1), 1] },
  { id:"streaker3",    cat:"welcome",  title:"Streaker",
    desc:"Win 3 in a row.",
    check: s => s.bestStreak >= 3, progress: s => [Math.min(s.bestStreak,3), 3] },
  { id:"comeback_kid", cat:"welcome",  title:"Comeback Kid",
    desc:"Win after using 4+ hints in a single round.",
    check: s => s.maxHintsInAWin >= 4, progress: s => [Math.min(s.maxHintsInAWin,4), 4] },
  { id:"bullpen",      cat:"welcome",  title:"Bullpen",
    desc:"Win 5 rounds in one session.",
    check: s => s.sessionMaxWins >= 5, progress: s => [Math.min(s.sessionMaxWins,5), 5] },

  // 📦 Volume
  { id:"centurion_1", cat:"volume", title:"Centurion I",   desc:"100 lifetime wins.",
    check: s => s.totalWins >= 100,  progress: s => [s.totalWins,100] },
  { id:"centurion_2", cat:"volume", title:"Centurion II",  desc:"500 lifetime wins.",
    check: s => s.totalWins >= 500,  progress: s => [s.totalWins,500] },
  { id:"centurion_3", cat:"volume", title:"Centurion III", desc:"2,000 lifetime wins.",
    check: s => s.totalWins >= 2000, progress: s => [s.totalWins,2000] },
  { id:"marathoner_1", cat:"volume", title:"Marathoner I",   desc:"250 rounds played.",
    check: s => s.totalRounds >= 250,  progress: s => [s.totalRounds,250] },
  { id:"marathoner_2", cat:"volume", title:"Marathoner II",  desc:"1,000 rounds played.",
    check: s => s.totalRounds >= 1000, progress: s => [s.totalRounds,1000] },
  { id:"marathoner_3", cat:"volume", title:"Marathoner III", desc:"5,000 rounds played.",
    check: s => s.totalRounds >= 5000, progress: s => [s.totalRounds,5000] },
  { id:"daily_pilgrim_1", cat:"volume", title:"Daily Pilgrim I",   desc:"7-day daily streak.",
    check: s => s.dailyStreakBest >= 7,   progress: s => [Math.min(s.dailyStreakBest,7),7] },
  { id:"daily_pilgrim_2", cat:"volume", title:"Daily Pilgrim II",  desc:"30-day daily streak.",
    check: s => s.dailyStreakBest >= 30,  progress: s => [Math.min(s.dailyStreakBest,30),30] },
  { id:"daily_pilgrim_3", cat:"volume", title:"Daily Pilgrim III", desc:"100-day daily streak.",
    check: s => s.dailyStreakBest >= 100, progress: s => [Math.min(s.dailyStreakBest,100),100] },

  // 🔥 Streak
  { id:"hot_hand_1", cat:"streak", title:"Hot Hand I",   desc:"10 wins in a row.",
    check: s => s.bestStreak >= 10,  progress: s => [Math.min(s.bestStreak,10),10] },
  { id:"hot_hand_2", cat:"streak", title:"Hot Hand II",  desc:"25 wins in a row.",
    check: s => s.bestStreak >= 25,  progress: s => [Math.min(s.bestStreak,25),25] },
  { id:"hot_hand_3", cat:"streak", title:"Hot Hand III", desc:"50 wins in a row.",
    check: s => s.bestStreak >= 50,  progress: s => [Math.min(s.bestStreak,50),50] },
  { id:"untouchable", cat:"streak", title:"Untouchable",  desc:"100 wins in a row.",
    check: s => s.bestStreak >= 100, progress: s => [Math.min(s.bestStreak,100),100] },
  { id:"iron_heart",  cat:"streak", title:"Iron Heart",
    desc:"Finish a 30-round session without losing.",
    check: s => s.cleanSessionRounds >= 30 },

  // 🎯 Skill
  { id:"no_help_1", cat:"skill", title:"No Help Needed I",   desc:"25 hint-free wins.",
    check: s => s.noHintWins >= 25,  progress: s => [s.noHintWins,25] },
  { id:"no_help_2", cat:"skill", title:"No Help Needed II",  desc:"100 hint-free wins.",
    check: s => s.noHintWins >= 100, progress: s => [s.noHintWins,100] },
  { id:"no_help_3", cat:"skill", title:"No Help Needed III", desc:"500 hint-free wins.",
    check: s => s.noHintWins >= 500, progress: s => [s.noHintWins,500] },
  { id:"one_look_1", cat:"skill", title:"One Look I",   desc:"10 one-guess wins.",
    check: s => s.oneGuessWins >= 10,  progress: s => [s.oneGuessWins,10] },
  { id:"one_look_2", cat:"skill", title:"One Look II",  desc:"50 one-guess wins.",
    check: s => s.oneGuessWins >= 50,  progress: s => [s.oneGuessWins,50] },
  { id:"one_look_3", cat:"skill", title:"One Look III", desc:"250 one-guess wins.",
    check: s => s.oneGuessWins >= 250, progress: s => [s.oneGuessWins,250] },
  { id:"photo_finish", cat:"skill", title:"Photo Finish",
    desc:"25 wins on your 6th and final guess.",
    check: s => s.sixthGuessWins >= 25, progress: s => [s.sixthGuessWins,25] },
  { id:"pitchers_pitcher", cat:"skill", title:"Pitcher's Pitcher",
    desc:"20 pitcher wins under 4 guesses each.",
    check: s => s.pitcherQuickWins >= 20, progress: s => [s.pitcherQuickWins,20] },

  // 🌎 Variety
  { id:"thirty_thirty", cat:"variety", title:"30/30 Club",
    desc:"Win against a player from every modern franchise.",
    check: s => s.modernTeamsHit >= 30, progress: s => [s.modernTeamsHit,30] },
  { id:"time_traveler", cat:"variety", title:"Time Traveler",
    desc:"Win in every decade from 1900s through 2020s (13 decades).",
    check: s => s.decadesHit >= 13, progress: s => [s.decadesHit,13] },
  { id:"polyglot_1", cat:"variety", title:"Polyglot I",   desc:"Players from 5 different countries.",
    check: s => s.countriesHit >= 5,  progress: s => [s.countriesHit,5] },
  { id:"polyglot_2", cat:"variety", title:"Polyglot II",  desc:"Players from 10 different countries.",
    check: s => s.countriesHit >= 10, progress: s => [s.countriesHit,10] },
  { id:"polyglot_3", cat:"variety", title:"Polyglot III", desc:"Players from 20 different countries.",
    check: s => s.countriesHit >= 20, progress: s => [s.countriesHit,20] },
  { id:"position_master", cat:"variety", title:"Position Master",
    desc:"Win against each of the 10 specific positions.",
    check: s => s.positionsHit >= 10, progress: s => [s.positionsHit,10] },

  // 🚨 Extreme
  { id:"pop_off",       cat:"extreme", title:"Pop Off",
    desc:"Clear your first Extreme.",
    check: s => s.extremesCleared >= 1 },
  { id:"five_for_five", cat:"extreme", title:"Five for Five",
    desc:"Clear Extreme V.",
    check: s => s.maxExtremeLevel >= 5 },
  { id:"the_boss",      cat:"extreme", title:"The Boss",
    desc:"Clear Extreme VI+.",
    check: s => s.maxExtremeLevel >= 6 },
  { id:"unbroken_5",    cat:"extreme", title:"Unbroken",
    desc:"Extreme chain of 5 consecutive clears.",
    check: s => s.bestExtremeChain >= 5, progress: s => [Math.min(s.bestExtremeChain,5),5] },
  { id:"unbroken_10",   cat:"extreme", title:"Unbroken II",
    desc:"Extreme chain of 10 consecutive clears.",
    check: s => s.bestExtremeChain >= 10, progress: s => [Math.min(s.bestExtremeChain,10),10] },
  { id:"phoenix",       cat:"extreme", title:"The Phoenix",
    desc:"Clear Extreme VI+ without using a strike.",
    check: s => s.flawlessHighExtreme === true },

  // 🎨 Style
  { id:"bombs_away", cat:"style", title:"Bombs Away",
    desc:"50 wins on sluggers (300+ career HR).",
    check: s => s.sluggerWins >= 50, progress: s => [s.sluggerWins,50] },
  { id:"the_ace", cat:"style", title:"The Ace",
    desc:"50 wins on ace pitchers (career WAR ≥ 40).",
    check: s => s.aceWins >= 50, progress: s => [s.aceWins,50] },
  { id:"late_night", cat:"style", title:"Late Night Special",
    desc:"Play 3 rounds between 2am and 5am local time.",
    check: s => s.lateNightRounds >= 3, progress: s => [Math.min(s.lateNightRounds,3),3] },
  { id:"comeback_tour", cat:"style", title:"Comeback Tour",
    desc:"Return after 30+ days away.",
    check: s => s.gappedReturn === true },
  { id:"the_mentor", cat:"style", title:"The Mentor",
    desc:"Share 25 unique players via deep link.",
    check: s => s.uniqueShares >= 25, progress: s => [s.uniqueShares,25] },
  { id:"open_books", cat:"style", title:"Open Books",
    desc:"Open the leaderboard 25 times.",
    check: s => s.leaderboardViews >= 25, progress: s => [s.leaderboardViews,25] },
  { id:"speakers_corner", cat:"style", title:"Speaker's Corner",
    desc:"Change your username 5+ times.",
    check: s => s.usernameChanges >= 5, progress: s => [s.usernameChanges,5] },

  // 🕵️ Hidden — render as ??? until unlocked. Slug-based for stability.
  { id:"dog_photo",     cat:"hidden", hidden:true, title:"Dog Photo",
    desc:"There's no way you guessed Pete Crow-Armstrong.",
    check: s => s.slugsHit.has("crowape01") },
  { id:"the_bambino",   cat:"hidden", hidden:true, title:"The Bambino",
    desc:"You called your shot.",
    check: s => s.slugsHit.has("ruthba01") },
  { id:"iron_man",      cat:"hidden", hidden:true, title:"Iron Man",
    desc:"2,632 games in a row, baby.",
    check: s => s.slugsHit.has("ripkeca01") },
  { id:"two_way",       cat:"hidden", hidden:true, title:"Two-Way",
    desc:"You spotted the once-in-a-century.",
    check: s => s.slugsHit.has("ohtansh01") },
  { id:"four_hundred",  cat:"hidden", hidden:true, title:".400",
    desc:"The last man to do it.",
    check: s => s.slugsHit.has("willite01") },
  { id:"the_hammer",    cat:"hidden", hidden:true, title:"The Hammer",
    desc:"755 and counting.",
    check: s => s.slugsHit.has("aaronha01") },
  { id:"lefty_x3",      cat:"hidden", hidden:true, title:"Lefty Lefty Lefty",
    desc:"Five lefty-throwing wins in a row.",
    check: s => s.bestLeftyStreak >= 5 },

  // 💎 Legendary
  { id:"encyclopedia", cat:"legendary", title:"Encyclopedia",
    desc:"Win against every player in the manifest.",
    check: s => s.uniquePlayersHit >= 12071, progress: s => [s.uniquePlayersHit,12071] },
  { id:"stathead_certified", cat:"legendary", title:"Stathead Certified",
    desc:"250 Stathead-tier wins.",
    check: s => (s.tierWinsByTier.stathead||0) >= 250,
    progress: s => [s.tierWinsByTier.stathead||0,250] },
  { id:"psycho_certified", cat:"legendary", title:"Psycho Certified",
    desc:"100 Psycho-tier wins.",
    check: s => (s.tierWinsByTier.psycho||0) >= 100,
    progress: s => [s.tierWinsByTier.psycho||0,100] },
  { id:"boss_x4", cat:"legendary", title:"Boss × 4",
    desc:"Clear Extreme on all 4 difficulty tiers.",
    check: s => s.allTiersExtremeCleared === true },
];

// --------------- Achievement persistence ---------------

function loadEvents()   { try { return JSON.parse(localStorage.getItem(EVENTS_KEY)   || "[]"); } catch { return []; } }
function saveEvents(a)  { localStorage.setItem(EVENTS_KEY,   JSON.stringify(a.length > MAX_EVENTS ? a.slice(-MAX_EVENTS) : a)); }
function loadUnlocked() { try { return JSON.parse(localStorage.getItem(ACHS_KEY)     || "{}"); } catch { return {}; } }
function saveUnlocked(m){ localStorage.setItem(ACHS_KEY,     JSON.stringify(m)); }
function loadCounters() { try { return JSON.parse(localStorage.getItem(COUNTERS_KEY) || "{}"); } catch { return {}; } }
function saveCounters(c){ localStorage.setItem(COUNTERS_KEY, JSON.stringify(c)); }

function parseCountry(hints) {
  if (!hints) return "";
  for (const h of hints) {
    if (h.startsWith("Hometown:")) return "USA";
    const m = h.match(/^Born in (.+)/);
    if (m) return m[1].replace(/^the\s+/i, "").trim();
  }
  return "";
}
function parsePos(hints) {
  if (!hints?.length) return "";
  const h = hints[0];
  if (!h.startsWith("Position:")) return "";
  const head = h.slice(9).split(" — ")[0].split(" and ")[0].trim();
  return ({
    "Pitcher":"P","Catcher":"C","Shortstop":"SS",
    "First Baseman":"1B","Second Baseman":"2B","Third Baseman":"3B",
    "Leftfielder":"LF","Centerfielder":"CF","Rightfielder":"RF",
    "Outfielder":"OF","Designated Hitter":"DH",
    "First Base":"1B","Second Base":"2B","Third Base":"3B",
    "Left Fielder":"LF","Center Fielder":"CF","Right Fielder":"RF",
  })[head] || "";
}
function parseThrows(hints) {
  const m = hints?.[0]?.match(/throws (\w+)/);
  return m ? m[1] : "";
}
function parseCareerHR(hints) {
  for (const h of (hints || [])) {
    const m = h.match(/Career:\s*(\d+)\s*HR/);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

function rowYears(player) {
  if (!player?.headers) return [];
  const yi = player.headers.findIndex(h => h.stat === "year_id");
  if (yi < 0) return [];
  const out = [];
  for (const r of player.rows) {
    const y = parseInt(r[yi], 10);
    if (!isNaN(y)) out.push(y);
  }
  return out;
}

function decadeOf(year) { return Math.floor(year / 10) * 10; }

function recordWinEvent(player, ctx) {
  if (!player) return null;
  const years = rowYears(player);
  const firstYear = years.length ? Math.min(...years) : null;
  const lastYear  = years.length ? Math.max(...years) : null;
  const teamSet   = new Set(extractTeams(player));
  const ev = {
    name: player.name || "",
    slug: player.slug || "",
    tier: ctx.tier,
    pos:  parsePos(player.hints),
    throws: parseThrows(player.hints),
    country: parseCountry(player.hints) || "USA",
    teams: [...teamSet],
    firstYear, lastYear,
    careerHR: parseCareerHR(player.hints),
    careerWar: ctx.careerWar || 0,
    hintsUsed: ctx.hintsUsed,
    guesses:   ctx.guesses,
    isExtreme: !!ctx.isExtreme,
    extremeLevel: ctx.extremeLevel || null,
    extremeStrikes: ctx.extremeStrikes || 0,
    ts: Date.now(),
  };
  const arr = loadEvents();
  arr.push(ev);
  saveEvents(arr);
  return ev;
}

function updateRoundCounters(won, ev) {
  const c = loadCounters();
  const now = Date.now();
  // Use the user's LOCAL date so midnight in their timezone is the boundary,
  // not UTC midnight (which would shift the day for anyone outside UTC).
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // Daily streak (login-based)
  const lastDay = c.lastDayPlayed;
  if (lastDay !== todayKey) {
    // Determine consecutive
    if (lastDay) {
      // Parse YYYY-MM-DD into a local-midnight Date for a clean delta in days
      const p = (k) => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
      const days = Math.round((p(todayKey) - p(lastDay)) / 86400000);
      if (days === 1) {
        c.dailyStreakCur = (c.dailyStreakCur || 1) + 1;
      } else if (days > 1) {
        if (days >= 30 && (c.lifetimeWins || 0) > 0) c.gappedReturn = true;
        c.dailyStreakCur = 1;
      }
    } else {
      c.dailyStreakCur = 1;
    }
    c.lastDayPlayed = todayKey;
    if ((c.dailyStreakCur || 0) > (c.dailyStreakBest || 0)) c.dailyStreakBest = c.dailyStreakCur;
  }

  // Late night
  const hr = new Date().getHours();
  if (hr >= 2 && hr < 5) c.lateNightRounds = (c.lateNightRounds || 0) + 1;

  // Win streak (current + best)
  if (won) {
    c.winStreakCur = (c.winStreakCur || 0) + 1;
    if (c.winStreakCur > (c.bestWinStreak || 0)) c.bestWinStreak = c.winStreakCur;
    // Session clean
    c.sessionWins = (c.sessionWins || 0) + 1;
    c.sessionCleanRounds = (c.sessionCleanRounds || 0) + 1;
    if ((c.sessionWins || 0) > (c.sessionMaxWins || 0)) c.sessionMaxWins = c.sessionWins;
    if ((c.sessionCleanRounds || 0) > (c.bestCleanSessionRounds || 0))
      c.bestCleanSessionRounds = c.sessionCleanRounds;
  } else {
    c.winStreakCur = 0;
    c.sessionCleanRounds = 0;
  }

  // Lefty-throws win streak (only counts wins)
  if (won && ev && ev.throws === "L") {
    c.leftyStreakCur = (c.leftyStreakCur || 0) + 1;
    if (c.leftyStreakCur > (c.bestLeftyStreak || 0)) c.bestLeftyStreak = c.leftyStreakCur;
  } else if (!won) {
    c.leftyStreakCur = 0;
  } else {
    c.leftyStreakCur = 0;
  }

  // Slugger / ace
  if (won && ev) {
    if (ev.careerHR >= 300) c.sluggerWins = (c.sluggerWins || 0) + 1;
    if (ev.pos === "P" && ev.careerWar >= 40) c.aceWins = (c.aceWins || 0) + 1;
  }

  // Lifetime
  c.lifetimeRounds = (c.lifetimeRounds || 0) + 1;
  if (won) c.lifetimeWins = (c.lifetimeWins || 0) + 1;

  // Extreme chain tracking (chain = consecutive Extreme clears)
  if (won && ev && ev.isExtreme) {
    c.extremeChainCur = (c.extremeChainCur || 0) + 1;
    if (c.extremeChainCur > (c.bestExtremeChain || 0)) c.bestExtremeChain = c.extremeChainCur;
    if (ev.extremeLevel >= 6 && ev.extremeStrikes === 0) c.flawlessHighExtreme = true;
    c.tierExtremesCleared = c.tierExtremesCleared || {};
    if (ev.tier) c.tierExtremesCleared[ev.tier] = true;
    if (["well_known","ball_knowledge","stathead","psycho"]
        .every(t => c.tierExtremesCleared[t])) c.allTiersExtremeCleared = true;
  } else if (!won && ev && ev.isExtreme) {
    c.extremeChainCur = 0;
  }

  saveCounters(c);
}

function bumpCounter(key, n = 1) {
  const c = loadCounters();
  c[key] = (c[key] || 0) + n;
  saveCounters(c);
}

function addUniqueShare(slug) {
  const c = loadCounters();
  c.sharedSlugs = c.sharedSlugs || [];
  if (!c.sharedSlugs.includes(slug)) {
    c.sharedSlugs.push(slug);
    c.uniqueShares = c.sharedSlugs.length;
    saveCounters(c);
  }
}

function computeSnapshot() {
  // Achievements track only activity from the moment the system shipped.
  // No counts get pulled from the pre-existing bg.stats / state.maxExtremeLevel.
  const events = loadEvents();
  const c = loadCounters();

  const totalWins   = events.length;
  const totalRounds = c.lifetimeRounds || 0;

  const teams = new Set(), decades = new Set(), countries = new Set(), positions = new Set();
  const names = new Set(), slugs = new Set();
  const tierWinsByTier = { well_known:0, ball_knowledge:0, stathead:0, psycho:0 };
  let noHint=0, oneG=0, sixG=0, pitchFast=0, maxHints=0, extremes=0;
  let maxExtLevel = 0;

  for (const ev of events) {
    if (ev.name) names.add(ev.name);
    if (ev.slug) slugs.add(ev.slug);
    if (ev.teams) for (const t of ev.teams) if (MODERN_TEAMS.has(t)) teams.add(t);
    if (ev.firstYear) {
      const d = decadeOf(ev.firstYear);
      if (d >= 1900 && d <= 2020) decades.add(d);
    }
    if (ev.country) countries.add(ev.country);
    if (ev.pos) positions.add(ev.pos);
    if (!ev.hintsUsed) noHint++;
    if (ev.guesses === 1) oneG++;
    if (!ev.isExtreme && ev.guesses === 6) sixG++;
    if (ev.hintsUsed > maxHints) maxHints = ev.hintsUsed;
    if (ev.pos === "P" && ev.guesses <= 3) pitchFast++;
    if (ev.isExtreme) {
      extremes++;
      if (ev.extremeLevel && ev.extremeLevel > maxExtLevel) maxExtLevel = ev.extremeLevel;
    }
    if (ev.tier && (ev.tier in tierWinsByTier)) tierWinsByTier[ev.tier]++;
  }

  return {
    totalWins, totalRounds,
    bestStreak: c.bestWinStreak || 0,
    sessionMaxWins: c.sessionMaxWins || 0,
    cleanSessionRounds: c.bestCleanSessionRounds || 0,
    maxHintsInAWin: maxHints,
    noHintWins: noHint,
    oneGuessWins: oneG,
    sixthGuessWins: sixG,
    pitcherQuickWins: pitchFast,
    modernTeamsHit: teams.size,
    decadesHit: decades.size,
    countriesHit: countries.size,
    positionsHit: positions.size,
    namesHit: names,
    slugsHit: slugs,
    uniquePlayersHit: slugs.size,
    extremesCleared: extremes,
    maxExtremeLevel: maxExtLevel,
    bestExtremeChain: c.bestExtremeChain || 0,
    flawlessHighExtreme: c.flawlessHighExtreme === true,
    allTiersExtremeCleared: c.allTiersExtremeCleared === true,
    dailyStreakBest: c.dailyStreakBest || 0,
    sluggerWins: c.sluggerWins || 0,
    aceWins: c.aceWins || 0,
    lateNightRounds: c.lateNightRounds || 0,
    gappedReturn: c.gappedReturn === true,
    uniqueShares: c.uniqueShares || 0,
    leaderboardViews: c.leaderboardViews || 0,
    usernameChanges: c.usernameChanges || 0,
    bestLeftyStreak: c.bestLeftyStreak || 0,
    tierWinsByTier,
  };
}

function evaluateAchievements() {
  const snap = computeSnapshot();
  const unlocked = loadUnlocked();
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]?.unlocked) continue;
    let ok = false;
    try { ok = !!a.check(snap); } catch {}
    if (ok) { unlocked[a.id] = { unlocked: true, at: Date.now() }; newly.push(a); }
  }
  if (newly.length) {
    saveUnlocked(unlocked);
    queueAchievementToasts(newly);
  }
  return { snap, unlocked };
}

// --------------- Toast queue ---------------
const ACH_QUEUE = [];
let achToastBusy = false;
function queueAchievementToasts(unlocks) {
  ACH_QUEUE.push(...unlocks);
  if (!achToastBusy) processAchQueue();
}
function processAchQueue() {
  const a = ACH_QUEUE.shift();
  if (!a) { achToastBusy = false; return; }
  achToastBusy = true;
  const wrap = $("ach-toast-wrap");
  if (!wrap) { achToastBusy = false; return; }
  const el = document.createElement("div");
  el.className = "ach-toast";
  el.innerHTML = `
    <div class="ach-icon">${CAT_ICON[a.cat] || "🏆"}</div>
    <div class="ach-body">
      <div class="ach-label">🏆 Unlocked</div>
      <div class="ach-title">${escapeHtml(a.title)}</div>
      <div class="ach-desc">${escapeHtml(a.desc)}</div>
    </div>`;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.remove(); processAchQueue(); }, 350);
  }, 3800);
}

// --------------- Gallery ---------------
function openAchievementModal() {
  // Close the leaderboard modal first if it's open — stacking gets weird otherwise
  const lb = $("leaderboard-modal"); if (lb) lb.hidden = true;
  const { snap, unlocked } = evaluateAchievements();
  const modal = $("achievement-modal");
  if (!modal) return;
  modal.hidden = false;

  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter(a => unlocked[a.id]?.unlocked).length;
  const evCount = loadEvents().length;
  $("achievement-summary").innerHTML = `${unlockedCount} / ${total} unlocked &nbsp;·&nbsp; ${evCount} win${evCount === 1 ? "" : "s"} tracked`;

  const grouped = {};
  for (const a of ACHIEVEMENTS) {
    (grouped[a.cat] = grouped[a.cat] || []).push(a);
  }
  const html = CAT_ORDER.filter(c => grouped[c]).map(cat => {
    const items = grouped[cat].map(a => {
      const u = unlocked[a.id]?.unlocked;
      const hideContent = a.hidden && !u;
      const title = hideContent ? "???" : a.title;
      const desc  = hideContent ? "Find it." : a.desc;
      let progBar = "";
      if (!u && !a.hidden && a.progress) {
        try {
          const [n, d] = a.progress(snap);
          const pct = d > 0 ? Math.min(100, Math.floor((n / d) * 100)) : 0;
          progBar = `<div class="ach-progress"><div class="ach-progress-fill" style="width:${pct}%"></div><span class="ach-progress-label">${n} / ${d}</span></div>`;
        } catch {}
      }
      return `
        <div class="ach-card ${u ? "unlocked" : "locked"}">
          <div class="ach-card-icon">${u ? (CAT_ICON[a.cat] || "🏆") : "🔒"}</div>
          <div class="ach-card-body">
            <div class="ach-card-title">${escapeHtml(title)}</div>
            <div class="ach-card-desc">${escapeHtml(desc)}</div>
            ${progBar}
          </div>
        </div>`;
    }).join("");
    const catTitle = ({welcome:"Welcome",volume:"Volume",streak:"Streak",skill:"Skill",
                       variety:"Variety",extreme:"Extreme",style:"Style",hidden:"Hidden",legendary:"Legendary"})[cat] || cat;
    return `<div class="ach-cat"><h3>${CAT_ICON[cat] || ""} ${catTitle}</h3>${items}</div>`;
  }).join("");
  $("achievement-list").innerHTML = html;
}
function closeAchievementModal() {
  const m = $("achievement-modal");
  if (m) m.hidden = true;
}

function getSessionToken() {
  let t = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    t = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) +
         Math.random().toString(36).slice(2) +
         Date.now().toString(36));
    t = t.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    if (t.length < 16) t = t + "abcdef0123456789".slice(0, 16 - t.length);
    localStorage.setItem(SESSION_TOKEN_KEY, t);
  }
  return t;
}

function loadPostQueue() {
  try { return JSON.parse(localStorage.getItem(POST_QUEUE_KEY) || "[]"); } catch { return []; }
}
function savePostQueue(q) {
  localStorage.setItem(POST_QUEUE_KEY, JSON.stringify(q));
}

async function postScoreRequest(body) {
  const res = await fetch("/api/leaderboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, sessionToken: getSessionToken() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.body = err;
    throw e;
  }
  return res;
}

async function postScore(points, extreme = false) {
  if (!state.username || (points <= 0 && !extreme)) return;
  const body = { username: state.username, points, extreme };
  try {
    await postScoreRequest(body);
  } catch (e) {
    // 4xx errors are permanent — surface to user, don't queue
    if (e.status && e.status >= 400 && e.status < 500) {
      flashShareFeedback(e.message || "Score not recorded.", true);
      // 403 = claimed by another session → prompt user to pick another name
      if (e.status === 403) {
        setTimeout(() => {
          if (confirm("Your username is claimed on another device. Pick a different name?")) {
            showUsernameModal();
          }
        }, 100);
      }
      return;
    }
    // 5xx / offline → queue for retry
    const q = loadPostQueue();
    q.push({ ...body, ts: Date.now() });
    savePostQueue(q);
  }
}

async function flushPostQueue() {
  const q = loadPostQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      await postScoreRequest({ username: item.username, points: item.points, extreme: item.extreme });
    } catch (e) {
      remaining.push(item);
    }
  }
  savePostQueue(remaining);
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
  const localStats = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0,"extreme":false,"extremeWinsTotal":0}');
  localStats.rounds += 1;
  if (won) {
    localStats.wins += 1;
    localStats.total += points;
    if (points > localStats.best) localStats.best = points;
    if (state.isExtreme) {
      localStats.extreme = true;
      localStats.extremeWinsTotal = (localStats.extremeWinsTotal || 0) + 1;
    }
  }
  localStorage.setItem("bg.stats", JSON.stringify(localStats));

  // ---- Achievement tracking ----
  let evRecord = null;
  if (won) {
    evRecord = recordWinEvent(state.player, {
      tier: state.tier,
      hintsUsed: state.hintsUsed,
      guesses: state.guesses,
      isExtreme: state.isExtreme,
      extremeLevel: state.isExtreme ? (state.extremeWins + 1) : null,
      extremeStrikes: state.extreme?.attempts || 0,
    });
  }
  updateRoundCounters(won, evRecord);
  evaluateAchievements();

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

function recentListFor(tierKey) {
  if (!state.recentByTier[tierKey]) state.recentByTier[tierKey] = [];
  return state.recentByTier[tierKey];
}

function saveRecent() {
  try { localStorage.setItem("bg.recentByTier", JSON.stringify(state.recentByTier)); }
  catch {}
}

function pickRandomId(pool, tierKey) {
  if (!pool.length) return null;
  // Cap = max(20, 25% of pool), no more than 100 — gives natural decay
  const cap = Math.max(20, Math.min(100, Math.floor(pool.length * 0.25)));
  const recent = recentListFor(tierKey || state.tier);
  const exclude = new Set(recent.slice(-cap));
  let pick;
  for (let tries = 0; tries < 30; tries++) {
    pick = pool[Math.floor(Math.random() * pool.length)];
    if (!exclude.has(pick.id)) break;
  }
  recent.push(pick.id);
  while (recent.length > cap * 2) recent.shift();
  saveRecent();
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
      id = pickRandomId(pool, `ex-${getExtremePoolTier()}`);
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
      id = pickRandomId(fb, state.tier);
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
    id = pickRandomId(pool, `${state.tier}|${state.era}|${state.pos}`);
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
    maybeFocus("extreme-input");
  } else {
    maybeFocus("guess-input");
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
  maybeFocus("extreme-input");
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
  addUniqueShare(state.player.slug);
  evaluateAchievements();
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("p", state.player.slug);
  if (state.username) url.searchParams.set("from", state.username);
  const urlStr = url.toString();

  const verdict = state.lastWon ? (state.isExtreme ? "🚨" : "🟢") : "💀";
  const who = state.username ? `@${state.username}` : "Someone";
  const mode = state.isExtreme ? "Extreme" : "Baseball Guess";
  const detail = state.lastWon
    ? (state.isExtreme ? "cleared Extreme!" : `${state.guesses} guesses, ${state.hintsUsed} hints`)
    : "stumped";
  const text = `${mode}: ${who} ${verdict} ${detail}`;
  const fullText = `${text}\nYour turn: ${urlStr}`;

  // 1) Native share sheet (iOS, Android, Chrome desktop on touch devices)
  if (navigator.share) {
    try {
      await navigator.share({ title: "Who's the Ballplayer?", text, url: urlStr });
      flashShareFeedback("Sent!");
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;  // user cancelled the sheet — no-op
      // fall through to clipboard
    }
  }

  // 2) Modern clipboard API
  try {
    await navigator.clipboard.writeText(fullText);
    flashShareFeedback("Copied! Paste it to a friend.");
    return;
  } catch (e) {}

  // 3) Legacy clipboard fallback
  const ta = document.createElement("textarea");
  ta.value = fullText; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); flashShareFeedback("Copied! Paste it to a friend."); }
  catch { flashShareFeedback("Couldn't share — long-press the link to copy it manually.", true); }
  ta.remove();
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
  else maybeFocus("guess-input");
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
function onTeamChange(e) {
  state.team = e.target.value;
  localStorage.setItem("bg.team", state.team);
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

  let pool = getFilteredPool();
  // If the round's actual answer is outside the filtered pool (shared-challenge
  // link, etc.), supplement the pool so the user can still autocomplete to it.
  if (state.player?.slug && !pool.some(e => e.id === state.player.slug)) {
    const psycho = state.manifest?.psycho || [];
    const fromAll = psycho.find(e => e.id === state.player.slug);
    if (fromAll) pool = [fromAll, ...pool];
  }
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
  if (state.username && v !== state.username) bumpCounter("usernameChanges", 1);
  state.username = v;
  localStorage.setItem("bg.username", v);
  $("username-error").textContent = "";
  hideUsernameModal();
  renderStatus();
  evaluateAchievements();
}

// ---------- Leaderboard modal ----------

function showLeaderboardModal() {
  bumpCounter("leaderboardViews", 1);
  $("leaderboard-modal").hidden = false;
  loadLeaderboard();
  evaluateAchievements();
}
function hideLeaderboardModal() { $("leaderboard-modal").hidden = true; }

function extremeBadgeText(n) {
  if (!n) return "";
  return n > 1 ? `🚨×${n}` : "🚨";
}

function renderLocalStatsCard() {
  const s = JSON.parse(localStorage.getItem("bg.stats") || '{"rounds":0,"wins":0,"total":0,"best":0,"extreme":false,"extremeWinsTotal":0}');
  const winRate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
  const exTotal = s.extremeWinsTotal || (s.extreme ? 1 : 0);
  const maxLvl = state.maxExtremeLevel || 0;
  const ladder = maxLvl > 0
    ? ` · lv ${EXTREME_LEVELS[Math.min(maxLvl - 1, EXTREME_LEVELS.length - 1)].label}`
    : "";
  const badge = exTotal > 0 ? ` ${extremeBadgeText(exTotal)}${ladder}` : "";
  const unlocked = loadUnlocked();
  const unlockedN = ACHIEVEMENTS.filter(a => unlocked[a.id]?.unlocked).length;
  return `
    <div class="stats-card">
      <div class="stat"><span class="label">Your score${badge}</span><span class="value">${s.total}</span></div>
      <div class="stat"><span class="label">Wins</span><span class="value">${s.wins}/${s.rounds}</span></div>
      <div class="stat"><span class="label">Win %</span><span class="value">${winRate}%</span></div>
    </div>
    <button id="open-achievements" type="button" class="ach-button">🏆 ${unlockedN} / ${ACHIEVEMENTS.length} achievements unlocked — open gallery →</button>`;
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
              const exCount = (s.extremes != null) ? s.extremes : (s.extreme ? 1 : 0);
              const badge = exCount > 0 ? `${extremeBadgeText(exCount)} ` : "";
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

// ---------- Service Worker / PWA ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e) => {
    const data = e.data || {};
    if (data.type === "install-progress") {
      showInstallProgress(data.done, data.total);
    } else if (data.type === "install-complete") {
      flashInstallComplete(data.total);
    }
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateToast(nw);
        }
      });
    });
  }).catch(() => {});
}

function showInstallProgress(done, total) {
  const wrap = $("install-progress");
  if (!wrap) return;
  // If everything's already cached when the first progress message arrives,
  // there's nothing to actually download — don't flash the bar. This is the
  // "I just re-opened the app" case after the SW updated the shell.
  if (done >= total && wrap.hidden) return;
  wrap.hidden = false;
  const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
  $("ip-fill").style.width = `${pct}%`;
  $("ip-label").textContent = `Downloading for offline play — ${done}/${total} (${pct}%)`;
}
function flashInstallComplete(total) {
  const wrap = $("install-progress");
  if (!wrap || wrap.hidden) return;   // we never showed the bar; skip the toast
  $("ip-fill").style.width = "100%";
  $("ip-label").textContent = `Ready for offline play (${total} players cached)`;
  setTimeout(() => { wrap.hidden = true; }, 2500);
}
function hideInstallProgress() {
  const el = $("install-progress");
  if (el) el.hidden = true;
}

function showUpdateToast(worker) {
  const t = $("update-toast");
  if (!t) return;
  t.hidden = false;
  const btn = $("update-toast-btn");
  btn.onclick = () => {
    worker.postMessage({ type: "skip-waiting" });
    setTimeout(() => location.reload(), 200);
  };
  $("update-toast-dismiss").onclick = () => { t.hidden = true; };
}

function maybeShowIosInstallBanner() {
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!isIos || standalone) return;
  if (localStorage.getItem("bg.iosBannerDismissed") === "1") return;
  const el = $("ios-install-banner");
  if (!el) return;
  el.hidden = false;
  $("ios-install-dismiss").onclick = () => {
    el.hidden = true;
    localStorage.setItem("bg.iosBannerDismissed", "1");
  };
}

function setupOnlineOfflineUI() {
  const pill = $("offline-pill");
  const apply = () => {
    if (!pill) return;
    pill.hidden = navigator.onLine;
    if (navigator.onLine) flushPostQueue();
  };
  window.addEventListener("online", apply);
  window.addEventListener("offline", apply);
  apply();
}

async function maybeNuke() {
  const params = new URLSearchParams(location.search);
  if (params.get("nuke") !== "1") return false;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ("caches" in window) {
      const names = await caches.keys();
      for (const n of names) await caches.delete(n);
    }
    localStorage.clear();
  } catch {}
  // Strip ?nuke=1 and reload
  const url = new URL(location.href);
  url.searchParams.delete("nuke");
  location.replace(url.toString());
  return true;
}

async function init() {
  if (await maybeNuke()) return;
  registerServiceWorker();
  setupOnlineOfflineUI();
  maybeShowIosInstallBanner();
  try {
    const res = await fetch("data/manifest.json");
    state.manifest = await res.json();
  } catch (e) {
    setFeedback("Couldn't load player list. Refresh to try again.", "bad");
    return;
  }
  // Safety: if the tier in localStorage doesn't match any current tier key, reset
  if (!state.manifest[state.tier]) state.tier = "well_known";
  $("tier").value = state.tier;
  $("era").value  = state.era;
  $("pos").value  = state.pos;
  $("team").value = state.team;
  $("tier").addEventListener("change", onTierChange);
  $("era").addEventListener("change", onEraChange);
  $("pos").addEventListener("change", onPosChange);
  $("team").addEventListener("change", onTeamChange);
  $("guess-form").addEventListener("submit", submitGuess);
  $("hint-btn").addEventListener("click", revealHint);
  $("giveup-btn").addEventListener("click", giveUp);
  $("next-btn").addEventListener("click", newRound);
  $("leaderboard-btn").addEventListener("click", showLeaderboardModal);
  $("leaderboard-close").addEventListener("click", hideLeaderboardModal);
  $("achievement-close")?.addEventListener("click", closeAchievementModal);

  // Tapping the dim area outside a modal card closes the modal — match the
  // iOS convention everyone expects.
  for (const m of document.querySelectorAll(".modal")) {
    m.addEventListener("click", (e) => {
      if (e.target === m) m.hidden = true;
    });
  }
  // The "open achievements" button lives inside the dynamically-rendered stats
  // card and is re-created on every load — use event delegation so the handler
  // survives re-renders.
  $("leaderboard-modal")?.addEventListener("click", (e) => {
    if (e.target.closest("#open-achievements")) openAchievementModal();
  });
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
