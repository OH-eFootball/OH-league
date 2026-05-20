const STORAGE_KEY = "oh-league-state-v1";
const GROUPS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
const OFFICIAL_SEASON_START_DATE = "2026-05-18";
const STREAK_REWARDS = [
  { threshold: 3, bonus: 1 },
  { threshold: 5, bonus: 2 },
  { threshold: 10, bonus: 3 }
];

const config = window.OH_LEAGUE_SUPABASE || null;
const adminPassword = config?.adminPassword || "admin";
const supabaseClient = config?.url && config?.anonKey && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;
const rowId = config?.rowId || "main";

let state = null;
let currentRoute = location.hash.replace("#", "") || "home";
let selectedGroup = "全部";
let adminAuthed = sessionStorage.getItem("oh-league-admin") === "yes";
let selectedPlayerId = null;
let playerReturnRoute = "leaderboard";
let selectedAdminPlayerId = null;
let h2hPair = null;
let selectedSubmitGroup = null;
let selectedAdminMatchWeek = "全部";
let selectedAdminMatchPlayerId = "全部";
let startupError = "";
let lastLoadedUpdatedAt = null;

const app = document.querySelector("#app");

init();

async function init() {
  bindTopNav();
  try {
    await loadState();
  } catch (error) {
    startupError = error?.message || "加载失败";
    console.error(error);
    state = normalizeState(createInitialState());
  }
  render();
}

function bindTopNav() {
  document.querySelectorAll("[data-route]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(item.dataset.route);
    });
  });
  window.addEventListener("hashchange", () => {
    currentRoute = location.hash.replace("#", "") || "home";
    render();
  });
}

function navigate(route) {
  currentRoute = route;
  location.hash = route;
  render();
}

function navigateToPlayer(playerId, sourceRoute = currentRoute) {
  selectedPlayerId = Number(playerId);
  if (sourceRoute && sourceRoute !== `player:${selectedPlayerId}`) {
    playerReturnRoute = sourceRoute;
  }
  currentRoute = `player:${selectedPlayerId}`;
  location.hash = currentRoute;
  render();
}

async function loadState() {
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from("league_state").select("data,updated_at").eq("id", rowId).maybeSingle();
    if (error) throw new Error(`数据库读取失败：${error.message}`);
    if (data?.data) {
      state = normalizeState(data.data);
      lastLoadedUpdatedAt = data.updated_at || null;
    } else {
      state = createInitialState();
      seedIfEmpty();
      await saveState();
    }
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = normalizeState(raw ? JSON.parse(raw) : createInitialState());
    seedIfEmpty();
    await saveState();
  }
  recompute();
}

async function saveState() {
  if (!state) return;
  const payload = JSON.parse(JSON.stringify(state));
  if (supabaseClient) {
    const nextUpdatedAt = new Date().toISOString();
    if (lastLoadedUpdatedAt) {
      const { data, error } = await supabaseClient
        .from("league_state")
        .update({ data: payload, updated_at: nextUpdatedAt })
        .eq("id", rowId)
        .eq("updated_at", lastLoadedUpdatedAt)
        .select("updated_at")
        .maybeSingle();
      if (error) throw new Error(`数据库保存失败：${error.message}`);
      if (!data) throw new Error("数据已被其他人更新，请刷新后重试。");
      lastLoadedUpdatedAt = data.updated_at || nextUpdatedAt;
    } else {
      const { data, error } = await supabaseClient
        .from("league_state")
        .upsert({ id: rowId, data: payload, updated_at: nextUpdatedAt })
        .select("updated_at")
        .maybeSingle();
      if (error) throw new Error(`数据库保存失败：${error.message}`);
      lastLoadedUpdatedAt = data?.updated_at || nextUpdatedAt;
    }
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

function createInitialState() {
  return {
    meta: {
      kitMeta: "英超队套",
      scoringMeta: {
        name: "常规周",
        drawExtra: 0,
        kitBonusMultiplier: 1,
        streakBonusMultiplier: 1,
        groupBonus: { enabled: false, group: "甲", points: 0 }
      }
    },
    players: [],
    matches: [],
    settlements: [],
    champions: [],
    groupHistory: [],
    simulationDate: new Date().toISOString().slice(0, 10),
    seasonStartDate: OFFICIAL_SEASON_START_DATE,
    metaHistory: []
  };
}

function normalizeState(data) {
  const initial = createInitialState();
  return {
    ...initial,
    ...data,
    meta: {
      ...initial.meta,
      ...(data.meta || {}),
      scoringMeta: {
        ...initial.meta.scoringMeta,
        ...(data.meta?.scoringMeta || {}),
        groupBonus: {
          ...initial.meta.scoringMeta.groupBonus,
          ...(data.meta?.scoringMeta?.groupBonus || {})
        }
      }
    },
    players: Array.isArray(data.players) ? data.players.map((player) => ({ inactive: false, ...player })) : [],
    matches: Array.isArray(data.matches) ? data.matches : [],
    settlements: Array.isArray(data.settlements) ? data.settlements : [],
    champions: Array.isArray(data.champions) ? data.champions : [],
    groupHistory: Array.isArray(data.groupHistory) ? data.groupHistory : [],
    simulationDate: data.simulationDate || new Date().toISOString().slice(0, 10),
    seasonStartDate: data.seasonStartDate || OFFICIAL_SEASON_START_DATE,
    metaHistory: Array.isArray(data.metaHistory) ? data.metaHistory : []
  };
}

function seedIfEmpty() {
  if (state.players.length > 0) return;
  ["张三", "李四", "王五", "赵六", "英超队套王", "红魔队长"].forEach((name, index) => {
    state.players.push(makePlayer(index + 1, name));
  });
  forceRegroup(false);
}

function makePlayer(id, name) {
  return {
    id,
    name,
    manualAdjustment: 0,
    totalPoints: 0,
    group: "甲",
    weekRecord: "0-0-0",
    streak: 0,
    wins: 0,
    matches: 0,
    highestGroup: "甲",
    inactive: false,
    createdAt: new Date().toISOString()
  };
}

function recompute() {
  const playerMap = new Map(state.players.map((player) => [player.id, player]));
  for (const player of state.players) {
    player.totalPoints = Number(player.manualAdjustment || 0);
    player.weekRecord = "0-0-0";
    player.streak = 0;
    player.wins = 0;
    player.matches = 0;
  }

  const pairWeekCounts = new Map();
  const playerWeekCounts = new Map();
  const streaks = new Map();
  const claimed = new Set();
  const sortedMatches = [...state.matches].sort((a, b) => {
    const diff = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
    return diff || Number(a.id) - Number(b.id);
  });

  for (const match of sortedMatches) {
    const a = playerMap.get(Number(match.playerAId));
    const b = playerMap.get(Number(match.playerBId));
    if (!a || !b) continue;

    const matchWeek = weekKey(match.playedAt);
    const aGroup = match.playerAGroup || a.group;
    const bGroup = match.playerBGroup || b.group;
    const pairKey = [a.id, b.id].sort((x, y) => x - y).join(":") + ":" + matchWeek;
    const usedCount = pairWeekCounts.get(pairKey) || 0;
    const aWeekKey = `${a.id}:${matchWeek}`;
    const bWeekKey = `${b.id}:${matchWeek}`;
    const aWeekCount = playerWeekCounts.get(aWeekKey) || 0;
    const bWeekCount = playerWeekCounts.get(bWeekKey) || 0;

    match.weekKey = matchWeek;
    match.valid = true;
    match.invalidReason = "";
    match.pointsA = 0;
    match.pointsB = 0;
    match.streakBonusA = 0;
    match.streakBonusB = 0;
    match.pointPartsA = [];
    match.pointPartsB = [];

    if (!isUngroupedWeek(match.playedAt) && aGroup !== bGroup) {
      match.valid = false;
      match.invalidReason = "跨组比赛无效";
    } else if (usedCount >= 2) {
      match.valid = false;
      match.invalidReason = "同两名玩家每周最多 2 场有效比赛";
    } else if (isFirstWeek(match.playedAt) && (aWeekCount >= 20 || bWeekCount >= 20)) {
      match.valid = false;
      match.invalidReason = "首周每人最多 20 场有效比赛";
    }

    if (!match.valid) continue;

    pairWeekCounts.set(pairKey, usedCount + 1);
    playerWeekCounts.set(aWeekKey, aWeekCount + 1);
    playerWeekCounts.set(bWeekKey, bWeekCount + 1);
    const matchMeta = getMatchMeta(match);
    scoreBase(match, aGroup, matchMeta);
    applyStreakBonus(match, a, match.result === "A_WIN", "A", claimed, streaks, matchMeta, matchWeek);
    applyStreakBonus(match, b, match.result === "B_WIN", "B", claimed, streaks, matchMeta, matchWeek);
    applyPlayerStats(a, match.pointsA, match.result === "A_WIN", match.result === "DRAW", matchWeek);
    applyPlayerStats(b, match.pointsB, match.result === "B_WIN", match.result === "DRAW", matchWeek);
  }

  for (const settlement of state.settlements) {
    const player = playerMap.get(Number(settlement.playerId));
    if (player) player.totalPoints -= Number(settlement.penalty || 0);
  }

  refreshHighestGroups();
  crownChampion();
}

function scoreBase(match, group, scoring) {
  const baseA = match.result === "A_WIN" ? 3 : match.result === "DRAW" ? 1 : 0;
  const baseB = match.result === "B_WIN" ? 3 : match.result === "DRAW" ? 1 : 0;
  addPointPart(match, "A", { type: "base", value: baseA });
  addPointPart(match, "B", { type: "base", value: baseB });
  if (match.result === "DRAW") {
    const drawExtra = Number(scoring.drawExtra || 0);
    if (drawExtra > 0) {
      addPointPart(match, "A", { type: "meta", value: drawExtra });
      addPointPart(match, "B", { type: "meta", value: drawExtra });
    }
  }

  const kitMultiplier = Number(scoring.kitBonusMultiplier || 1);
  const metaUsers = getMatchMetaUsers(match);
  if (metaUsers.includes(Number(match.playerAId)) && match.result !== "B_WIN") addPointPart(match, "A", { type: "kit", value: 1, multiplier: kitMultiplier });
  if (metaUsers.includes(Number(match.playerBId)) && match.result !== "A_WIN") addPointPart(match, "B", { type: "kit", value: 1, multiplier: kitMultiplier });

  if (scoring.groupBonus?.enabled && scoring.groupBonus.group === group) {
    const groupPoints = Number(scoring.groupBonus.points || 0);
    if (groupPoints > 0) {
      addPointPart(match, "A", { type: "meta", value: groupPoints });
      addPointPart(match, "B", { type: "meta", value: groupPoints });
    }
  }
}

function addPointPart(match, side, part) {
  const multiplier = Number(part.multiplier || 1);
  const amount = Number(part.value || 0) * multiplier;
  const normalized = { ...part, multiplier, amount };
  if (side === "A") {
    match.pointPartsA.push(normalized);
    match.pointsA += amount;
  } else {
    match.pointPartsB.push(normalized);
    match.pointsB += amount;
  }
}

function getMatchMeta(match) {
  const matchWeek = weekKey(match.playedAt);
  if (matchWeek === currentWeekKey() && !isWeekSettled(matchWeek)) {
    return normalizeScoringMeta(state.meta.scoringMeta);
  }
  return normalizeScoringMeta(match.scoringMetaSnapshot || state.meta.scoringMeta);
}

function normalizeScoringMeta(meta = {}) {
  return {
    name: meta.name || "常规周",
    drawExtra: Number(meta.drawExtra || 0),
    kitBonusMultiplier: Math.max(1, Number(meta.kitBonusMultiplier || 1)),
    streakBonusMultiplier: Math.max(1, Number(meta.streakBonusMultiplier || 1)),
    groupBonus: {
      enabled: Boolean(meta.groupBonus?.enabled),
      group: meta.groupBonus?.group || "甲",
      points: Number(meta.groupBonus?.points || 0)
    }
  };
}

function snapshotCurrentScoringMeta() {
  return JSON.parse(JSON.stringify(normalizeScoringMeta(state.meta.scoringMeta)));
}

function freezeMissingMetaSnapshots() {
  const snapshot = snapshotCurrentScoringMeta();
  for (const match of state.matches) {
    if (!match.scoringMetaSnapshot) {
      match.scoringMetaSnapshot = JSON.parse(JSON.stringify(snapshot));
    }
  }
}

function freezeWeekMetaSnapshots(targetWeek, meta = state.meta.scoringMeta, overwrite = false) {
  const snapshot = JSON.parse(JSON.stringify(normalizeScoringMeta(meta)));
  for (const match of state.matches) {
    if (weekKey(match.playedAt) === targetWeek && (overwrite || !match.scoringMetaSnapshot)) {
      match.scoringMetaSnapshot = JSON.parse(JSON.stringify(snapshot));
    }
  }
}

function applyStreakBonus(match, player, won, side, claimed, streaks, scoring, matchWeek) {
  const streakKey = `${player.id}:${matchWeek}`;
  const next = won ? Number(streaks.get(streakKey) || 0) + 1 : 0;
  streaks.set(streakKey, next);
  if (matchWeek === currentWeekKey()) player.streak = next;
  if (!won) return;

  for (const reward of STREAK_REWARDS) {
    const claimKey = `${player.id}:${match.weekKey}:${reward.threshold}`;
    if (next >= reward.threshold && !claimed.has(claimKey)) {
      const bonus = reward.bonus * Number(scoring.streakBonusMultiplier || 1);
      if (side === "A") {
        match.streakBonusA += bonus;
      } else {
        match.streakBonusB += bonus;
      }
      addPointPart(match, side, { type: "streak", value: reward.bonus, multiplier: Number(scoring.streakBonusMultiplier || 1) });
      claimed.add(claimKey);
    }
  }
}

function applyPlayerStats(player, points, won, draw, matchWeek) {
  if (matchWeek === currentWeekKey()) {
    const record = player.weekRecord.split("-").map(Number);
    if (won) record[0] += 1;
    else if (draw) record[1] += 1;
    else record[2] += 1;
    player.weekRecord = record.join("-");
  }
  player.totalPoints += Number(points || 0);
  player.wins += won ? 1 : 0;
  player.matches += 1;
}

function rankedPlayers() {
  const players = activePlayers();
  const baseRankMap = new Map();
  [...players]
    .sort(comparePlayersBase)
    .forEach((player, index) => baseRankMap.set(player.id, index + 1));
  return [...players]
    .sort((a, b) => comparePlayers(a, b, baseRankMap))
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

function comparePlayers(a, b, baseRankMap = new Map()) {
  const base = comparePlayersBase(a, b);
  if (base !== 0) return base;
  const aOpp = opponentAverageRank(a.id, baseRankMap);
  const bOpp = opponentAverageRank(b.id, baseRankMap);
  if (aOpp !== bOpp) return aOpp - bOpp;
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

function comparePlayersBase(a, b) {
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  if (a.matches !== b.matches) return a.matches - b.matches;
  if (b.wins !== a.wins) return b.wins - a.wins;
  const aBase = playerBasePoints(a.id);
  const bBase = playerBasePoints(b.id);
  if (bBase !== aBase) return bBase - aBase;
  const aKit = kitMatchCount(a.id);
  const bKit = kitMatchCount(b.id);
  if (bKit !== aKit) return bKit - aKit;
  const h2h = headToHeadScore(a.id, b.id);
  if (h2h !== 0) return -h2h;
  return 0;
}

function headToHeadScore(aId, bId) {
  return state.matches.reduce((score, match) => {
    if (!match.valid) return score;
    const involves = [Number(match.playerAId), Number(match.playerBId)];
    if (!involves.includes(Number(aId)) || !involves.includes(Number(bId))) return score;
    if (match.result === "DRAW") return score;
    const winner = match.result === "A_WIN" ? Number(match.playerAId) : Number(match.playerBId);
    return score + (winner === Number(aId) ? 1 : -1);
  }, 0);
}

function opponentAverageRank(playerId, rankMap) {
  const opponentIds = state.matches
    .filter((match) => match.valid && (Number(match.playerAId) === Number(playerId) || Number(match.playerBId) === Number(playerId)))
    .map((match) => Number(match.playerAId) === Number(playerId) ? Number(match.playerBId) : Number(match.playerAId))
    .filter((id, index, ids) => ids.indexOf(id) === index);
  if (!opponentIds.length) return Number.POSITIVE_INFINITY;
  const total = opponentIds.reduce((sum, id) => sum + (rankMap.get(id) || activePlayers().length + 1), 0);
  return total / opponentIds.length;
}

function activePlayers() {
  return state.players.filter((player) => !player.inactive);
}

function forceRegroup(shouldSave = true, historyWeek = null) {
  const ranked = rankedPlayers();
  const openedGroups = openGroups(ranked.length);
  if (historyWeek) {
    state.groupHistory = state.groupHistory.filter((item) => item.weekKey !== historyWeek);
  }
  ranked.forEach((player, index) => {
    const target = state.players.find((item) => item.id === player.id);
    const group = openedGroups[Math.min(Math.floor(index / 10), openedGroups.length - 1)];
    target.group = group;
    target.highestGroup = betterGroup(group, target.highestGroup || group);
    if (historyWeek) {
      state.groupHistory.push({
        id: nextId(state.groupHistory),
        playerId: target.id,
        weekKey: historyWeek,
        group,
        rank: index + 1,
        createdAt: new Date().toISOString()
      });
    }
  });
  if (shouldSave) persistAndRender("已重新分组");
}

function openGroups(totalPlayers = activePlayers().length) {
  const count = Math.max(1, Math.min(GROUPS.length, Math.floor(totalPlayers / 10) || 1));
  return GROUPS.slice(0, count);
}

function settleWeek(targetWeek = settlementTargetWeek(), shouldPersist = true) {
  freezeWeekMetaSnapshots(targetWeek, state.meta.scoringMeta, targetWeek === currentWeekKey() && !isWeekSettled(targetWeek));
  for (const player of activePlayers()) {
    const validMatches = state.matches.filter((match) => (
      match.valid &&
      weekKey(match.playedAt) === targetWeek &&
      (Number(match.playerAId) === player.id || Number(match.playerBId) === player.id)
    )).length;
    const penalty = Math.max(0, 5 - validMatches);
    state.settlements = state.settlements.filter((item) => !(item.playerId === player.id && item.weekKey === targetWeek));
    state.settlements.push({
      id: nextId(state.settlements),
      playerId: player.id,
      weekKey: targetWeek,
      validMatches,
      penalty,
      settledAt: new Date().toISOString(),
      effectiveAt: settlementEffectiveTime(targetWeek).toISOString()
    });
  }
  recompute();
  forceRegroup(false, targetWeek);
  if (shouldPersist) persistAndRender(`已结算第 ${weekNumber(targetWeek)} 周：活跃度扣分与分组已更新`);
}

function settlementTargetWeek() {
  const currentWeek = currentWeekKey();
  const hasCurrentWeekMatches = state.matches.some((match) => weekKey(match.playedAt) === currentWeek);
  return hasCurrentWeekMatches ? currentWeek : previousWeekKey(currentWeek);
}

function isWeekSettled(targetWeek) {
  return state.settlements.some((item) => item.weekKey === targetWeek);
}

function refreshHighestGroups() {
  const settledWeeks = new Set(state.settlements.map((item) => item.weekKey));
  for (const player of state.players) {
    const groups = state.groupHistory.filter((item) => item.playerId === player.id && settledWeeks.has(item.weekKey)).map((item) => item.group);
    player.highestGroup = groups.reduce((best, group) => betterGroup(group, best), player.highestGroup || player.group);
  }
}

function betterGroup(a, b) {
  return GROUPS.indexOf(a) <= GROUPS.indexOf(b) ? a : b;
}

function crownChampion() {
  if (state.champions.length > 0) return;
  const champion = rankedPlayers().find((player) => player.totalPoints >= 300);
  if (!champion) return;
  state.champions.push({
    id: nextId(state.champions),
    playerId: champion.id,
    name: champion.name,
    points: champion.totalPoints,
    crownedAt: new Date().toISOString()
  });
}

function render() {
  recompute();
  document.querySelectorAll("[data-route]").forEach((item) => {
    item.classList.toggle("active", item.dataset.route === currentRoute);
  });

  if (currentRoute.startsWith("player:")) {
    selectedPlayerId = Number(currentRoute.split(":")[1]);
    h2hPair = null;
    app.innerHTML = renderPlayerDetail();
  } else if (currentRoute === "leaderboard") {
    app.innerHTML = renderLeaderboard();
  } else if (currentRoute === "submit") {
    app.innerHTML = renderSubmit();
  } else if (currentRoute === "admin") {
    app.innerHTML = renderAdmin();
  } else {
    app.innerHTML = renderHome();
  }
  bindPageEvents();
}

function renderStartupWarning() {
  if (!startupError) return "";
  return `
    <section class="panel gold-panel">
      <h2>在线数据加载失败</h2>
      <p class="muted">网页已经打开，但没有成功连接 Supabase，所以当前显示的不是多人共享数据。</p>
      <p class="red-text tiny">${escapeHtml(startupError)}</p>
    </section>
  `;
}

function renderHome() {
  const honors = homeHonors();
  const week = currentWeekInfo();
  return `
    ${renderStartupWarning()}
    <section class="hero">
      <div class="hero-main">
        <div>
          <h1 class="home-title"><span class="gradient-title">使用说明</span></h1>
          <div class="home-rules">
            <details class="rule-fold">
              <summary>展开详情</summary>
              <p class="muted">提交战报，系统完成自动计分、连胜奖励、Meta 加成、排行榜、每周结算和自动分组。</p>
              <p class="muted">同组别内自由约战，每周结算后按总积分自动分为甲乙丙丁等组。</p>
              <p class="muted">胜 +3，平 +1，负 +0；使用本周 Meta 队套胜/平额外加 1 分，负不加分。</p>
              <p class="muted">同两名玩家每周最多 2 场有效比赛；每人每周至少 5 场有效比赛，少 1 场扣 1 分。</p>
              <p class="muted">三/五/十连胜每周分别触发一次额外加分；Meta 计分规则也可以额外加分。</p>
            </details>
          </div>
        </div>
        <div class="hero-actions">
          <button class="primary-button" data-go="submit">提交战报</button>
          <button class="ghost-button" data-go="leaderboard">查看排行榜</button>
        </div>
      </div>
      <aside class="hero-side">
        <div class="panel gold-panel">
          <div class="meta-panel-title">本周 Meta</div>
          <div class="meta-title-list">
            <p class="meta-title gold-text">${escapeHtml(state.meta.kitMeta)}</p>
            <p class="meta-title blue">${escapeHtml(state.meta.scoringMeta.name)}</p>
          </div>
          ${shouldShowMetaFacts() ? renderMetaFacts() : ""}
        </div>
        <div class="stat-grid">
          ${statCard("参赛玩家", activePlayers().length)}
          ${statCard("当前周", `<span class="week-value">第 ${week.number} 周 <span class="week-date">${week.countdown}</span></span>`, "gold", false)}
        </div>
        <div class="panel">
          <h3>荣誉榜</h3>
          ${renderHonorLine("最高总分", honors.highestPoints)}
          ${renderHonorLine("场均最高分", honors.highestAverage)}
          ${renderHonorLine("队套使用最多", honors.highestKit)}
          ${renderHonorLine("最高连胜", honors.highestStreak)}
          ${state.champions.length ? state.champions.map((item) => `<p><span class="pill gold">总冠军</span> <b>${playerLink(item.playerId, item.name, "inline-link gold-text")}</b> · ${item.points} 分</p>`).join("") : `<p class="muted tiny">首位 300 分总冠军等待诞生。</p>`}
        </div>
      </aside>
    </section>
  `;
}

function shouldShowMetaFacts() {
  const meta = state.meta.scoringMeta;
  return (
    Number(meta.drawExtra || 0) > 0 ||
    Number(meta.kitBonusMultiplier || 1) !== 1 ||
    Number(meta.streakBonusMultiplier || 1) !== 1 ||
    Boolean(meta.groupBonus?.enabled)
  );
}

function currentWeekInfo() {
  const now = currentSimulationDate();
  return { number: weekNumber(now), countdown: settlementCountdown(now) };
}

function weekNumber(dateInput = new Date()) {
  const start = new Date(`${state.seasonStartDate || weekKey(dateInput)}T00:00:00`);
  const current = new Date(`${weekKey(dateInput)}T00:00:00`);
  return Math.max(0, Math.floor((current - start) / (7 * 86400000)) + 1);
}

function settlementCountdown(now = new Date()) {
  const nextMonday = new Date(now);
  const day = nextMonday.getDay() || 7;
  const daysUntilMonday = 8 - day;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  const diff = Math.max(0, nextMonday.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `结算倒计时 ${days}天${hours}小时`;
}

function homeHonors() {
  const ranked = rankedPlayers();
  const highestPoints = ranked[0]
    ? { playerId: ranked[0].id, name: ranked[0].name, value: `${ranked[0].totalPoints} 分` }
    : null;
  const highestAveragePlayer = ranked
    .filter((player) => player.matches > 0)
    .sort((a, b) => (b.totalPoints / b.matches) - (a.totalPoints / a.matches))[0];
  const highestAverage = highestAveragePlayer
    ? { playerId: highestAveragePlayer.id, name: highestAveragePlayer.name, value: `${(highestAveragePlayer.totalPoints / highestAveragePlayer.matches).toFixed(2)} 分/场` }
    : null;
  const kitScores = kitScoreboard();
  const highestKit = kitScores[0]
    ? { playerId: kitScores[0].playerId, name: playerName(kitScores[0].playerId), value: `${kitScores[0].count} 场` }
    : null;
  const streaks = maxStreakScoreboard();
  const highestStreak = streaks[0]
    ? { playerId: streaks[0].playerId, name: playerName(streaks[0].playerId), value: `${streaks[0].streak} 连胜` }
    : null;
  return { highestPoints, highestAverage, highestKit, highestStreak };
}

function renderHonorLine(label, item) {
  if (!item) return `<p><span class="pill">${escapeHtml(label)}</span> <span class="muted">暂无数据</span></p>`;
  return `<p><span class="pill">${escapeHtml(label)}</span> <b>${playerLink(item.playerId, item.name, "inline-link gold-text")}</b> · ${escapeHtml(item.value)}</p>`;
}

function kitScoreboard() {
  const scores = new Map();
  for (const match of state.matches) {
    if (!match.valid) continue;
    for (const metaUserId of getMatchMetaUsers(match)) {
      scores.set(metaUserId, Number(scores.get(metaUserId) || 0) + 1);
    }
  }
  return [...scores.entries()]
    .map(([playerId, count]) => ({ playerId, count }))
    .filter((item) => !state.players.find((player) => player.id === Number(item.playerId))?.inactive)
    .sort((a, b) => b.count - a.count);
}

function maxStreakScoreboard() {
  const streaks = new Map();
  const maxes = new Map();
  const matches = [...state.matches]
    .filter((match) => match.valid)
    .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime() || Number(a.id) - Number(b.id));

  for (const match of matches) {
    for (const [playerId, won] of [
      [Number(match.playerAId), match.result === "A_WIN"],
      [Number(match.playerBId), match.result === "B_WIN"]
    ]) {
      const streakKey = `${playerId}:${weekKey(match.playedAt)}`;
      const next = won ? Number(streaks.get(streakKey) || 0) + 1 : 0;
      streaks.set(streakKey, next);
      maxes.set(playerId, Math.max(Number(maxes.get(playerId) || 0), next));
    }
  }

  return [...maxes.entries()]
    .map(([playerId, streak]) => ({ playerId, streak }))
    .filter((item) => item.streak > 0 && !state.players.find((player) => player.id === Number(item.playerId))?.inactive)
    .sort((a, b) => b.streak - a.streak);
}

function renderLeaderboard() {
  const ranked = rankedPlayers();
  const openedGroups = openGroups(ranked.length);
  if (selectedGroup !== "全部" && !openedGroups.includes(selectedGroup)) selectedGroup = "全部";
  const rows = selectedGroup === "全部" ? ranked : ranked.filter((player) => player.group === selectedGroup);
  const title = selectedGroup === "全部" ? "全体积分榜" : `${selectedGroup}组积分榜`;
  return `
    <section class="panel">
      <div class="eyebrow">Leaderboard</div>
      <h1 class="section-title gradient-title">${title}</h1>
      <div class="filter-bar">
        ${["全部", ...openedGroups].map((group) => `<button class="${selectedGroup === group ? "active" : ""}" data-filter-group="${group}">${group}</button>`).join("")}
      </div>
      ${renderPlayerTable(rows)}
    </section>
  `;
}

function renderSubmit() {
  const firstWeek = isUngroupedWeek();
  const groups = groupsWithPlayers();
  if (!selectedSubmitGroup || !groups.includes(selectedSubmitGroup)) selectedSubmitGroup = groups[0] || "甲";
  const availablePlayers = firstWeek ? activePlayers() : activePlayers().filter((player) => player.group === selectedSubmitGroup);
  return `
    <section class="panel">
      <div class="eyebrow">Match Report</div>
      <h1 class="section-title gradient-title">提交战报</h1>
      <form id="match-form">
        <div class="form-grid">
          ${firstWeek ? `<div class="panel tiny">首周不分组，所有玩家均可自由约战。</div>` : selectField("比赛组别", "matchGroup", groups.map((group) => `<option value="${group}" ${selectedSubmitGroup === group ? "selected" : ""}>${group}组</option>`).join(""), true)}
          ${selectField("玩家 A", "playerAId", playerOptions(firstWeek ? null : selectedSubmitGroup), true)}
          ${selectField("玩家 B", "playerBId", playerOptions(firstWeek ? null : selectedSubmitGroup), true)}
          ${selectField("比赛结果", "result", `
            <option value="A_WIN">A 胜</option>
            <option value="DRAW">平局</option>
            <option value="B_WIN">B 胜</option>
          `, true)}
          ${selectField("Meta 队套使用情况", "metaUsage", `
            <option value="none">无人使用</option>
            <option value="A">A 玩家</option>
            <option value="B">B 玩家</option>
            <option value="both">A 和 B 玩家</option>
          `, true)}
          <div class="panel tiny">系统会在点击提交时记录当前真实时间。</div>
        </div>
        <div id="group-hint" class="panel tiny">${availablePlayers.length < 2 ? "可选玩家不足 2 人，无法提交比赛。" : ""}</div>
        <div class="button-row">
          <button class="primary-button" type="submit">提交战报</button>
          <button class="ghost-button" type="button" data-go="leaderboard">看排行榜</button>
        </div>
      </form>
    </section>
  `;
}

function renderPlayerDetail() {
  const player = state.players.find((item) => item.id === selectedPlayerId);
  if (!player) return `<section class="panel"><p class="empty">找不到这个玩家。</p></section>`;
  const backRoute = playerReturnRoute || "leaderboard";
  const extraStats = playerExtraBreakdown(player.id);
  const maxStreak = playerMaxWeeklyStreak(player.id);
  const matches = state.matches
    .filter((match) => Number(match.playerAId) === player.id || Number(match.playerBId) === player.id)
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
  const pointTimeline = playerPointTimeline(player.id);
  const settledWeeks = new Set(state.settlements.map((item) => item.weekKey));
  const history = state.groupHistory
    .filter((item) => item.playerId === player.id && settledWeeks.has(item.weekKey))
    .reduce((map, item) => map.set(item.weekKey, item), new Map());
  const weeklyHistory = [...history.values()]
    .sort((a, b) => new Date(b.weekKey) - new Date(a.weekKey))
    .slice(0, 16);

  return `
    <section class="panel">
      <button class="ghost-button" data-go="${escapeAttr(backRoute)}">返回</button>
      <div class="eyebrow">Player Profile</div>
      <h1 class="section-title gradient-title">${escapeHtml(player.name)}</h1>
      <div class="profile-stat-sections">
        <div class="profile-stat-group">
          <h3>积分与组别</h3>
          <div class="profile-stat-grid">
            ${statCard("总积分", player.totalPoints)}
            ${statCard("当前组别", displayPlayerGroup(player), "blue")}
            ${statCard("历史最高组", displayHighestGroup(player), "gold")}
          </div>
        </div>
        <div class="profile-stat-group">
          <h3>战绩表现</h3>
          <div class="profile-stat-grid">
            ${statCard("周战绩", player.weekRecord)}
            ${statCard("总战绩", totalRecord(player.id))}
            ${statCard("当前连胜", `${player.streak}连胜`, "red")}
            ${statCard("最高连胜", `${maxStreak}连胜`, "gold")}
          </div>
        </div>
        <div class="profile-stat-group">
          <h3>队套与额外加分</h3>
          <div class="profile-stat-grid">
            ${statCard("队套使用数", `${kitMatchCount(player.id)}场`, "blue")}
            ${statCard("队套加分", `+${extraStats.kit}`, "blue")}
            ${statCard("连胜奖励", `+${extraStats.streak}`, "gold")}
            ${statCard("Meta计分", `+${extraStats.meta}`, "gold")}
          </div>
        </div>
      </div>
    </section>
    <section class="two-grid profile-detail-grid">
      <div class="panel">
        <h2>历史成绩</h2>
        <div class="profile-history-list">${weeklyHistory.length ? weeklyHistory.map(renderGroupHistoryLine).join("") : `<p class="muted">暂无结算成绩</p>`}</div>
      </div>
      <div class="panel">
        <h2>得分记录</h2>
        <div class="match-list profile-timeline-list">${pointTimeline.length ? pointTimeline.map(renderPointTimelineCard).join("") : `<div class="empty">暂无有效比赛</div>`}</div>
      </div>
    </section>
  `;
}

function renderAdmin() {
  if (!adminAuthed) {
    return `
      <section class="panel admin-lock">
        <div class="eyebrow">Admin</div>
        <h1 class="section-title gradient-title">管理员后台</h1>
        <p class="muted">玩家无需使用后台，仅管理员能进入。</p>
        <form id="admin-login">
          ${inputField("后台密码", "password", "password", "")}
          <div class="button-row">
            <button class="primary-button" type="submit">进入后台</button>
          </div>
        </form>
      </section>
    `;
  }

  const invalidMatches = state.matches.filter((match) => !match.valid).slice().reverse();
  const matchWeeks = adminMatchWeeks();
  if (selectedAdminMatchWeek !== "全部" && !matchWeeks.includes(selectedAdminMatchWeek)) selectedAdminMatchWeek = "全部";
  if (selectedAdminMatchPlayerId !== "全部" && !state.players.some((player) => player.id === Number(selectedAdminMatchPlayerId))) selectedAdminMatchPlayerId = "全部";
  const visibleMatches = adminVisibleMatches();
  if (!selectedAdminPlayerId && state.players.length) selectedAdminPlayerId = state.players[0].id;
  const selectedAdminPlayer = state.players.find((player) => player.id === Number(selectedAdminPlayerId)) || state.players[0];
  return `
    <section class="panel">
      <div class="eyebrow">Admin Console</div>
      <h1 class="section-title gradient-title">管理员后台</h1>
      <div class="button-row">
        <button class="ghost-button" data-admin-action="settle">模拟周结算</button>
        <button class="ghost-button" data-admin-action="next-week">进入下一周</button>
        <button class="ghost-button" data-admin-action="seed">补充测试玩家</button>
        <button class="ghost-button" data-admin-action="random-matches">录入随机战报</button>
        <button class="ghost-button" data-admin-action="export-backup">导出数据备份</button>
        <button class="danger-button" data-admin-action="reset-board">一键重置积分榜</button>
        <button class="danger-button" data-admin-action="logout">退出后台</button>
      </div>
    </section>

    <section class="admin-grid">
      <div class="panel">
        <h2>玩家管理</h2>
        <form id="player-form" class="button-row">
          <input class="standalone-input" name="name" placeholder="玩家名称" required>
          <button class="primary-button" type="submit">添加玩家</button>
        </form>
        ${state.players.length ? `
          ${selectField("选择现有成员", "adminPlayerId", state.players.map((player) => `<option value="${player.id}" ${selectedAdminPlayer?.id === player.id ? "selected" : ""}>${escapeHtml(player.name)}${player.inactive ? "（已移出）" : ""}</option>`).join(""), true)}
          <div id="admin-player-detail" class="match-list">${renderPlayerAdminRow(selectedAdminPlayer)}</div>
        ` : `<div class="empty">暂无玩家</div>`}
      </div>

      <div class="panel gold-panel">
        <h2>Meta 设置</h2>
        <form id="meta-form">
          <div class="meta-grid">
            ${inputField("本周队套 Meta", "kitMeta", "text", state.meta.kitMeta)}
            ${inputField("计分 Meta 名称", "metaName", "text", state.meta.scoringMeta.name)}
            ${inputField("平局额外积分", "drawExtra", "number", state.meta.scoringMeta.drawExtra)}
            ${inputField("队套奖励倍率", "kitBonusMultiplier", "number", state.meta.scoringMeta.kitBonusMultiplier)}
            ${inputField("连胜奖励倍率", "streakBonusMultiplier", "number", state.meta.scoringMeta.streakBonusMultiplier)}
            ${inputField("特定组别加成分", "groupBonusPoints", "number", state.meta.scoringMeta.groupBonus.points)}
            ${selectField("加成组别", "groupBonusGroup", GROUPS.map((group) => `<option value="${group}" ${state.meta.scoringMeta.groupBonus.group === group ? "selected" : ""}>${group}</option>`).join(""), true)}
            <label class="field">启用组别加成
              <select name="groupBonusEnabled">
                <option value="false" ${!state.meta.scoringMeta.groupBonus.enabled ? "selected" : ""}>关闭</option>
                <option value="true" ${state.meta.scoringMeta.groupBonus.enabled ? "selected" : ""}>开启</option>
              </select>
            </label>
          </div>
          <div class="button-row">
            <button class="primary-button" type="submit">保存并应用 Meta</button>
          </div>
        </form>
      </div>
    </section>

    <section class="panel">
      <h2>历史 Meta 设置</h2>
      <div class="match-list">${renderMetaHistory()}</div>
    </section>

    <section class="two-grid">
      <div class="panel">
        <h2>异常比赛情况</h2>
        ${invalidMatches.length ? `<div class="button-row"><button class="danger-button" data-admin-action="delete-invalid">一键删除异常比赛</button></div>` : ""}
        <div class="match-list">${invalidMatches.length ? invalidMatches.map(renderMatchCardAdmin).join("") : `<div class="empty">暂无异常比赛</div>`}</div>
      </div>
      <div class="panel">
        <h2>周结算记录</h2>
        ${settlementSummary().map((item) => `<p>${formatDate(item.settledAt)} · 第 ${weekNumber(item.weekKey)} 周结算</p>`).join("") || `<p class="muted">暂无结算记录。</p>`}
      </div>
    </section>

    <section class="panel">
      <h2>所有比赛记录 <span id="admin-match-count" class="muted tiny">共 ${visibleMatches.length} 场</span></h2>
      <div class="button-row">
        ${selectField("查看周次", "adminMatchWeek", [`<option value="全部" ${selectedAdminMatchWeek === "全部" ? "selected" : ""}>全部</option>`, ...matchWeeks.map((week) => `<option value="${week}" ${selectedAdminMatchWeek === week ? "selected" : ""}>第 ${weekNumber(week)} 周</option>`)].join(""), false)}
        ${selectField("查看玩家", "adminMatchPlayer", [`<option value="全部" ${selectedAdminMatchPlayerId === "全部" ? "selected" : ""}>全部玩家</option>`, ...state.players.map((player) => `<option value="${player.id}" ${Number(selectedAdminMatchPlayerId) === player.id ? "selected" : ""}>${escapeHtml(player.name)}</option>`)].join(""), false)}
      </div>
      <div id="admin-match-list" class="match-list">${renderAdminMatchList(visibleMatches)}</div>
    </section>
  `;
}

function renderMetaFacts() {
  const meta = state.meta.scoringMeta;
  const facts = [];
  if (Number(meta.drawExtra || 0) > 0) facts.push(`<span class="pill">平局 +${Number(meta.drawExtra || 0)}</span>`);
  if (Number(meta.kitBonusMultiplier || 1) !== 1) facts.push(`<span class="pill">队套 x${Number(meta.kitBonusMultiplier || 1)}</span>`);
  if (Number(meta.streakBonusMultiplier || 1) !== 1) facts.push(`<span class="pill">连胜 x${Number(meta.streakBonusMultiplier || 1)}</span>`);
  if (meta.groupBonus?.enabled) facts.push(`<span class="pill gold">${escapeHtml(meta.groupBonus.group)}组 +${Number(meta.groupBonus.points || 0)}</span>`);
  return `
    <div class="meta-grid">
      ${facts.join("")}
    </div>
  `;
}

function renderMetaHistory() {
  const rows = [...state.metaHistory]
    .sort((a, b) => new Date(b.weekKey) - new Date(a.weekKey))
    .slice(0, 20);
  if (!rows.length) return `<div class="empty">暂无历史 Meta 记录</div>`;
  return rows.map((item) => {
    const meta = item.scoringMeta || {};
    const facts = [];
    if (Number(meta.drawExtra || 0) > 0) facts.push(`平局 +${Number(meta.drawExtra || 0)}`);
    if (Number(meta.kitBonusMultiplier || 1) !== 1) facts.push(`队套 ×${Number(meta.kitBonusMultiplier || 1)}`);
    if (Number(meta.streakBonusMultiplier || 1) !== 1) facts.push(`连胜 ×${Number(meta.streakBonusMultiplier || 1)}`);
    if (meta.groupBonus?.enabled) facts.push(`${meta.groupBonus.group}组 +${Number(meta.groupBonus.points || 0)}`);
    return `
      <article class="match-card">
        <b>第 ${weekNumber(item.weekKey)} 周 · ${escapeHtml(item.kitMeta)}</b>
        <p class="muted tiny">${escapeHtml(meta.name || "常规周")} · ${facts.length ? facts.map(escapeHtml).join(" · ") : "无额外计分 Meta"}</p>
      </article>
    `;
  }).join("");
}

function renderPlayerTable(players) {
  if (!players.length) return `<div class="empty">暂无玩家</div>`;
  return `
    <div class="table-wrap leaderboard-wrap">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>排名</th><th>玩家</th><th>积分</th><th>组别</th><th>周战绩</th><th>总战绩</th><th>队套场次</th>
          </tr>
        </thead>
        <tbody>
          ${players.map((player) => {
            const breakdown = playerPointBreakdown(player.id);
            return `
            <tr>
              <td class="rank">${player.rank}</td>
              <td>
                <span class="player-name-cell">
                  <a class="inline-link" href="#player:${player.id}" data-player-detail="${player.id}">${escapeHtml(player.name)}</a>
                  ${player.streak >= 2 ? `<span class="streak-flame" data-tooltip="连胜 ${player.streak} 场中！" aria-label="连胜${player.streak}场中">${player.streak}</span>` : ""}
                  ${weeklyValidMatchCount(player.id) < 5 ? `<span class="activity-warning" data-tooltip="本周有效比赛数不足5场！" aria-label="本周有效比赛数不足5场"><span class="activity-mark"></span></span>` : ""}
                </span>
              </td>
              <td>
                <b class="points-tooltip">${player.totalPoints}<span class="points-pop"><span class="gold-text">${breakdown.base}</span><span>+</span><span class="blue">${breakdown.extra}</span></span></b>
              </td>
              <td><span class="pill">${displayPlayerGroup(player)}</span></td>
              <td>${player.weekRecord}</td>
              <td>${totalRecord(player.id)}</td>
              <td>${kitMatchCount(player.id)}</td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMatchCard(match, focusPlayerId = null, showH2hButton = false) {
  return `
    <article class="match-card ${match.valid ? "" : "invalid"}">
      <b>${matchTitle(match)}</b>
      <p class="muted tiny">${weekLabel(match.playedAt)} · ${formatDate(match.playedAt)} · ${match.valid ? renderMatchPointText(match, focusPlayerId) : `无效：${escapeHtml(match.invalidReason)}`}</p>
      ${renderMetaUsageLine(match)}
      ${showH2hButton ? `<button class="ghost-button tiny-button" data-h2h="${match.playerAId}:${match.playerBId}">查看交手</button>` : ""}
    </article>
  `;
}

function renderMatchCardAdmin(match) {
  return `
    <article class="match-card ${match.valid ? "" : "invalid"}">
      <b>${matchTitle(match)}</b>
      <p class="muted tiny">${weekLabel(match.playedAt)} · ${formatDate(match.playedAt)} · ${match.valid ? `有效，积分 ${match.pointsA}:${match.pointsB}` : `无效：${escapeHtml(match.invalidReason)}`}</p>
      <p class="muted tiny">组别：${escapeHtml(matchGroupsLabel(match))}</p>
      ${renderMetaUsageLine(match)}
      <button class="danger-button" data-delete-match="${match.id}">删除比赛</button>
    </article>
  `;
}

function renderAdminMatchList(matches) {
  return matches.slice().reverse().map(renderMatchCardAdmin).join("") || `<div class="empty">暂无比赛</div>`;
}

function renderPointTimelineCard(item) {
  if (item.type === "penalty") return renderPenaltyTimelineCard(item);
  return `
    <article class="match-card timeline-card">
      <div>
        <b>第 ${item.index} 场 · ${escapeHtml(item.resultText)} ${playerLink(item.opponentId, item.opponentName)}</b>
        <p class="muted tiny">${weekLabel(item.match.playedAt)} · ${formatDate(item.match.playedAt)}</p>
        ${renderMetaUsageLine(item.match)}
        <button class="ghost-button tiny-button" data-h2h="${item.match.playerAId}:${item.match.playerBId}">查看交手</button>
      </div>
      <div class="timeline-score">
        <div class="timeline-gain">${renderScoreParts(item.parts)}</div>
        <div class="timeline-total"><span>${item.before}</span> → <b>${item.after}</b></div>
      </div>
    </article>
  `;
}

function renderPenaltyTimelineCard(item) {
  return `
    <article class="match-card timeline-card invalid">
      <div>
        <b>第 ${weekNumber(item.settlement.weekKey)} 周 · 活跃场次不足</b>
        <p class="muted tiny">${formatDate(item.settlement.settledAt)} · 有效 ${item.settlement.validMatches} 场</p>
      </div>
      <div class="timeline-score">
        <div class="timeline-gain">${renderScoreParts(item.parts)}</div>
        <div class="timeline-total"><span>${item.before}</span> → <b>${item.after}</b></div>
      </div>
    </article>
  `;
}

function renderGroupHistoryLine(item) {
  const week = weekNumber(item.weekKey);
  return `<p>第 ${week} 周结算 · <b class="gold-text">${escapeHtml(item.group)}组 第${item.rank}名</b></p>`;
}

function playerPointTimeline(playerId) {
  let runningTotal = Number(state.players.find((player) => player.id === Number(playerId))?.manualAdjustment || 0);
  let matchIndex = 0;
  const matchEvents = state.matches
    .filter((match) => match.valid && (Number(match.playerAId) === Number(playerId) || Number(match.playerBId) === Number(playerId)))
    .sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt) || Number(a.id) - Number(b.id))
    .map((match) => {
      const points = matchPointsForPlayer(match, playerId);
      const base = matchBasePointsForPlayer(match, playerId);
      const extra = points - base;
      return {
        type: "match",
        match,
        base,
        extra,
        points,
        parts: matchPointPartsForPlayer(match, playerId),
        opponentId: Number(match.playerAId) === Number(playerId) ? Number(match.playerBId) : Number(match.playerAId),
        opponentName: playerName(Number(match.playerAId) === Number(playerId) ? match.playerBId : match.playerAId),
        resultText: playerResultText(match, playerId),
        order: matchTimelineOrder(match)
      };
    });
  const penaltyEvents = state.settlements
    .filter((item) => Number(item.playerId) === Number(playerId) && Number(item.penalty || 0) > 0)
    .map((item) => ({
      type: "penalty",
      settlement: item,
      points: -Number(item.penalty || 0),
      parts: [{ type: "penalty", value: Number(item.penalty || 0), amount: -Number(item.penalty || 0), multiplier: 1 }],
      order: penaltyTimelineOrder(item)
    }));
  return [...matchEvents, ...penaltyEvents]
    .sort((a, b) => a.order - b.order)
    .map((event) => {
      if (event.type === "match") matchIndex += 1;
      const before = runningTotal;
      runningTotal += event.points;
      return {
        ...event,
        index: event.type === "match" ? matchIndex : null,
        before,
        after: runningTotal
      };
    })
    .reverse();
}

function playerResultText(match, playerId) {
  const isA = Number(match.playerAId) === Number(playerId);
  const won = (isA && match.result === "A_WIN") || (!isA && match.result === "B_WIN");
  if (won) return "胜";
  if (match.result === "DRAW") return "平";
  return "负";
}

function matchPointPartsForPlayer(match, playerId) {
  if (Number(match.playerAId) === Number(playerId)) return match.pointPartsA || [{ type: "base", value: matchBasePointsForPlayer(match, playerId), amount: matchBasePointsForPlayer(match, playerId), multiplier: 1 }];
  if (Number(match.playerBId) === Number(playerId)) return match.pointPartsB || [{ type: "base", value: matchBasePointsForPlayer(match, playerId), amount: matchBasePointsForPlayer(match, playerId), multiplier: 1 }];
  return [];
}

function renderScoreParts(parts) {
  return parts.map((part) => {
    const className = part.type === "penalty" ? "red-text" : part.type === "kit" || part.type === "meta" ? "blue" : part.type === "streak" ? "gold-text" : "";
    if (part.type === "penalty") return `<span class="${className}">-${Number(part.value || 0)}</span>`;
    const multiplier = Number(part.multiplier || 1);
    const value = Number(part.value || 0);
    const text = multiplier !== 1 ? `+${value}×${multiplier}` : `+${value}`;
    return `<span class="${className}">${text}</span>`;
  }).join("");
}

function renderMatchPointText(match, focusPlayerId = null) {
  if (!focusPlayerId) return `有效，积分 ${match.pointsA}:${match.pointsB}`;
  const points = matchPointsForPlayer(match, focusPlayerId);
  const base = matchBasePointsForPlayer(match, focusPlayerId);
  const extra = points - base;
  return `积分 +<span class="gold-text">${base}</span>+<span class="blue">${extra}</span>`;
}

function matchPointsForPlayer(match, playerId) {
  if (Number(match.playerAId) === Number(playerId)) return Number(match.pointsA || 0);
  if (Number(match.playerBId) === Number(playerId)) return Number(match.pointsB || 0);
  return 0;
}

function matchBasePointsForPlayer(match, playerId) {
  const isA = Number(match.playerAId) === Number(playerId);
  const isB = Number(match.playerBId) === Number(playerId);
  if ((isA && match.result === "A_WIN") || (isB && match.result === "B_WIN")) return 3;
  if ((isA || isB) && match.result === "DRAW") return 1;
  return 0;
}

function renderPlayerAdminRow(player) {
  return `
    <article class="match-card">
      <div class="two-grid">
        <label class="field">名称
          <input value="${escapeAttr(player.name)}" data-player-name="${player.id}">
        </label>
        <label class="field">手动积分修正
          <input type="number" value="${Number(player.manualAdjustment || 0)}" data-player-manual="${player.id}">
        </label>
      </div>
      <p class="muted tiny">${displayPlayerGroup(player)} · ${player.totalPoints} 分 · ${player.wins}/${player.matches}${player.inactive ? " · 已移出积分榜" : ""}</p>
      ${player.inactive ? `<span class="pill red">已移出积分榜</span>` : `<button class="danger-button" data-delete-player="${player.id}">移出积分榜</button>`}
    </article>
  `;
}

function statCard(label, value, color = "gold", escapeValue = true) {
  const className = color === "blue" ? "blue" : color === "red" ? "red-text" : "gold-text";
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value ${className}">${escapeValue ? escapeHtml(String(value)) : value}</div>
    </div>
  `;
}

function selectField(label, name, options, required) {
  return `
    <label class="field">${escapeHtml(label)}
      <select name="${escapeAttr(name)}" ${required ? "required" : ""}>${options}</select>
    </label>
  `;
}

function inputField(label, name, type, value) {
  return `
    <label class="field">${escapeHtml(label)}
      <input name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(String(value ?? ""))}">
    </label>
  `;
}

function playerOptions(group = null) {
  return activePlayers()
    .slice()
    .filter((player) => !group || player.group === group)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
    .map((player) => `<option value="${player.id}">${escapeHtml(player.name)} · ${displayPlayerGroup(player)}</option>`)
    .join("");
}

function groupsWithPlayers() {
  return openGroups(activePlayers().length).filter((group) => activePlayers().some((player) => player.group === group));
}

function bindPageEvents() {
  app.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.go));
  });

  app.querySelectorAll("[data-filter-group]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedGroup = button.dataset.filterGroup;
      render();
    });
  });

  app.querySelectorAll("[data-player-detail]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateToPlayer(link.dataset.playerDetail);
    });
  });

  app.querySelectorAll("[data-h2h]").forEach((button) => {
    button.addEventListener("click", () => {
      const [aId, bId] = button.dataset.h2h.split(":").map(Number);
      showH2hModal(selectedPlayerId || aId, Number(aId) === Number(selectedPlayerId) ? bId : aId);
    });
  });

  app.querySelectorAll(".streak-flame[data-tooltip], .activity-warning[data-tooltip]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showTapTooltip(item, escapeHtml(item.dataset.tooltip));
    });
  });

  app.querySelectorAll(".points-tooltip").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pop = item.querySelector(".points-pop");
      if (pop) showTapTooltip(item, pop.innerHTML, "tap-tooltip points-tap-tooltip");
    });
  });

  const matchForm = app.querySelector("#match-form");
  if (matchForm) {
    updateGroupHint(matchForm);
    matchForm.elements.matchGroup?.addEventListener("change", () => {
      selectedSubmitGroup = matchForm.elements.matchGroup.value;
      render();
    });
    matchForm.addEventListener("change", () => updateGroupHint(matchForm));
    matchForm.addEventListener("submit", onSubmitMatch);
  }

  const adminLogin = app.querySelector("#admin-login");
  if (adminLogin) adminLogin.addEventListener("submit", onAdminLogin);

  const playerForm = app.querySelector("#player-form");
  if (playerForm) playerForm.addEventListener("submit", onAddPlayer);

  const adminPlayerSelect = app.querySelector("[name='adminPlayerId']");
  if (adminPlayerSelect) {
    adminPlayerSelect.addEventListener("change", (event) => {
      event.preventDefault();
      selectedAdminPlayerId = Number(adminPlayerSelect.value);
      scheduleAdminPlayerDetailUpdate();
    });
  }

  const metaForm = app.querySelector("#meta-form");
  if (metaForm) metaForm.addEventListener("submit", onSaveMeta);

  const simulationForm = app.querySelector("#simulation-form");
  if (simulationForm) simulationForm.addEventListener("submit", onSaveSimulationDate);

  const adminMatchWeekSelect = app.querySelector("[name='adminMatchWeek']");
  if (adminMatchWeekSelect) {
    adminMatchWeekSelect.addEventListener("change", (event) => {
      event.preventDefault();
      selectedAdminMatchWeek = adminMatchWeekSelect.value;
      scheduleAdminMatchesViewUpdate();
    });
  }

  const adminMatchPlayerSelect = app.querySelector("[name='adminMatchPlayer']");
  if (adminMatchPlayerSelect) {
    adminMatchPlayerSelect.addEventListener("change", (event) => {
      event.preventDefault();
      selectedAdminMatchPlayerId = adminMatchPlayerSelect.value;
      scheduleAdminMatchesViewUpdate();
    });
  }

  app.querySelectorAll("[data-admin-action]").forEach((button) => {
    button.addEventListener("click", () => onAdminAction(button.dataset.adminAction));
  });

  bindDeleteMatchButtons(app);

  bindAdminPlayerControls(app);
}

function bindDeleteMatchButtons(root = app) {
  root.querySelectorAll("[data-delete-match]").forEach((button) => {
    button.addEventListener("click", () => deleteMatch(Number(button.dataset.deleteMatch)));
  });
}

function bindAdminPlayerControls(root = app) {
  root.querySelectorAll("[data-delete-player]").forEach((button) => {
    button.addEventListener("click", () => deletePlayer(Number(button.dataset.deletePlayer)));
  });

  root.querySelectorAll("[data-player-name]").forEach((input) => {
    input.addEventListener("change", () => updatePlayerName(Number(input.dataset.playerName), input.value));
  });

  root.querySelectorAll("[data-player-manual]").forEach((input) => {
    input.addEventListener("change", () => updatePlayerManual(Number(input.dataset.playerManual), Number(input.value)));
  });
}

function scheduleAdminPlayerDetailUpdate() {
  window.setTimeout(updateAdminPlayerDetail, 0);
}

function updateAdminPlayerDetail() {
  recompute();
  const player = state.players.find((item) => item.id === Number(selectedAdminPlayerId));
  const detail = app.querySelector("#admin-player-detail");
  if (!detail) return;
  detail.innerHTML = player ? renderPlayerAdminRow(player) : `<div class="empty">暂无玩家</div>`;
  bindAdminPlayerControls(detail);
}

function scheduleAdminMatchesViewUpdate() {
  window.setTimeout(updateAdminMatchesView, 0);
}

function updateAdminMatchesView() {
  recompute();
  const visibleMatches = adminVisibleMatches();
  const count = app.querySelector("#admin-match-count");
  const list = app.querySelector("#admin-match-list");
  if (count) count.textContent = `共 ${visibleMatches.length} 场`;
  if (list) {
    list.innerHTML = renderAdminMatchList(visibleMatches);
    bindDeleteMatchButtons(list);
  }
}

document.addEventListener("click", (event) => {
  const detailLink = event.target.closest("[data-player-detail]");
  if (detailLink && !event.defaultPrevented) {
    event.preventDefault();
    hideH2hModal();
    navigateToPlayer(detailLink.dataset.playerDetail);
    return;
  }
  if (!event.target.closest(".tap-tooltip")) hideTapTooltip();
});

window.addEventListener("resize", hideTapTooltip);
window.addEventListener("scroll", hideTapTooltip, true);

function showTapTooltip(anchor, html, className = "tap-tooltip") {
  hideTapTooltip();
  const tooltip = document.createElement("div");
  tooltip.className = className;
  tooltip.innerHTML = html;
  document.body.appendChild(tooltip);

  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2, 8),
    window.innerWidth - tooltipRect.width - 8
  );
  const top = anchorRect.top - tooltipRect.height - 8 > 8
    ? anchorRect.top - tooltipRect.height - 8
    : anchorRect.bottom + 8;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTapTooltip() {
  document.querySelectorAll(".tap-tooltip").forEach((item) => item.remove());
}

function showH2hModal(playerId, opponentId) {
  hideH2hModal();
  const player = state.players.find((item) => item.id === Number(playerId));
  const opponent = state.players.find((item) => item.id === Number(opponentId));
  if (!player || !opponent) return;
  const matches = state.matches
    .filter((match) => isPairMatch(match, player.id, opponent.id))
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal-panel">
      <div class="modal-head">
        <h2>${playerLink(player.id, player.name)} vs ${playerLink(opponent.id, opponent.name)}</h2>
        <button class="ghost-button" data-close-modal>关闭</button>
      </div>
      <div class="match-list">${matches.length ? matches.map((match) => renderMatchCard(match, player.id, false)).join("") : `<div class="empty">暂无交手记录</div>`}</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-modal]")) hideH2hModal();
  });
}

function hideH2hModal() {
  document.querySelectorAll(".modal-backdrop").forEach((item) => item.remove());
}

function showConfirmDialog({ title, body, confirmText = "确认", cancelText = "取消" }) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal-panel confirm-panel">
        <div class="modal-head">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <div class="confirm-body">${body}</div>
        <div class="confirm-actions">
          <button class="ghost-button" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button class="primary-button" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const finish = (value) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-confirm-cancel]")) finish(false);
      if (event.target.closest("[data-confirm-ok]")) finish(true);
    });
  });
}

async function onSubmitMatch(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (Number(data.playerAId) === Number(data.playerBId)) {
    toast("不能选择同一名玩家");
    return;
  }
  const playerA = state.players.find((player) => player.id === Number(data.playerAId));
  const playerB = state.players.find((player) => player.id === Number(data.playerBId));
  if (!playerA || !playerB || playerA.inactive || playerB.inactive) {
    toast("已移出积分榜的玩家不能提交新战报");
    return;
  }
  const confirmed = await showConfirmDialog({
    title: "确认提交战报？",
    body: matchConfirmHtml(playerA, playerB, data.result, data.metaUsage),
    confirmText: "确认提交",
    cancelText: "再检查一下"
  });
  if (!confirmed) return;

  try {
    await loadState();
  } catch (error) {
    toast(error?.message || "同步最新数据失败，请稍后重试");
    return;
  }

  const freshPlayerA = state.players.find((player) => player.id === Number(data.playerAId));
  const freshPlayerB = state.players.find((player) => player.id === Number(data.playerBId));
  if (!freshPlayerA || !freshPlayerB || freshPlayerA.inactive || freshPlayerB.inactive) {
    toast("玩家状态已变化，请刷新后重试");
    return;
  }

  const playedAt = nextManualMatchDate().toISOString();

  state.matches.push({
    id: nextId(state.matches),
    playerAId: freshPlayerA.id,
    playerBId: freshPlayerB.id,
    playerAGroup: isUngroupedWeek(playedAt) ? "无" : freshPlayerA.group,
    playerBGroup: isUngroupedWeek(playedAt) ? "无" : freshPlayerB.group,
    result: data.result,
    scoreA: 0,
    scoreB: 0,
    metaUserId: null,
    metaUserIds: metaUsersFromUsage(data.metaUsage, freshPlayerA.id, freshPlayerB.id),
    scoringMetaSnapshot: null,
    playedAt,
    weekKey: weekKey(playedAt),
    createdAt: new Date().toISOString()
  });
  await persistAndRender("战报已提交，系统已自动计分", "leaderboard");
}

function updateGroupHint(form) {
  const hint = form.querySelector("#group-hint");
  const playerASelect = form.elements.playerAId;
  const playerBSelect = form.elements.playerBId;
  const selectablePlayers = activePlayers();
  if (playerASelect.value && playerASelect.value === playerBSelect.value && selectablePlayers.length > 1) {
    const replacement = selectablePlayers.find((player) => String(player.id) !== playerASelect.value);
    playerBSelect.value = String(replacement.id);
  }
  updatePlayerSelectLocks(form);
  const data = formData(form);
  const a = state.players.find((player) => player.id === Number(data.playerAId));
  const b = state.players.find((player) => player.id === Number(data.playerBId));
  if (!a || !b) {
    hint.innerHTML = `<span class="muted">选择双方玩家后会自动判断是否同组。</span>`;
    return;
  }
  if (a.id === b.id) {
    hint.innerHTML = `<span class="muted">不能录入同一名玩家的比赛。</span>`;
    return;
  }
  if (isUngroupedWeek()) {
    hint.innerHTML = `<span class="green-text">首周自由约战，可以提交。</span>`;
    return;
  }
  hint.innerHTML = a.group === b.group
    ? `<span class="green-text">${a.group}组内战，可以提交。</span>`
    : `<span class="muted">跨组比赛会自动标记为无效。</span>`;
}

function updatePlayerSelectLocks(form) {
  const playerAValue = form.elements.playerAId?.value;
  const playerBValue = form.elements.playerBId?.value;
  [...form.elements.playerAId.options].forEach((option) => {
    option.disabled = Boolean(playerBValue && option.value === playerBValue);
  });
  [...form.elements.playerBId.options].forEach((option) => {
    option.disabled = Boolean(playerAValue && option.value === playerAValue);
  });
}

function onAdminLogin(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (data.password !== adminPassword) {
    toast("后台密码不正确");
    return;
  }
  adminAuthed = true;
  sessionStorage.setItem("oh-league-admin", "yes");
  render();
}

async function onAddPlayer(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const name = String(data.name || "").trim();
  if (!name) return;
  if (state.players.some((player) => player.name === name)) {
    toast("这个玩家已经存在");
    return;
  }
  const player = makePlayer(nextId(state.players), name);
  state.players.push(player);
  selectedAdminPlayerId = player.id;
  forceRegroup(false);
  await persistAndRender("玩家已添加");
}

async function onSaveMeta(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const nextMeta = {
    kitMeta: String(data.kitMeta || "本周队套"),
    scoringMeta: {
      name: String(data.metaName || "常规周"),
      drawExtra: Number(data.drawExtra || 0),
      kitBonusMultiplier: Math.max(1, Number(data.kitBonusMultiplier || 1)),
      streakBonusMultiplier: Math.max(1, Number(data.streakBonusMultiplier || 1)),
      groupBonus: {
        enabled: data.groupBonusEnabled === "true",
        group: String(data.groupBonusGroup || "甲"),
        points: Number(data.groupBonusPoints || 0)
      }
    }
  };
  state.meta = nextMeta;
  upsertMetaHistory(currentWeekKey(), nextMeta);
  await persistAndRender("Meta 已保存，本周未结算战报会按新规则重算");
}

function upsertMetaHistory(week, meta) {
  const record = {
    id: nextId(state.metaHistory),
    weekKey: week,
    savedAt: new Date().toISOString(),
    kitMeta: meta.kitMeta,
    scoringMeta: JSON.parse(JSON.stringify(meta.scoringMeta))
  };
  state.metaHistory = state.metaHistory.filter((item) => item.weekKey !== week);
  state.metaHistory.push(record);
}

async function onSaveSimulationDate(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  state.simulationDate = data.simulationDate || new Date().toISOString().slice(0, 10);
  await persistAndRender("模拟日期已更新");
}

function onAdminAction(action) {
  if (action === "logout") {
    adminAuthed = false;
    sessionStorage.removeItem("oh-league-admin");
    render();
    return;
  }
  if (action === "settle") settleWeek();
  if (action === "next-week") enterNextWeek();
  if (action === "random-matches") addRandomMatches();
  if (action === "export-backup") exportBackup();
  if (action === "delete-invalid") deleteInvalidMatches();
  if (action === "reset-board") resetBoard();
  if (action === "seed") {
    addTestPlayers(10);
  }
}

function addTestPlayers(count = 10) {
  const base = ["阿森纳哥", "蓝月中场", "银河战舰", "国家队套王", "压哨绝杀", "防反大师", "边路快马", "铁血后腰", "禁区杀手", "门线战神", "任意球王", "反击大师", "南看台队长", "欧皇门将", "传控大师"];
  let added = 0;
  let cursor = state.players.length + 1;
  while (added < count) {
    const root = base[(cursor + added) % base.length];
    const name = `${root}${cursor}`;
    cursor += 1;
    if (state.players.some((player) => player.name === name)) continue;
    state.players.push(makePlayer(nextId(state.players), name));
    added += 1;
  }
  forceRegroup(false);
  persistAndRender(`已补充 ${added} 个测试玩家`);
}

function enterNextWeek() {
  const settledWeek = currentWeekKey();
  if (weekNumber(settledWeek) <= 0) {
    state.simulationDate = state.seasonStartDate || OFFICIAL_SEASON_START_DATE;
    persistAndRender("已进入第 1 周，正式开赛");
    return;
  }
  settleWeek(settledWeek, false);
  const next = currentSimulationDate();
  next.setDate(next.getDate() + 7);
  state.simulationDate = dateInputValue(next);
  persistAndRender(`已结算第 ${weekNumber(settledWeek)} 周并进入下一周`);
}

function addRandomMatches(count = 100) {
  const sameGroupPairs = [];
  const players = activePlayers();
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      if (isUngroupedWeek() || players[i].group === players[j].group) {
        sameGroupPairs.push([players[i], players[j]]);
      }
    }
  }
  if (!sameGroupPairs.length) {
    toast("同组玩家不足，无法生成随机战报");
    return;
  }

  const results = [
    { value: "A_WIN", weight: 45 },
    { value: "B_WIN", weight: 45 },
    { value: "DRAW", weight: 10 }
  ];
  const metaUsages = [
    { value: "none", weight: 72 },
    { value: "A", weight: 12 },
    { value: "B", weight: 12 },
    { value: "both", weight: 4 }
  ];
  const baseDate = nextMatchStartDate();
  for (let i = 0; i < count; i += 1) {
    const [playerA, playerB] = sameGroupPairs[randomInt(sameGroupPairs.length)];
    const playedAt = new Date(baseDate);
    playedAt.setMinutes(playedAt.getMinutes() + i * 7 + randomInt(4));
    const result = weightedPick(results);
    const metaUsage = weightedPick(metaUsages);
    state.matches.push({
      id: nextId(state.matches),
      playerAId: playerA.id,
      playerBId: playerB.id,
      playerAGroup: isUngroupedWeek(playedAt) ? "无" : playerA.group,
      playerBGroup: isUngroupedWeek(playedAt) ? "无" : playerB.group,
      result,
      scoreA: 0,
      scoreB: 0,
      metaUserId: null,
      metaUserIds: metaUsersFromUsage(metaUsage, playerA.id, playerB.id),
      scoringMetaSnapshot: null,
      playedAt: playedAt.toISOString(),
      weekKey: weekKey(playedAt),
      createdAt: new Date().toISOString()
    });
  }
  persistAndRender(`已随机录入 ${count} 场战报`);
}

function exportBackup() {
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `oh-league-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("数据备份已导出");
}

function nextMatchStartDate() {
  const latest = state.matches
    .map((match) => new Date(match.playedAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];
  const start = currentSimulationDate();
  start.setHours(18, 0, 0, 0);
  const startTime = start.getTime();
  if (!latest) return start;
  return new Date(Math.max(latest + 10 * 60 * 1000, startTime));
}

function nextManualMatchDate() {
  const now = new Date();
  const latest = state.matches
    .map((match) => new Date(match.playedAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];
  if (!latest || now.getTime() > latest) return now;
  return new Date(latest + 60 * 1000);
}

function resetBoard() {
  if (!confirm("确认重置积分榜并清除所有战报、结算记录和荣誉记录？玩家名单会保留。")) return;
  const preseason = new Date(`${OFFICIAL_SEASON_START_DATE}T12:00:00`);
  preseason.setDate(preseason.getDate() - 1);
  state.matches = [];
  state.settlements = [];
  state.champions = [];
  state.groupHistory = [];
  state.metaHistory = [];
  state.seasonStartDate = OFFICIAL_SEASON_START_DATE;
  state.simulationDate = dateInputValue(preseason);
  for (const player of state.players) {
    player.manualAdjustment = 0;
    player.totalPoints = 0;
    player.weekRecord = "0-0-0";
    player.streak = 0;
    player.wins = 0;
    player.matches = 0;
    player.group = "无";
    player.highestGroup = "无";
  }
  persistAndRender("积分榜已重置，赛季回到第 0 周");
}

function deleteInvalidMatches() {
  const count = state.matches.filter((match) => !match.valid).length;
  if (!count) {
    toast("暂无异常比赛");
    return;
  }
  if (!confirm(`确认删除 ${count} 场异常比赛？`)) return;
  state.matches = state.matches.filter((match) => match.valid);
  persistAndRender(`已删除 ${count} 场异常比赛`);
}

async function deleteMatch(id) {
  if (!confirm("确认删除这场比赛？")) return;
  state.matches = state.matches.filter((match) => match.id !== id);
  await persistAndRender("比赛已删除");
}

async function deletePlayer(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  if (player.inactive) {
    toast("该玩家已经移出积分榜");
    return;
  }
  if (!confirm("确认将该玩家移出积分榜？历史比赛和个人主页都会保留。")) return;
  player.inactive = true;
  player.inactiveAt = new Date().toISOString();
  await persistAndRender("玩家已移出积分榜，历史记录已保留");
}

async function updatePlayerName(id, name) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  player.name = name.trim() || player.name;
  await persistAndRender("玩家名称已更新");
}

async function updatePlayerManual(id, manualAdjustment) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  player.manualAdjustment = Number(manualAdjustment || 0);
  await persistAndRender("手动积分已更新");
}

async function persistAndRender(message, route = currentRoute) {
  recompute();
  try {
    await saveState();
  } catch (error) {
    toast(error?.message || "保存失败，请刷新后重试");
    if (supabaseClient) {
      try {
        await loadState();
      } catch (loadError) {
        startupError = loadError?.message || "加载失败";
      }
    }
    render();
    return;
  }
  currentRoute = route;
  location.hash = route;
  render();
  toast(message);
}

function suspiciousPairs() {
  const map = new Map();
  for (const match of state.matches) {
    const key = [match.playerAId, match.playerBId].sort((a, b) => a - b).join(":") + ":" + match.weekKey;
    const item = map.get(key) || {
      weekKey: match.weekKey,
      p1: Math.min(match.playerAId, match.playerBId),
      p2: Math.max(match.playerAId, match.playerBId),
      total: 0,
      invalid: 0
    };
    item.total += 1;
    item.invalid += match.valid ? 0 : 1;
    map.set(key, item);
  }
  return [...map.values()].filter((item) => item.total > 2 || item.invalid > 0);
}

function weeklyValidMatchCount(playerId) {
  const currentWeek = currentWeekKey();
  return state.matches.filter((match) => (
    match.valid &&
    weekKey(match.playedAt) === currentWeek &&
    (Number(match.playerAId) === Number(playerId) || Number(match.playerBId) === Number(playerId))
  )).length;
}

function settlementSummary() {
  return [...state.settlements
    .reduce((map, item) => {
      const current = map.get(item.weekKey);
      if (!current || new Date(item.settledAt) > new Date(current.settledAt)) {
        map.set(item.weekKey, { weekKey: item.weekKey, settledAt: item.settledAt });
      }
      return map;
    }, new Map())
    .values()]
    .sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt))
    .slice(0, 20);
}

function settlementEventTime(settlement) {
  const explicit = new Date(settlement.effectiveAt).getTime();
  if (!Number.isNaN(explicit)) return explicit;
  return settlementEffectiveTime(settlement.weekKey).getTime();
}

function settlementEffectiveTime(week) {
  const date = new Date(`${week}T00:00:00`);
  date.setDate(date.getDate() + 7);
  return date;
}

function matchTimelineOrder(match) {
  const weekStart = new Date(`${weekKey(match.playedAt)}T00:00:00`).getTime();
  const playedAt = new Date(match.playedAt).getTime();
  const offset = Number.isNaN(playedAt) ? 0 : Math.max(0, playedAt - weekStart);
  return weekStart + Math.min(offset, 7 * 86400000 - 2);
}

function penaltyTimelineOrder(settlement) {
  const weekStart = new Date(`${settlement.weekKey}T00:00:00`).getTime();
  return weekStart + 7 * 86400000 - 1;
}

function adminMatchWeeks() {
  return [...new Set(state.matches.map((match) => weekKey(match.playedAt)))]
    .sort((a, b) => new Date(b) - new Date(a));
}

function adminVisibleMatches() {
  return state.matches.filter((match) => {
    const weekMatched = selectedAdminMatchWeek === "全部" || weekKey(match.playedAt) === selectedAdminMatchWeek;
    const playerMatched = selectedAdminMatchPlayerId === "全部" || [Number(match.playerAId), Number(match.playerBId)].includes(Number(selectedAdminMatchPlayerId));
    return weekMatched && playerMatched;
  });
}

function totalRecord(playerId) {
  const record = [0, 0, 0];
  for (const match of state.matches) {
    if (!match.valid) continue;
    const isA = Number(match.playerAId) === Number(playerId);
    const isB = Number(match.playerBId) === Number(playerId);
    if (!isA && !isB) continue;
    const won = (isA && match.result === "A_WIN") || (isB && match.result === "B_WIN");
    if (won) record[0] += 1;
    else if (match.result === "DRAW") record[1] += 1;
    else record[2] += 1;
  }
  return record.join("-");
}

function kitMatchCount(playerId) {
  return state.matches.filter((match) => (
    match.valid &&
    getMatchMetaUsers(match).includes(Number(playerId))
  )).length;
}

function playerExtraBreakdown(playerId) {
  const totals = { kit: 0, streak: 0, meta: 0 };
  for (const match of state.matches) {
    if (!match.valid) continue;
    for (const part of matchPointPartsForPlayer(match, playerId)) {
      if (part.type === "kit") totals.kit += Number(part.amount || 0);
      if (part.type === "streak") totals.streak += Number(part.amount || 0);
      if (part.type === "meta") totals.meta += Number(part.amount || 0);
    }
  }
  totals.total = totals.kit + totals.streak + totals.meta;
  return totals;
}

function playerMaxWeeklyStreak(playerId) {
  const streaks = new Map();
  let best = 0;
  const matches = [...state.matches]
    .filter((match) => match.valid && (Number(match.playerAId) === Number(playerId) || Number(match.playerBId) === Number(playerId)))
    .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime() || Number(a.id) - Number(b.id));

  for (const match of matches) {
    const isA = Number(match.playerAId) === Number(playerId);
    const won = (isA && match.result === "A_WIN") || (!isA && match.result === "B_WIN");
    const streakKey = `${playerId}:${weekKey(match.playedAt)}`;
    const next = won ? Number(streaks.get(streakKey) || 0) + 1 : 0;
    streaks.set(streakKey, next);
    best = Math.max(best, next);
  }

  return best;
}

function playerBasePoints(playerId) {
  let base = 0;
  for (const match of state.matches) {
    if (!match.valid) continue;
    base += matchBasePointsForPlayer(match, playerId);
  }
  return base;
}

function playerPointBreakdown(playerId) {
  const player = state.players.find((item) => item.id === Number(playerId));
  const base = playerBasePoints(playerId);
  const total = Number(player?.totalPoints || 0);
  const extra = total - base;
  return {
    base,
    extra
  };
}

function playerName(id) {
  return state.players.find((player) => player.id === Number(id))?.name || "未知玩家";
}

function playerLink(id, fallbackName = null, className = "inline-link") {
  const playerId = Number(id);
  const name = fallbackName || playerName(playerId);
  if (!state.players.some((player) => player.id === playerId)) return escapeHtml(name);
  return `<a class="${escapeAttr(className)}" href="#player:${playerId}" data-player-detail="${playerId}">${escapeHtml(name)}</a>`;
}

function displayPlayerGroup(player) {
  if (isUngroupedWeek()) return "无";
  return `${player.group}组`;
}

function displayHighestGroup(player) {
  const settledWeeks = new Set(state.settlements.map((item) => item.weekKey));
  const hasSettledGroup = state.groupHistory.some((item) => item.playerId === player.id && settledWeeks.has(item.weekKey));
  if (!hasSettledGroup) return "无";
  return `${player.highestGroup}组`;
}

function matchGroupLabel(group) {
  if (!group || group === "首周" || group === "无") return "无";
  return `${group}组`;
}

function matchGroupsLabel(match) {
  const groupA = matchGroupLabel(match.playerAGroup);
  const groupB = matchGroupLabel(match.playerBGroup);
  return groupA === groupB ? groupA : `${groupA} · ${groupB}`;
}

function matchTitle(match) {
  const a = playerLink(match.playerAId);
  const b = playerLink(match.playerBId);
  if (match.result === "A_WIN") return `${a} 胜 ${b}`;
  if (match.result === "B_WIN") return `${b} 胜 ${a}`;
  return `${a} 平 ${b}`;
}

function isPairMatch(match, aId, bId) {
  const players = [Number(match.playerAId), Number(match.playerBId)];
  return players.includes(Number(aId)) && players.includes(Number(bId));
}

function weekLabel(dateInput) {
  return `第 ${weekNumber(dateInput)} 周`;
}

function routeLabel(route) {
  if (route === "home") return "首页";
  if (route === "leaderboard") return "排行榜";
  if (route === "submit") return "提交战报";
  if (route === "admin") return "后台";
  if (String(route).startsWith("player:")) return "上一位玩家";
  return "上一页";
}

function metaUsersFromUsage(usage, playerAId, playerBId) {
  if (usage === "A") return [Number(playerAId)];
  if (usage === "B") return [Number(playerBId)];
  if (usage === "both") return [Number(playerAId), Number(playerBId)];
  return [];
}

function metaUsageText(usage, playerA, playerB) {
  if (usage === "A") return playerA.name;
  if (usage === "B") return playerB.name;
  if (usage === "both") return `${playerA.name}、${playerB.name}`;
  return "无人使用";
}

function matchConfirmHtml(playerA, playerB, result, metaUsage) {
  return `
    <dl class="confirm-summary">
      <div><dt>玩家 A</dt><dd>${escapeHtml(playerA.name)}</dd></div>
      <div><dt>玩家 B</dt><dd>${escapeHtml(playerB.name)}</dd></div>
      <div><dt>比赛结果</dt><dd>${escapeHtml(resultText(result))}</dd></div>
      <div><dt>Meta 队套</dt><dd>${escapeHtml(metaUsageText(metaUsage, playerA, playerB))}</dd></div>
    </dl>
    <p class="muted tiny">提交后会立即计入积分榜。</p>
  `;
}

function getMatchMetaUsers(match) {
  if (Array.isArray(match.metaUserIds)) return match.metaUserIds.map(Number).filter(Boolean);
  return match.metaUserId ? [Number(match.metaUserId)] : [];
}

function renderMetaUsageLine(match) {
  const users = getMatchMetaUsers(match);
  if (!users.length) return `<p class="tiny muted">Meta 队套：无人使用</p>`;
  return `<p class="tiny gold-text">Meta 队套：${users.map((id) => playerLink(id)).join("、")}</p>`;
}

function resultText(result) {
  return { A_WIN: "A 胜", DRAW: "平局", B_WIN: "B 胜" }[result] || result;
}

function nextId(items) {
  return Math.max(0, ...items.map((item) => Number(item.id || 0))) + 1;
}

function weekKey(dateInput = new Date()) {
  const date = new Date(dateInput);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

function currentSimulationDate() {
  const date = state?.simulationDate ? new Date(`${state.simulationDate}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function currentWeekKey() {
  return weekKey(currentSimulationDate());
}

function isFirstWeek(dateInput = currentSimulationDate()) {
  return weekNumber(dateInput) === 1;
}

function isUngroupedWeek(dateInput = currentSimulationDate()) {
  return weekNumber(dateInput) <= 1;
}

function previousWeekKey(week) {
  const date = new Date(`${week}T00:00:00`);
  date.setDate(date.getDate() - 7);
  return weekKey(date);
}

function localDateTimeValue(input = new Date()) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function dateInputValue(input = new Date()) {
  const date = new Date(input);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function toast(message) {
  const template = document.querySelector("#toast-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function throwError(message) {
  console.error(message);
  toast(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
