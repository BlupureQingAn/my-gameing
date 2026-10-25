export const K = 6;
export const MAX_PLAY = 3;
export const MAX_LOG_CHARS = 64 * 1024;
export const MIN_DURATION_SEC = 60;
export const MAX_DURATION_SEC = 30 * 60;

const PLACEMENT_POINTS = { 1: 1000, 2: 600, 3: 300, 4: 100 };
const CATCH_POINTS = 50;
const BLUFF_POINTS = 50;
const SURVIVE_POINTS = 10;
const HUMAN_ID = 0;

export function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function rouletteNext(seed) {
  let a = (hashString(String(seed)) ^ 0x2f6e2b1c) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function expectedRoulette(seed, events) {
  const next = rouletteNext(seed);
  const pulls = [0, 0, 0, 0];
  for (const event of events) {
    const player = event.p;
    if (!Number.isInteger(player) || player < 0 || player > 3) {
      return { ok: false, reason: "轮盘玩家越界" };
    }
    pulls[player] += 1;
    const draw = Math.floor(next() * 6);
    const fire = draw < pulls[player];
    if (event.fire !== fire || event.pulls !== pulls[player]) {
      return { ok: false, reason: "轮盘序列与种子不一致" };
    }
  }
  return { ok: true };
}

export function scoreOf({ placement, catches, bluffs, survived }) {
  return (PLACEMENT_POINTS[placement] || 0)
    + catches * CATCH_POINTS
    + bluffs * BLUFF_POINTS
    + survived * SURVIVE_POINTS;
}

function fail(reason) {
  return { ok: false, reason };
}

export function validateRun({
  log, placement, catches, bluffs, survived, score, durationSec, seed,
}) {
  if (!Array.isArray(log) || !log.length) return fail("日志为空");
  if (JSON.stringify(log).length > MAX_LOG_CHARS) return fail("日志过大");
  if (!Number.isInteger(durationSec)
    || durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
    return fail("对局时长异常");
  }
  if (![1, 2, 3, 4].includes(placement)) return fail("名次非法");
  for (const value of [catches, bluffs, survived]) {
    if (!Number.isInteger(value) || value < 0) return fail("统计值非法");
  }

  let rounds = 0;
  let roundEnds = 0;
  let challenges = 0;
  let plays = 0;
  let humanPlays = 0;
  let chainX = 0;
  let roundCards = 0;
  let aiEliminated = 0;
  let pendingSegment = null;
  let lastChallenge = null;
  let lastEvent = null;
  const rouletteEvents = [];
  let gameEnd = null;
  let quit = false;

  for (let i = 0; i < log.length; i += 1) {
    const event = log[i];
    if (!event || typeof event !== "object") return fail("日志格式错误");
    const type = event.t;
    if (type === "round_start") {
      rounds += 1;
      roundCards = 0;
      chainX = 0;
      pendingSegment = null;
      lastChallenge = null;
    } else if (type === "play") {
      if (!Number.isInteger(event.n) || event.n < 1 || event.n > MAX_PLAY) {
        return fail("出牌张数非法");
      }
      if (!Number.isInteger(event.p) || event.p < 0 || event.p > 3) {
        return fail("出牌玩家非法");
      }
      if (!Number.isInteger(event.c) || event.c < 0 || event.c > event.n) {
        return fail("声称牌数非法");
      }
      plays += 1;
      if (event.p === HUMAN_ID) humanPlays += 1;
      roundCards += event.n;
      if (roundCards > 20) return fail("单轮出牌超过发牌数");
      chainX += event.c;
      if (event.x !== chainX) return fail("声称链计数不一致");
      pendingSegment = { player: event.p, cards: event.n };
      lastChallenge = null;
    } else if (type === "challenge") {
      challenges += 1;
      if (!pendingSegment || event.target !== pendingSegment.player) {
        return fail("质疑目标不匹配");
      }
      if (!Number.isInteger(event.p) || event.p === pendingSegment.player) {
        return fail("质疑者非法");
      }
      lastChallenge = event;
    } else if (type === "judge") {
      if (!lastChallenge) return fail("判定缺少质疑");
      if (event.challenger !== lastChallenge.p || event.target !== lastChallenge.target) {
        return fail("判定与质疑不一致");
      }
      if (typeof event.lie !== "boolean") return fail("判定结果缺失");
      lastChallenge = null;
      pendingSegment = null;
    } else if (type === "roulette") {
      rouletteEvents.push(event);
      chainX = 0;
      pendingSegment = null;
      if (event.fire === true && event.p !== HUMAN_ID) aiEliminated += 1;
    } else if (type === "round_end") {
      roundEnds += 1;
      chainX = 0;
      pendingSegment = null;
    } else if (type === "game_end") {
      gameEnd = event;
    } else if (type === "quit") {
      quit = true;
    } else {
      return fail("未知日志事件");
    }
    lastEvent = event;
  }

  if (quit || !gameEnd || lastEvent !== gameEnd) return fail("对局未正常结束");
  if (rounds < 1 || roundEnds > rounds) return fail("轮数异常");
  if (challenges < 1) return fail("质疑数异常");
  if (catches > challenges) return fail("抓包数异常");
  if (bluffs > humanPlays) return fail("骗过数异常");
  if (survived !== roundEnds) return fail("存活轮数不一致");
  if (gameEnd.placement !== placement) return fail("结算名次不一致");

  const judgeCatches = log.filter(
    (event) => event.t === "judge" && event.lie === true && event.challenger === HUMAN_ID,
  ).length;
  if (catches !== judgeCatches) return fail("抓包数与日志不一致");

  if (gameEnd.reason === "hit") {
    if (placement !== 4 - aiEliminated) return fail("中弹名次不一致");
  } else if (gameEnd.reason === "last") {
    if (placement !== 1 || aiEliminated !== 3) return fail("胜利结算不一致");
  } else {
    return fail("结算原因非法");
  }

  const replay = expectedRoulette(seed, rouletteEvents);
  if (!replay.ok) return replay;

  const computed = scoreOf({ placement, catches, bluffs, survived });
  if (score !== computed) return fail("积分不一致");

  return {
    ok: true,
    score: computed,
    stats: {
      rounds, roundEnds, challenges, plays, humanPlays, catches, bluffs, survived,
      eliminations: aiEliminated,
    },
  };
}
