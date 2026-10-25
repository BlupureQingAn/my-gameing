import { GameSession } from "../game/session.js";
import { TableView } from "./table.js";
import { sfx, setSound, setMusic, setAmbient, unlock } from "./audio.js";
import {
  COSMETICS,
  COSMETIC_INDEX,
  addWordFromCard,
  defaultProfile,
  deleteWord,
  dueReviewWords,
  loadProfile,
  loadStats,
  loadVocab,
  markAnswer,
  mergeCloudVocab,
  profileEquipped,
  recordStats,
  saveProfile,
  setCloudId,
  upsertVocab,
} from "../platform/store.js";
import {
  finishRun,
  getProfile,
  isLoggedIn,
  isMember,
  leaderboard,
  listVocab,
  nickname,
  patchVocab,
  pushVocab,
  putProfile,
  removeVocab as removeCloudVocab,
  setLeaderboardOptIn,
  startRun,
  track,
  flushEvents,
} from "../platform/cloud.js";

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NAMES = ["你", "面具一", "面具二", "面具三"];
const PREF_KEY = "cihuang_prefs_v1";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ band: state.band, difficulty: state.difficulty }));
  } catch (e) {}
}

const prefs = readPrefs();
const state = {
  profile: loadProfile(),
  stats: loadStats(),
  band: ["hs", "cet4", "cet6", "ky", "toefl"].includes(prefs.band) ? prefs.band : "hs",
  difficulty: ["easy", "normal", "hard"].includes(prefs.difficulty) ? prefs.difficulty : "normal",
  session: null,
  table: null,
  runId: null,
  driving: false,
  starting: false,
  settlementShown: false,
  dataCache: new Map(),
  toastTimer: null,
  shake: null,
};

/* ---------------- 基础 UI ---------------- */

function speak(word) {
  const text = String(word || "").trim();
  if (!text || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function bindSpeak(root) {
  root.querySelectorAll("[data-speak]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      speak(node.dataset.speak);
    });
  });
}

function toast(message, duration = 2200) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), duration);
}

function openModal({ title = "", sub = "", body = "", actions = "", wide = false, closable = true, onClose = null }) {
  const root = document.createElement("div");
  root.className = "modal";
  root.innerHTML = `<div class="modal-card ${wide ? "wide" : ""}">
    ${closable ? '<button class="modal-close" aria-label="关闭">×</button>' : ""}
    ${title ? `<h2 class="modal-title">${title}</h2>` : ""}
    ${sub ? `<p class="modal-sub">${sub}</p>` : ""}
    <div class="modal-body">${body}</div>
    ${actions ? `<div class="modal-actions">${actions}</div>` : ""}
  </div>`;
  $("modal-root").appendChild(root);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    if (onClose) onClose();
  };
  root.querySelector(".modal-close")?.addEventListener("click", close);
  root.addEventListener("click", (event) => {
    if (event.target === root && closable) close();
  });
  return { root, card: root.querySelector(".modal-card"), close };
}

function hideActionBar() {
  $("action-bar").classList.remove("show");
}

/* ---------------- 菜单 ---------------- */

function updateAccount() {
  const node = $("menu-account");
  if (!node) return;
  if (isLoggedIn()) {
    const name = nickname() || "已登录赌客";
    const badge = isMember() ? '<span class="badge">会员</span>' : '<span class="badge" style="border-color:#3f5c4a;color:#97a79a">免费版</span>';
    node.innerHTML = `<span><strong>${esc(name)}</strong>${badge}</span><span>水晶 <b style="color:var(--amber)">${state.profile.crystals}</b></span>`;
  } else {
    node.innerHTML = '<span>未登录 · 仅本地存档</span><a href="/">去主站登录 →</a>';
  }
}

function updateMenuStats() {
  const node = $("menu-stats");
  if (!node) return;
  const best = state.stats.best?.[state.difficulty] || 0;
  node.innerHTML = `
    <div>水晶<b>${state.profile.crystals}</b></div>
    <div>对局<b>${state.stats.games || 0}</b></div>
    <div>胜场<b>${state.stats.wins || 0}</b></div>
    <div style="grid-column:1/-1">本难度最高分<b>${best}</b></div>`;
}

const BANDS = [
  { id: "hs", name: "高中", note: "免费" },
  { id: "cet4", name: "四级", note: "会员" },
  { id: "cet6", name: "六级", note: "会员" },
  { id: "ky", name: "考研", note: "会员" },
  { id: "toefl", name: "托福", note: "会员" },
];
const DIFFS = [
  { id: "easy", name: "简单", note: "AI 55%" },
  { id: "normal", name: "普通", note: "AI 70%" },
  { id: "hard", name: "困难", note: "AI 85%" },
];

function renderChoices() {
  const bandNode = $("band-pick");
  bandNode.innerHTML = BANDS.map((band) => {
    const locked = band.id !== "hs" && !isMember();
    return `<button class="choice ${state.band === band.id ? "active" : ""} ${locked ? "locked" : ""}" data-band="${band.id}">
      ${band.name}<small>${locked && isLoggedIn() ? "会员" : band.note}</small></button>`;
  }).join("");
  const diffNode = $("diff-pick");
  diffNode.innerHTML = DIFFS.map((diff) => `<button class="choice ${state.difficulty === diff.id ? "active" : ""}" data-diff="${diff.id}">
    ${diff.name}<small>${diff.note}</small></button>`).join("");
  bandNode.querySelectorAll("[data-band]").forEach((button) => {
    button.addEventListener("click", () => {
      sfx.click();
      const id = button.dataset.band;
      if (id !== "hs" && !isMember()) {
        showMemberGate();
        return;
      }
      state.band = id;
      savePrefs();
      renderChoices();
      updateMenuStats();
    });
  });
  diffNode.querySelectorAll("[data-diff]").forEach((button) => {
    button.addEventListener("click", () => {
      sfx.click();
      state.difficulty = button.dataset.diff;
      savePrefs();
      renderChoices();
      updateMenuStats();
    });
  });
}

function showMemberGate() {
  if (!isLoggedIn()) {
    openModal({
      title: "需要登录",
      sub: "四级、六级、考研、托福词库为会员专属内容。你可以先登录主站，回到这里后用高中词库免费开局。",
      body: '<p style="font-size:12px;line-height:1.8;color:var(--dim)">高中词库永久免费，包含全部难度与完整游戏流程。会员词库与云存档需要主站账号。</p>',
      actions: '<a class="btn btn-primary" href="/">去主站登录</a>',
    });
    return;
  }
  openModal({
    title: "会员专属词库",
    sub: "当前账号是免费版。四级、六级、考研、托福词库以及云存档、跨设备生词本需要会员。",
    body: '<p style="font-size:12px;line-height:1.8;color:var(--dim)">高中词库与全部玩法对所有人开放，本地存档不受影响。</p>',
    actions: '<a class="btn btn-primary" href="/">查看会员</a><button class="btn" id="gate-close">先去玩高中词库</button>',
  }).card.querySelector("#gate-close").addEventListener("click", () => {
    document.querySelectorAll(".modal-close").forEach((node) => node.click());
  });
}

/* ---------------- 数据加载 ---------------- */

async function loadBandData(band) {
  if (state.dataCache.has(band)) return state.dataCache.get(band);
  const [topicsRes, gameRes] = await Promise.all([
    fetch(`data/topics/${band}.json`, { cache: "no-cache" }),
    fetch(`data/game/${band}.json`, { cache: "no-cache" }),
  ]);
  if (!topicsRes.ok || !gameRes.ok) throw new Error(`${band} 数据未就绪`);
  const topicsJson = await topicsRes.json();
  const gameJson = await gameRes.json();
  const topics = Array.isArray(topicsJson.topics) ? topicsJson.topics : topicsJson;
  const data = {
    topics,
    words: gameJson.words || [],
    map: new Map((gameJson.words || []).map((row) => [row[0], row])),
  };
  state.dataCache.set(band, data);
  return data;
}

/* ---------------- 对局 ---------------- */

async function ensureTable() {
  if (state.table) return;
  await document.fonts.ready;
  state.table = new TableView({
    container: $("table-wrap"),
    equipped: profileEquipped(state.profile),
    reducedMotion: state.profile.settings.reducedMotion,
    onSelect: () => updateActionHint(),
    onPlay: (ids) => humanPlay(ids),
  });
  await state.table.init();
}

function updateMeta(view) {
  if (!view) return;
  $("meta-band").textContent = BANDS.find((band) => band.id === view.band)?.name || view.band;
  $("meta-diff").textContent = DIFFS.find((diff) => diff.id === view.difficulty)?.name || view.difficulty;
  $("meta-round").textContent = `第 ${view.round} 轮`;
  $("meta-run").classList.toggle("hidden", !state.runId);
}

function updateActionHint() {
  if (!state.table || !state.session) return;
  const ids = state.table.selectedIds();
  const button = $("btn-play");
  button.disabled = ids.length < 1 || ids.length > 3;
  $("action-hint").textContent = ids.length
    ? `已选 ${ids.length} 张`
    : "点选 1-3 张牌，或把牌向上拖动";
}

function enableHuman(view) {
  const table = state.table;
  table.setHandEnabled(true);
  const last = view.chain[view.chain.length - 1];
  const target = last ? view.players[last.player] : null;
  const canChallenge = !!last && last.player !== 0 && target && target.alive
    && target.handCount > 0 && last.claimed > 0;
  $("btn-challenge").classList.toggle("hidden", !canChallenge);
  $("action-bar").classList.add("show");
  updateActionHint();
  toggleHelpSound();
}

function toggleHelpSound() {
  $("btn-play").textContent = "出牌";
}

async function startGame() {
  if (state.starting) return;
  if (state.band !== "hs" && !isMember()) {
    showMemberGate();
    return;
  }
  state.starting = true;
  try {
    unlock();
    if (state.profile.settings.music) setMusic(true);
    sfx.click();
    const data = await loadBandData(state.band);
    await ensureTable();
    let run = null;
    if (isLoggedIn()) run = await startRun(state.band, state.difficulty);
    const seed = run?.seed || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const vocab = loadVocab().filter((item) => item.band === state.band && !item.deleted);
    const extraItems = vocab.map((item) => ({
      w: item.w,
      ipa: item.ipa,
      pos: item.pos,
      zh: item.glossZh,
      def: item.glossEn,
      freq: 0,
    }));
    state.session = new GameSession({
      data,
      band: state.band,
      difficulty: state.difficulty,
      seed,
      reviewWords: dueReviewWords(state.band, 5),
      extraItems,
    });
    state.runId = run?.run_id || null;
    state.settlementShown = false;
    $("screen-menu").classList.add("hidden");
    $("screen-game").classList.remove("hidden");
    updateMeta(state.session.view());
    state.table.setEquipped(profileEquipped(state.profile));
    state.table.render(state.session.view(), { deal: true });
    track("game_start", { band: state.band, difficulty: state.difficulty, online: !!state.runId });
    await wait(state.profile.settings.reducedMotion ? 120 : 650);
    drive();
  } catch (error) {
    console.error(error);
    toast(`开局失败：${error.message}`);
    track("error", { stage: "start", msg: String(error.message).slice(0, 100) });
  } finally {
    state.starting = false;
  }
}

async function drive() {
  if (state.driving || !state.session) return;
  state.driving = true;
  try {
    while (state.session) {
      const session = state.session;
      const view = session.view();
      updateMeta(view);
      if (view.result) {
        await settle(view.result);
        return;
      }
      if (view.phase === "challenge") {
        await handleChallenge();
        continue;
      }
      if (view.phase === "roulette") {
        await handleRoulette();
        continue;
      }
      if (view.phase === "round_end") {
        await handleRoundEnd(view);
        continue;
      }
      if (view.phase === "turn") {
        if (view.currentPlayer === 0) {
          enableHuman(view);
          return;
        }
        await aiTurn();
        continue;
      }
      break;
    }
  } catch (error) {
    console.error(error);
    toast(`对局出错：${error.message}`);
    track("error", { stage: "drive", msg: String(error.message).slice(0, 100) });
  } finally {
    state.driving = false;
  }
}

async function aiTurn() {
  const session = state.session;
  const delay = state.profile.settings.reducedMotion ? 120 : 700;
  await wait(delay);
  const action = session.aiAct();
  if (!action) return;
  const view = session.view();
  if (action.type === "play") {
    sfx.play();
    state.table.render(view, { animatePlay: action });
    track("play", { seat: action.playerId, n: action.cardIds.length });
    await wait(state.profile.settings.reducedMotion ? 100 : 520);
  } else {
    sfx.challenge();
    state.table.render(view, { animateChallengeId: action.playerId });
    track("challenge", { seat: action.playerId });
    await wait(state.profile.settings.reducedMotion ? 100 : 640);
  }
}

async function humanPlay(cardIds) {
  if (!state.session || !state.session.humanTurn()) return;
  try {
    state.session.playHuman(cardIds);
  } catch (error) {
    toast(error.message);
    return;
  }
  hideActionBar();
  state.table.setHandEnabled(false);
  state.table.clearSelection();
  sfx.play();
  const view = state.session.view();
  state.table.render(view, { animatePlay: { playerId: 0, cardIds } });
  track("play", { seat: 0, n: cardIds.length });
  await wait(state.profile.settings.reducedMotion ? 80 : 420);
  drive();
}

async function humanChallenge() {
  if (!state.session || !state.session.humanTurn()) return;
  try {
    state.session.challengeHuman();
  } catch (error) {
    toast(error.message);
    return;
  }
  hideActionBar();
  state.table.setHandEnabled(false);
  sfx.challenge();
  state.table.render(state.session.view(), { animateChallengeId: 0 });
  track("challenge", { seat: 0 });
  await wait(state.profile.settings.reducedMotion ? 100 : 560);
  drive();
}

function askAnswers(cards) {
  return new Promise((resolve) => {
    const answers = {};
    const body = `
      <p class="modal-sub">其余玩家都已锁定答案。逐张判断这些牌是否符合本轮主题。超时未答按答错处理。</p>
      <div class="answer-grid">
        ${cards.map((card) => `
          <div class="answer-card" data-card="${card.id}">
            <div class="answer-word" data-speak="${esc(card.w)}" title="点击朗读">${esc(card.w)}</div>
            <div class="answer-ipa">${esc(card.ipa || "")}</div>
            <div class="answer-btns">
              <button class="btn" data-id="${card.id}" data-val="true">合规</button>
              <button class="btn" data-id="${card.id}" data-val="false">不合规</button>
            </div>
          </div>`).join("")}
      </div>
      <div class="timer-track"><div class="timer-fill" id="answer-fill"></div></div>
      <div class="modal-actions"><button class="btn btn-primary" id="answer-submit">锁定答案</button></div>`;
    const modal = openModal({
      title: "公开作答",
      sub: `主题：${esc(state.session.view().topic?.prompt || "")}`,
      body,
      wide: true,
      closable: false,
    });
    bindSpeak(modal.card);
    modal.card.querySelectorAll("[data-id]").forEach((button) => {
      button.addEventListener("click", () => {
        sfx.click();
        const id = button.dataset.id;
        const value = button.dataset.val === "true";
        answers[id] = value;
        modal.card.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((peer) => {
          peer.classList.remove("selected-true", "selected-false");
        });
        button.classList.add(value ? "selected-true" : "selected-false");
      });
    });
    const start = performance.now();
    const duration = 10000;
    const fill = modal.card.querySelector("#answer-fill");
    const timer = setInterval(() => {
      const left = Math.max(0, duration - (performance.now() - start));
      fill.style.width = `${(left / duration) * 100}%`;
      if (left <= 0) submit();
    }, 100);
    let done = false;
    function submit() {
      if (done) return;
      done = true;
      clearInterval(timer);
      modal.close();
      resolve(answers);
    }
    modal.card.querySelector("#answer-submit").addEventListener("click", submit);
    track("judge_answer", { cards: cards.length });
  });
}

async function handleChallenge() {
  const session = state.session;
  let answers = {};
  if (session.humanMustAnswer()) {
    const cards = session.pendingAnswerCards();
    if (cards.length) answers = await askAnswers(cards);
  }
  const outcome = session.resolveAnswers(answers);
  applyLearning(outcome);
  await showReveal(outcome);
}

function applyLearning(outcome) {
  const human = outcome.results[0];
  if (!human) return;
  const topic = state.session.view().topic;
  let wrongCount = 0;
  for (const row of human.rows) {
    const card = outcome.cards.find((entry) => entry.id === row.cardId);
    if (!card || card.joker) continue;
    if (row.correct) {
      const entry = markAnswer(card.w, true);
      if (entry) syncEntry(entry);
    } else {
      const existing = loadVocab().find((item) => item.w.toLowerCase() === card.w.toLowerCase());
      const entry = existing
        ? (markAnswer(card.w, false) || existing)
        : addWordFromCard(card, { band: state.band, topic, source: "auto" });
      wrongCount += 1;
      syncEntry(entry);
      track("vocab_review", { w: card.w, correct: false });
    }
  }
  if (wrongCount) toast(`答错 ${wrongCount} 个词，已收进生词本`);
}

function showReveal(outcome) {
  return new Promise((resolve) => {
    const view = state.session.view();
    const pending = view.pendingChallenge;
    const humanRows = outcome.results[0]?.rows || [];
    const targetName = NAMES[pending?.targetId ?? 0];
    const challengerName = NAMES[pending?.challengerId ?? 0];
    const rows = outcome.cards.map((card) => {
      const row = humanRows.find((entry) => entry.cardId === card.id);
      let verdict = "";
      if (row) {
        if (row.correct) verdict = '<span class="reveal-verdict good">答对</span>';
        else verdict = `<span class="reveal-verdict bad">${row.answer == null ? "未答" : "答错"}</span>`;
      }
      const truthTag = card.joker
        ? '<span class="reveal-verdict good">合规 · 万能牌</span>'
        : card.truth
          ? '<span class="reveal-verdict good">合规</span>'
          : '<span class="reveal-verdict bad">不合规</span>';
      return `<div class="reveal-row ${card.joker || card.truth ? "truth" : "lie"}">
        <div><div class="reveal-word" data-speak="${esc(card.w)}" title="点击朗读">${esc(card.w)}</div>
        <div class="reveal-gloss">${esc(card.zh || card.def || "")}</div></div>
        <div style="text-align:right">${truthTag}${verdict ? `<div style="margin-top:4px">${verdict}</div>` : ""}</div>
      </div>`;
    }).join("");
    const summary = outcome.isLie
      ? `${esc(targetName)} 的这一段是谎言，${esc(targetName)} 前往轮盘。`
      : `这一段全部合规。质疑者 ${esc(challengerName)} 要为自己的判断接受轮盘。`;
    const modal = openModal({
      title: "翻开牌面",
      sub: summary,
      body: rows,
      wide: true,
      closable: false,
      actions: '<button class="btn btn-primary" id="reveal-next">继续</button>',
    });
    bindSpeak(modal.card);
    let done = false;
    const next = () => {
      if (done) return;
      done = true;
      modal.close();
      resolve();
    };
    modal.card.querySelector("#reveal-next").addEventListener("click", next);
    setTimeout(next, 20000);
  });
}

function showRoulette(outcome) {
  return new Promise((resolve) => {
    const who = NAMES[outcome.playerId];
    const skin = COSMETIC_INDEX[state.profile.equipped.roulette] || COSMETIC_INDEX.rl_brass;
    const body = `
      <div class="roulette-stage">
        <div class="roulette-who">${esc(who)} 接受轮盘</div>
        <div class="roulette-odds">第 ${outcome.pulls} / 6 次 · 本次击发概率 ${outcome.pulls}/6</div>
        <div class="cylinder" id="cylinder" style="--roulette-accent:#${skin.accent.toString(16).padStart(6, "0")};--roulette-body:#${skin.color.toString(16).padStart(6, "0")}">
          ${Array.from({ length: 6 }, (_, i) => `<div class="chamber" style="transform:rotate(${i * 60}deg) translateY(-46px)"></div>`).join("")}
        </div>
        <div class="roulette-result" id="roulette-result">扳机扣下…</div>
      </div>`;
    const modal = openModal({
      title: "左轮",
      body,
      closable: false,
    });
    sfx.spin();
    setTimeout(() => {
      const cylinder = modal.card.querySelector("#cylinder");
      const resultNode = modal.card.querySelector("#roulette-result");
      if (outcome.fire) {
        cylinder.classList.add("fire");
        resultNode.textContent = "砰！";
        resultNode.className = "roulette-result bang";
        sfx.shot();
      } else {
        resultNode.textContent = "空膛 · 咔哒";
        resultNode.className = "roulette-result click";
        sfx.dry();
      }
      track("roulette", { seat: outcome.playerId, fire: outcome.fire, pulls: outcome.pulls });
    }, state.profile.settings.reducedMotion ? 120 : 950);
    setTimeout(() => {
      modal.close();
      resolve();
    }, state.profile.settings.reducedMotion ? 900 : 2600);
  });
}

async function handleRoulette() {
  const outcome = state.session.spinRoulette();
  await showRoulette(outcome);
}

function roundEndText(end) {
  if (!end) return "本轮结束";
  if (end.reason === "elimination") return `${NAMES[end.eliminated]} 中弹出局`;
  if (end.reason === "empty") return `${NAMES[end.winner]} 出完手牌，赢下本轮`;
  return "本轮结束";
}

function chooseTopic(candidates) {
  return new Promise((resolve) => {
    const body = `<p class="modal-sub">你赢下这一轮。选择下一轮主题并先手。</p>
      <div class="topic-grid">
        ${candidates.map((topic, index) => `
          <button class="topic-card" data-index="${index}">
            <div class="topic-type">${topic.type === "synonym" ? "同义词主题" : "释义主题"}</div>
            <div class="topic-prompt">${esc(topic.prompt || (topic.promptTokens || []).join("；"))}</div>
            <div class="topic-meta">目标词 ${esc(topic.target)} · 难度 ${topic.level || 1}</div>
          </button>`).join("")}
      </div>`;
    let settled = false;
    const modal = openModal({
      title: "下一轮主题",
      body,
      wide: true,
      closable: true,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
    modal.card.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => {
        sfx.card();
        settled = true;
        modal.close();
        resolve(candidates[Number(button.dataset.index)]);
      });
    });
  });
}

async function handleRoundEnd(view) {
  const end = view.roundEnd;
  toast(roundEndText(end), 1800);
  await wait(state.profile.settings.reducedMotion ? 600 : 1300);
  if (!state.session || state.session.over) return;
  state.session.reviewWords = dueReviewWords(state.band, 5);
  const choice = state.session.autoChooseTopic();
  if (!choice) return;
  if (choice.needHuman) {
    const topic = await chooseTopic(choice.candidates);
    state.session.beginNextRound(topic || choice.candidates[0], 0);
  }
  const nextView = state.session.view();
  updateMeta(nextView);
  state.table.render(nextView, { deal: true });
  await wait(state.profile.settings.reducedMotion ? 120 : 550);
}

async function settle(result) {
  if (state.settlementShown) return;
  state.settlementShown = true;
  hideActionBar();
  if (state.table) state.table.setHandEnabled(false);
  const isQuit = result.reason === "quit";
  if (!isQuit && result.placement) {
    state.profile.crystals += Number(result.crystals) || 0;
    saveProfile(state.profile);
    state.stats = recordStats({
      difficulty: state.session.difficulty,
      placement: result.placement,
      score: result.score,
    });
    if (isMember()) putProfile(state.profile);
    updateMenuStats();
  }
  if (result.placement === 1) sfx.win();
  else if (!isQuit) sfx.lose();
  track("game_end", {
    placement: result.placement,
    score: result.score,
    reason: result.reason,
  });
  const breakdown = result.breakdown;
  const lines = breakdown ? `
    <div class="score-line"><span>名次 · 第 ${result.placement} 名</span><b>${breakdown.placementPoints}</b></div>
    <div class="score-line"><span>抓包 ${breakdown.catches} 次</span><b>${breakdown.catchPoints}</b></div>
    <div class="score-line"><span>骗过 ${breakdown.bluffs} 次</span><b>${breakdown.bluffPoints}</b></div>
    <div class="score-line"><span>存活 ${breakdown.survived} 轮</span><b>${breakdown.survivePoints}</b></div>
    <div class="score-total"><span>总分</span><b>${result.score}</b></div>` : "";
  const placeText = result.placement === 1 ? "第一" : result.placement ? `第 ${result.placement}` : "离席";
  const body = `
    <div class="result-place ${result.placement === 1 ? "first" : result.placement === 4 ? "last" : ""}">${esc(placeText)}</div>
    <p class="result-text">${esc(result.text)}</p>
    <div class="result-badges">
      <span class="result-badge">水晶 +${result.crystals || 0}</span>
      <span class="result-badge">抓包 ${result.catches}</span>
      <span class="result-badge">骗过 ${result.bluffs}</span>
      <span class="result-badge">作答正确 ${result.correctAnswers} / 错误 ${result.wrongAnswers}</span>
    </div>
    ${lines}`;
  const modal = openModal({
    title: isQuit ? "已离席" : "牌局结算",
    body,
    wide: false,
    closable: false,
    actions: `
      <button class="btn" id="res-menu">返回主菜单</button>
      <button class="btn" id="res-share">生成分享图</button>
      <button class="btn btn-primary" id="res-again">再来一局</button>
      <div class="validation" id="res-validation"></div>`,
  });
  modal.card.querySelector("#res-menu").addEventListener("click", () => {
    modal.close();
    backToMenu();
  });
  modal.card.querySelector("#res-again").addEventListener("click", () => {
    modal.close();
    state.session = null;
    state.runId = null;
    state.settlementShown = false;
    startGame();
  });
  modal.card.querySelector("#res-share").addEventListener("click", () => {
    shareResult(result).catch(() => toast("分享图生成失败"));
    track("share", { placement: result.placement });
  });
  if (!isQuit && state.runId && state.session && result.placement) {
    const validationNode = modal.card.querySelector("#res-validation");
    validationNode.textContent = "排行榜校验中…";
    const payload = state.session.serverPayload(state.runId);
    finishRun(payload).then((response) => {
      if (!response) {
        validationNode.textContent = "";
        return;
      }
      if (response.valid) {
        validationNode.textContent = `已通过校验，计入排行榜总分（+${response.score}）`;
        validationNode.className = "validation ok";
      } else {
        validationNode.textContent = `未计入排行榜：${response.reason || response.error || "校验失败"}`;
        validationNode.className = "validation bad";
      }
    }).catch(() => {
      validationNode.textContent = "";
    });
  } else if (!isQuit && !state.runId) {
    modal.card.querySelector("#res-validation").textContent = "本地对局不计入排行榜（登录后自动校验）";
  }
}

function backToMenu() {
  if (state.session && !state.session.over) {
    state.session.quit();
  }
  state.session = null;
  state.runId = null;
  state.settlementShown = false;
  hideActionBar();
  $("screen-game").classList.add("hidden");
  $("screen-menu").classList.remove("hidden");
  updateAccount();
  updateMenuStats();
  renderChoices();
}

/* ---------------- 分享图 ---------------- */

async function shareResult(result) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#0b1410");
  gradient.addColorStop(1, "#1c2a20");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = "#3b5747";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, 1144, 574);
  ctx.fillStyle = "#e2c477";
  ctx.font = "64px 'Fusion Pixel', monospace";
  ctx.fillText("词  谎", 72, 130);
  ctx.fillStyle = "#97a79a";
  ctx.font = "22px 'Fusion Pixel', monospace";
  ctx.fillText("LEXICON LIAR · 面具酒馆战报", 74, 176);
  ctx.fillStyle = "#efe6cf";
  ctx.font = "120px 'Fusion Pixel', monospace";
  const place = result.placement ? `第 ${result.placement} 名` : "中途离席";
  ctx.fillText(place, 72, 340);
  ctx.font = "30px 'Fusion Pixel', monospace";
  ctx.fillStyle = "#bad0c0";
  const facts = [
    `总分 ${result.score ?? 0}`,
    `抓包 ${result.catches} · 骗过 ${result.bluffs} · 存活 ${result.survived} 轮`,
    `答对 ${result.correctAnswers} · 答错 ${result.wrongAnswers}`,
    `水晶 +${result.crystals || 0}`,
  ];
  facts.forEach((line, i) => ctx.fillText(line, 76, 405 + i * 46));
  ctx.fillStyle = "#e2c477";
  ctx.font = "20px 'Fusion Pixel', monospace";
  ctx.fillText("bitlife.blupure.cn/cihuang", 72, 576);
  ctx.fillStyle = "#6b766b";
  ctx.textAlign = "right";
  ctx.fillText("云吞吞文游", 1128, 576);
  ctx.textAlign = "left";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("no blob");
  const file = new File([blob], "cihuang-result.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: "词谎战报", text: "来面具酒馆抓我的谎。" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cihuang-result.png";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("分享图已下载");
}

/* ---------------- 生词本 ---------------- */

function vocabStatus(item) {
  if (item.streak >= 2) return '<span class="vocab-status learned">已掌握</span>';
  if (item.reviews > 0 && !item.lastResult) return '<span class="vocab-status review">待复习</span>';
  if (item.reviews > 0) return '<span class="vocab-status">复习中</span>';
  return '<span class="vocab-status">新词</span>';
}

function syncEntry(entry) {
  if (!entry || !isMember()) return;
  (async () => {
    if (entry.cloudId) {
      await patchVocab(entry.cloudId, entry);
      return;
    }
    const pushed = await pushVocab(entry);
    if (pushed?.id) setCloudId(entry.w, pushed.id);
  })();
}

function lookupWord(word) {
  const data = state.dataCache.get(state.band);
  if (!data) return null;
  const row = data.map.get(word) || data.map.get(String(word).toLowerCase());
  if (!row) return null;
  return { w: row[0], ipa: row[1], pos: row[2] ? row[2].split(",") : [], zh: row[3], def: row[4], freq: row[5] };
}

async function showVocab() {
  if (!state.dataCache.has(state.band)) {
    await loadBandData(state.band).catch(() => null);
  }
  const render = () => {
    const items = loadVocab()
      .filter((item) => item.band === state.band && !item.deleted)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    const listHtml = items.length ? items.map((item) => `
      <div class="vocab-row">
        <div>
          <div class="vocab-word" data-speak="${esc(item.w)}" title="点击朗读">${esc(item.w)}</div>
          <div class="vocab-meta">${esc(item.glossZh || item.glossEn || "").slice(0, 80)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${vocabStatus(item)}
          <button class="btn btn-small" data-del="${esc(item.w)}">删除</button>
        </div>
      </div>`).join("") : '<div class="empty-note">生词本还是空的。答错的词会自动收进来。</div>';
    const body = `
      <div class="vocab-add">
        <input id="vocab-input" maxlength="64" placeholder="手动添加单词（当前词库）" />
        <button class="btn" id="vocab-add-btn">添加</button>
      </div>
      <p class="modal-sub">连续两次答对后移出复习池。${isMember() ? "已开启云端同步。" : "登录会员后可跨设备同步。"}</p>
      <div class="vocab-list">${listHtml}</div>`;
    const modal = openModal({
      title: "生词本",
      sub: `${BANDS.find((band) => band.id === state.band)?.name || state.band} 词库 · 复习词会优先进入牌堆`,
      body: body,
      wide: true,
    });
    bindSpeak(modal.card);
    modal.card.querySelectorAll("[data-del]").forEach((button) => {
      button.addEventListener("click", () => {
        const word = button.dataset.del;
        const entry = loadVocab().find((item) => item.w === word);
        deleteWord(word);
        if (entry?.cloudId) removeCloudVocab(entry.cloudId);
        sfx.click();
        modal.close();
        render();
      });
    });
    const add = () => {
      const input = modal.card.querySelector("#vocab-input");
      const word = input.value.trim();
      if (!word) return;
      const info = lookupWord(word);
      const existing = loadVocab().find((item) => item.w.toLowerCase() === word.toLowerCase());
      const entry = upsertVocab({
        w: info?.w || existing?.w || word,
        band: state.band,
        ipa: info?.ipa || existing?.ipa || "",
        pos: info?.pos || existing?.pos || [],
        glossZh: info?.zh || existing?.glossZh || "",
        glossEn: info?.def || existing?.glossEn || "",
        topicType: info ? (state.session?.view().topic?.type || "definition") : existing?.topicType,
        topicPrompt: info ? (state.session?.view().topic?.prompt || "") : existing?.topicPrompt,
        source: "manual",
      });
      syncEntry(entry);
      track("vocab_add", { w: word, source: "manual" });
      sfx.crystal();
      modal.close();
      render();
    };
    modal.card.querySelector("#vocab-add-btn").addEventListener("click", add);
    modal.card.querySelector("#vocab-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") add();
    });
  };
  render();
}

/* ---------------- 排行榜 ---------------- */

function showLeaderboard() {
  let current = state.difficulty;
  const modal = openModal({
    title: "排行榜",
    sub: "按总分排序，每人每难度一条记录。默认不公开，开启后显示昵称。",
    body: '<div class="lb-tabs" id="lb-tabs"></div><div id="lb-body"><div class="empty-note">读取中…</div></div><div class="lb-opt" id="lb-opt"></div>',
    wide: true,
  });
  const tabs = modal.card.querySelector("#lb-tabs");
  const bodyNode = modal.card.querySelector("#lb-body");
  const optNode = modal.card.querySelector("#lb-opt");

  async function load() {
    tabs.innerHTML = DIFFS.map((diff) => `<button class="btn ${current === diff.id ? "btn-primary" : ""}" data-diff="${diff.id}">${diff.name}</button>`).join("");
    tabs.querySelectorAll("[data-diff]").forEach((button) => {
      button.addEventListener("click", () => {
        current = button.dataset.diff;
        load();
      });
    });
    try {
      const data = await leaderboard(current);
      const rows = data.items || [];
      const html = rows.length ? `
        <div class="lb-row head"><span>名次</span><span>昵称</span><span class="lb-num score">总分</span><span class="lb-num">胜场</span><span class="lb-num games">对局</span></div>
        ${rows.map((row) => `<div class="lb-row"><span class="lb-rank">${row.rank}</span><span class="lb-name">${esc(row.nickname || "无名赌客")}</span><span class="lb-num score">${row.score}</span><span class="lb-num">${row.wins}</span><span class="lb-num games">${row.games}</span></div>`).join("")}`
        : '<div class="empty-note">这一桌还没有人上榜。开局并开启公开，就能留下名字。</div>';
      bodyNode.innerHTML = html + (data.me && data.me.optIn && data.me.rank
        ? `<div class="lb-row me"><span class="lb-rank">${data.me.rank}</span><span class="lb-name">你</span><span class="lb-num score">${data.me.score}</span><span class="lb-num">${data.me.wins}</span><span class="lb-num games">${data.me.games}</span></div>`
        : "");
      if (!isLoggedIn()) {
        optNode.innerHTML = '<span>登录后可开启公开排行</span><a class="btn btn-small" href="/">去登录</a>';
      } else {
        const on = !!data.me?.optIn;
        optNode.innerHTML = `<span>${on ? "你的成绩目前公开" : "你的成绩目前仅自己可见"}</span><button class="btn btn-small ${on ? "" : "btn-primary"}" id="lb-opt-btn">${on ? "关闭公开" : "开启公开"}</button>`;
        optNode.querySelector("#lb-opt-btn").addEventListener("click", async () => {
          try {
            await setLeaderboardOptIn(!on);
            track(on ? "leaderboard_opt_out" : "leaderboard_opt_in", {});
            toast(on ? "已关闭公开" : "已开启公开");
            load();
          } catch (error) {
            toast(error.message || "操作失败");
          }
        });
      }
    } catch (error) {
      bodyNode.innerHTML = `<div class="empty-note">排行榜暂不可用：${esc(error.message)}</div>`;
      optNode.innerHTML = "";
    }
  }
  load();
}

/* ---------------- 装扮 ---------------- */

function showCosmetics() {
  const render = () => {
    const groups = Object.entries(COSMETICS).map(([key, group]) => {
      const items = group.items.map((item) => {
        const owned = state.profile.cosmetics.includes(item.id);
        const equipped = state.profile.equipped[key] === item.id;
        const action = equipped
          ? '<button class="btn btn-small" disabled>已装备</button>'
          : owned
            ? `<button class="btn btn-small" data-equip="${key}" data-id="${item.id}">装备</button>`
            : `<button class="btn btn-small btn-primary" data-buy="${item.id}" data-price="${item.price}">${item.price} 水晶</button>`;
        return `<div class="cosmetic-item ${owned ? "owned" : ""} ${equipped ? "equipped" : ""}">
          <div class="cosmetic-swatch" style="background:linear-gradient(135deg,#${item.color.toString(16).padStart(6, "0")},#${item.accent.toString(16).padStart(6, "0")})"></div>
          <div class="cosmetic-name">${esc(item.name)}</div>
          <div class="cosmetic-price">${owned ? (item.price ? "已拥有" : "默认") : `${item.price} 水晶`}</div>
          <div class="cosmetic-actions">${action}</div>
        </div>`;
      }).join("");
      return `<div class="cosmetic-group"><h4>${esc(group.label)}</h4><div class="cosmetic-grid">${items}</div></div>`;
    }).join("");
    const modal = openModal({
      title: "装扮",
      sub: `水晶余额 ${state.profile.crystals}。装扮只改变外观，不影响胜负。`,
      body: groups,
      wide: true,
    });
    modal.card.querySelectorAll("[data-buy]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.buy;
        const price = Number(button.dataset.price) || 0;
        if (state.profile.crystals < price) {
          toast("水晶不够，再去赢几局");
          return;
        }
        state.profile.crystals -= price;
        state.profile.cosmetics = Array.from(new Set([...state.profile.cosmetics, id]));
        saveProfile(state.profile);
        if (isMember()) putProfile(state.profile);
        sfx.crystal();
        track("cosmetic_purchase", { id, price });
        updateAccount();
        updateMenuStats();
        modal.close();
        render();
      });
    });
    modal.card.querySelectorAll("[data-equip]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.equip;
        state.profile.equipped[key] = button.dataset.id;
        saveProfile(state.profile);
        if (isMember()) putProfile(state.profile);
        sfx.click();
        if (state.table) state.table.setEquipped(profileEquipped(state.profile));
        modal.close();
        render();
      });
    });
  };
  render();
}

/* ---------------- 设置 ---------------- */

function applyAudioSettings() {
  setSound(state.profile.settings.sound);
  setMusic(state.profile.settings.music && !!document.hasFocus());
  setAmbient(state.profile.settings.ambient !== false);
  $("btn-sound").textContent = state.profile.settings.sound ? "♪" : "×";
}

function showSettings() {
  const render = () => {
    const settings = state.profile.settings;
    const body = `
      <div class="settings-row"><span>音效</span><span class="switch" data-key="sound">
        <button data-val="1" class="${settings.sound ? "on" : ""}">开</button><button data-val="0" class="${!settings.sound ? "on" : ""}">关</button></span></div>
      <div class="settings-row"><span>爵士乐</span><span class="switch" data-key="music">
        <button data-val="1" class="${settings.music ? "on" : ""}">开</button><button data-val="0" class="${!settings.music ? "on" : ""}">关</button></span></div>
      <div class="settings-row"><span>环境声</span><span class="switch" data-key="ambient">
        <button data-val="1" class="${settings.ambient !== false ? "on" : ""}">开</button><button data-val="0" class="${settings.ambient === false ? "on" : ""}">关</button></span></div>
      <div class="settings-row"><span>减少动效</span><span class="switch" data-key="reducedMotion">
        <button data-val="1" class="${settings.reducedMotion ? "on" : ""}">开</button><button data-val="0" class="${!settings.reducedMotion ? "on" : ""}">关</button></span></div>
      <div class="settings-row"><span>教程</span><button class="btn btn-small" id="settings-tutorial">重新播放</button></div>
      <div class="settings-row"><span>账号</span><span style="font-size:11px;color:var(--dim)">${isLoggedIn() ? esc(nickname() || "已登录") : "未登录"}</span></div>
      <p class="modal-sub" style="margin-top:12px">进度自动保存在本机。会员登录后档案与生词本会同步到云端。</p>`;
    const modal = openModal({ title: "设置", body });
    modal.card.querySelectorAll(".switch").forEach((group) => {
      group.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          const key = group.dataset.key;
          const value = button.dataset.val === "1";
          state.profile.settings[key] = value;
          saveProfile(state.profile);
          if (isMember()) putProfile(state.profile);
          if (state.table) state.table.reducedMotion = !!state.profile.settings.reducedMotion;
          applyAudioSettings();
          sfx.click();
          modal.close();
          render();
        });
      });
    });
    modal.card.querySelector("#settings-tutorial").addEventListener("click", () => {
      modal.close();
      showTutorial();
    });
  };
  render();
}

/* ---------------- 教程 ---------------- */

const TUTORIAL_STEPS = [
  {
    title: "欢迎来到面具酒馆",
    text: "酒保把四副面具摆上桌。三个是 AI，只有你是真人。你们要用英语单词互相欺骗，直到只剩一个人还坐着。",
    demo: '<div class="demo-note">一局大约 5-8 分钟。输赢不是重点，活下来才是。</div>',
  },
  {
    title: "主题与合规词",
    text: "每轮有一张主题牌，比如释义是“<b>大体的；普通的</b>”，桌面公开 K=6，意思是整套牌里恰好有 <b>6</b> 张合规词。合规词需要你自己认识。",
    demo: `<div class="demo-cards">
      <div class="demo-card">general<small>目标词</small></div>
      <div class="demo-card">common<small>合规？</small></div>
      <div class="demo-card">future<small>合规？</small></div>
      <div class="demo-card">worldwide<small>合规？</small></div>
    </div><div class="demo-note">6 张合规牌 + 1 张万能牌 + 17 张干扰牌 = 24 张牌堆，每人 5 张。</div>`,
  },
  {
    title: "声称链 X / K",
    text: "轮到你时必须出 <b>1-3 张</b>牌，并声称它们都合规。所有人打出的牌数累计成 X。X 越接近 K，谎言越容易被抓住。",
    demo: '<div class="demo-note">例：面具一 +2，面具二 +2 → X = 4 / 6。</div>',
  },
  {
    title: "选牌与出牌",
    text: "点选 1-3 张手牌，再点“出牌”；也可以把牌向上拖动直接打出。拿不准的时候，你可以混进不合规的牌说谎。",
    interactive: "pick2",
    demo: `<div class="demo-cards" id="demo-pick">
      <div class="demo-card" data-demo="1">common<small>认识</small></div>
      <div class="demo-card" data-demo="2">broad<small>认识</small></div>
      <div class="demo-card" data-demo="3">future<small>不确定</small></div>
    </div><div class="demo-note" id="demo-pick-note">点两张牌试试。选中后“下一步”才会亮起。</div>`,
  },
  {
    title: "质疑",
    text: "如果上家刚出过牌，你可以不跟牌，直接 <b>质疑</b> 他这一段。质疑会翻开他刚打出的全部牌。注意：如果他是诚实的，你要受罚。",
    demo: '<div class="demo-note">上家出完手牌时不能质疑——他直接赢下本轮。</div>',
  },
  {
    title: "全体作答",
    text: "被质疑的牌会逐张公开。除被质疑者外，所有活着的人都要在 <b>10 秒</b>内判断每张牌合规还是不合规。你答错一个，这个词就会被收进生词本。",
    demo: '<div class="demo-note">AI 也会答错。它们在按自己的知识水平猜，不会偷看你的牌。</div>',
  },
  {
    title: "判定与惩罚",
    text: "只要这一段里有一张不合规，整段就算谎言：出牌者受罚。全部合规：质疑者受罚。判定后质疑者先手，开新链。",
    demo: '<div class="demo-note">抓包成功 +50 分；成功骗过不被质疑 +50 分。</div>',
  },
  {
    title: "左轮",
    text: "受罚者转动左轮。每个人有自己的六个弹巢，开局 1/6 概率击发，之后每次 +1/6，整局不重置。你中弹，牌局立即结束。",
    demo: '<div class="demo-note">AI 中弹会被淘汰；成功质疑者（或诚实被质疑者）选下一轮主题并先手。</div>',
  },
  {
    title: "生词本与积分",
    text: "答错的词自动收进生词本；连续两次答对后移出复习池。复习词会优先进入牌堆，帮你把背过的词再撞见一次。",
    demo: '<div class="demo-note">名次分 1000 / 600 / 300 / 100，外加抓包、骗过、存活分。每局按名次发水晶。</div>',
  },
  {
    title: "上桌",
    text: "规则就这些。选一套词库，坐下。记住：<b>牌桌上只有两种人——说谎的，和准备说谎的。</b>",
    demo: '<div class="demo-note">建议先用简单 AI 打一局，再换普通。困难 AI 会记你的说谎次数。</div>',
  },
];

function showTutorial() {
  let step = 0;
  let picked = new Set();
  const modal = openModal({
    title: "教程",
    body: '<div id="tutorial-body"></div>',
    wide: true,
    closable: true,
    actions: '<button class="btn" id="tut-skip">跳过</button><button class="btn btn-primary" id="tut-next">下一步</button>',
    onClose: () => {
      state.profile.settings.tutorialDone = true;
      saveProfile(state.profile);
    },
  });
  track("tutorial_start", {});
  const bodyNode = modal.card.querySelector("#tutorial-body");
  const nextBtn = modal.card.querySelector("#tut-next");
  const skipBtn = modal.card.querySelector("#tut-skip");

  const render = () => {
    const data = TUTORIAL_STEPS[step];
    bodyNode.innerHTML = `
      <div class="tutorial-step">
        <img class="bartender" src="assets/art/bartender.webp" alt="酒保" />
        <div class="tutorial-text">
          <div class="tutorial-progress">第 ${step + 1} / ${TUTORIAL_STEPS.length} 步</div>
          <h3 style="margin:6px 0 8px;font-weight:normal;color:var(--amber)">${data.title}</h3>
          <div>${data.text}</div>
          <div class="tutorial-demo">${data.demo || ""}</div>
        </div>
      </div>`;
    nextBtn.textContent = step === TUTORIAL_STEPS.length - 1 ? "上桌" : "下一步";
    nextBtn.disabled = data.interactive === "pick2" && picked.size < 2;
    if (data.interactive === "pick2") {
      bodyNode.querySelectorAll("[data-demo]").forEach((node) => {
        node.addEventListener("click", () => {
          const id = node.dataset.demo;
          if (picked.has(id)) playedDelete(id);
          else picked.add(id);
          node.classList.toggle("picked", picked.has(id));
          const note = bodyNode.querySelector("#demo-pick-note");
          if (note) note.textContent = picked.size >= 2 ? "很好，这样就是一次 2 张的出牌。" : `已选 ${picked.size} 张。`;
          nextBtn.disabled = picked.size < 2;
          sfx.click();
        });
      });
    }
  };
  const playedDelete = (id) => picked.delete(id);

  nextBtn.addEventListener("click", () => {
    sfx.click();
    if (step === TUTORIAL_STEPS.length - 1) {
      state.profile.settings.tutorialDone = true;
      saveProfile(state.profile);
      track("tutorial_complete", {});
      modal.close();
      return;
    }
    step += 1;
    picked = new Set();
    track("tutorial_step", { step });
    render();
  });
  skipBtn.addEventListener("click", () => {
    state.profile.settings.tutorialDone = true;
    saveProfile(state.profile);
    track("tutorial_skip", { step });
    modal.close();
  });
  render();
}

/* ---------------- 帮助 ---------------- */

function showHelp() {
  openModal({
    title: "规则速览",
    body: `<div class="rules">
      <ol>
        <li>四人一桌，每人 5 张手牌。牌堆 24 张：<b>6 张合规</b>、1 张万能、17 张干扰。</li>
        <li>每轮公布主题与 K=6。轮到你时出 <b>1-3 张</b>牌，声称全部合规；累计声称 X 公开。</li>
        <li>你也可以质疑上家刚打出的那一段。出完手牌的人不能被质疑，直接赢下本轮。</li>
        <li>被质疑的牌逐张公开，除出牌者外所有活人 <b>10 秒</b>内判断合规与否。答错会记入生词本。</li>
        <li>有一张不合规即为谎言，出牌者受罚；全部合规则质疑者受罚。</li>
        <li>受罚者转左轮，每人独立 1/6 起步，每次 +1/6，整局不重置。你中弹即出局。</li>
      </ol>
      <p>计分：名次 1000/600/300/100 + 抓包 50 + 骗过 50 + 存活 10。</p>
    </div>`,
  });
}

/* ---------------- 启动 ---------------- */

async function syncCloud() {
  if (!isMember()) return;
  try {
    const cloudProfile = await getProfile();
    if (cloudProfile) {
      state.profile.crystals = Math.max(state.profile.crystals, Number(cloudProfile.crystals) || 0);
      const owned = new Set([...(cloudProfile.cosmetics || []), ...state.profile.cosmetics]);
      state.profile.cosmetics = Array.from(owned).filter((id) => COSMETIC_INDEX[id]);
      for (const [key, id] of Object.entries(cloudProfile.equipped || {})) {
        if (COSMETIC_INDEX[id]) state.profile.equipped[key] = id;
      }
      state.profile.settings = {
        ...cloudProfile.settings,
        ...state.profile.settings,
      };
      saveProfile(state.profile);
      if (state.table) state.table.setEquipped(profileEquipped(state.profile));
    }
    const items = await listVocab();
    if (items) mergeCloudVocab(items);
  } catch (e) {
    // 云端不可用时静默降级
  }
  updateAccount();
  updateMenuStats();
}

function bindEvents() {
  $("btn-start").addEventListener("click", startGame);
  $("btn-tutorial").addEventListener("click", () => { sfx.click(); showTutorial(); });
  $("btn-vocab").addEventListener("click", () => { sfx.click(); showVocab(); });
  $("btn-leaderboard").addEventListener("click", () => { sfx.click(); showLeaderboard(); });
  $("btn-cosmetics").addEventListener("click", () => { sfx.click(); showCosmetics(); });
  $("btn-settings").addEventListener("click", () => { sfx.click(); showSettings(); });
  $("btn-play").addEventListener("click", () => {
    const ids = state.table?.selectedIds() || [];
    if (!ids.length) {
      toast("先选 1-3 张牌");
      return;
    }
    humanPlay(ids);
  });
  $("btn-challenge").addEventListener("click", () => humanChallenge());
  $("btn-quit").addEventListener("click", () => {
    const modal = openModal({
      title: "离开牌桌？",
      sub: "本局不会结算水晶。",
      actions: '<button class="btn" id="quit-cancel">继续打</button><button class="btn btn-danger" id="quit-confirm">离席</button>',
    });
    modal.card.querySelector("#quit-cancel").addEventListener("click", () => modal.close());
    modal.card.querySelector("#quit-confirm").addEventListener("click", () => {
      modal.close();
      backToMenu();
    });
  });
  $("btn-sound").addEventListener("click", () => {
    state.profile.settings.sound = !state.profile.settings.sound;
    saveProfile(state.profile);
    applyAudioSettings();
    sfx.click();
  });
  document.addEventListener("pointerdown", onceGesture, { once: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const modals = document.querySelectorAll(".modal");
      const last = modals[modals.length - 1];
      last?.querySelector(".modal-close")?.click();
    }
  });
  window.addEventListener("pagehide", () => flushEvents());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      setMusic(false);
      setAmbient(false);
    } else {
      applyAudioSettings();
    }
  });
}

function onceGesture() {
  unlock();
  if (state.profile.settings.music) setMusic(true);
}

async function boot() {
  if (!state.profile.settings.tutorialDone) {
    state.profile.settings.tutorialDone = false;
  }
  applyAudioSettings();
  state.equipped = profileEquipped(state.profile);
  updateAccount();
  updateMenuStats();
  renderChoices();
  bindEvents();
  syncCloud();
  track("app_open", {});
  if (!state.profile.settings.tutorialDone) {
    setTimeout(() => showTutorial(), 700);
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

boot();
