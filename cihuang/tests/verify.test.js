import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedRoulette,
  rouletteNext,
  scoreOf,
  validateRun,
} from "../server/verify.js";

function findSeed({ aiFires = 0, humanFire = false } = {}) {
  for (let i = 0; i < 500000; i += 1) {
    const seed = `seed-${i}`;
    const next = rouletteNext(seed);
    let ok = true;
    for (let j = 0; j < aiFires; j += 1) {
      if (Math.floor(next() * 6) >= 1) { ok = false; break; }
    }
    if (ok && humanFire) {
      if (Math.floor(next() * 6) >= 1) ok = false;
    }
    if (ok) return seed;
  }
  throw new Error("no seed found");
}

function baseInput(log, overrides = {}) {
  return {
    log,
    placement: 4,
    catches: 0,
    bluffs: 0,
    survived: 0,
    score: 100,
    durationSec: 120,
    seed: "seed-0",
    ...overrides,
  };
}

function humanHitLog(seed) {
  const log = [
    { t: "round_start", r: 1, p: 0 },
    { t: "play", p: 0, n: 2, c: 2, x: 2 },
    { t: "challenge", p: 1, target: 0, n: 2 },
    { t: "judge", target: 0, challenger: 1, lie: true, penalty: 0 },
    { t: "roulette", p: 0, fire: true, pulls: 1 },
    { t: "game_end", placement: 4, score: 100, reason: "hit" },
  ];
  return log;
}

test("accepts a consistent human-hit run", () => {
  const seed = findSeed({ humanFire: true });
  const log = humanHitLog(seed);
  const result = validateRun(baseInput(log, { seed }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.score, 100);
});

test("rejects a roulette sequence that does not match the seed", () => {
  const seed = findSeed({ humanFire: true });
  const log = humanHitLog(seed);
  log[4].fire = false;
  const result = validateRun(baseInput(log, { seed }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /轮盘/);
});

test("rejects broken X accounting and malformed plays", () => {
  const seed = findSeed({ humanFire: true });
  const badX = humanHitLog(seed);
  badX[1].x = 5;
  assert.equal(validateRun(baseInput(badX, { seed })).ok, false);
  const badN = humanHitLog(seed);
  badN[1].n = 4;
  assert.equal(validateRun(baseInput(badN, { seed })).ok, false);
});

test("rejects short durations, mismatched scores and bad placements", () => {
  const seed = findSeed({ humanFire: true });
  const log = humanHitLog(seed);
  assert.match(validateRun(baseInput(log, { seed, durationSec: 30 })).reason, /时长/);
  assert.match(validateRun(baseInput(log, { seed, score: 999 })).reason, /积分/);
  assert.match(validateRun(baseInput(log, { seed, placement: 2 })).reason, /名次/);
});

function threeEliminationLog() {
  const log = [];
  for (let i = 0; i < 3; i += 1) {
    const player = i + 1;
    log.push({ t: "round_start", r: i + 1, p: player });
    log.push({ t: "play", p: player, n: 2, c: 2, x: 2 });
    log.push({ t: "challenge", p: 0, target: player, n: 2 });
    log.push({ t: "judge", target: player, challenger: 0, lie: true, penalty: player });
    log.push({ t: "roulette", p: player, fire: true, pulls: 1 });
    if (i < 2) log.push({ t: "round_end", r: i + 1, reason: "elimination", eliminated: player });
  }
  log.push({ t: "game_end", placement: 1, reason: "last" });
  return log;
}

test("validates earned catches against judge events", () => {
  const seed = findSeed({ aiFires: 3 });
  const log = threeEliminationLog();
  const result = validateRun(baseInput(log, {
    seed,
    placement: 1,
    catches: 2,
    survived: 2,
    score: scoreOf({ placement: 1, catches: 2, bluffs: 0, survived: 2 }),
  }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /抓包/);
});

test("accepts a three-elimination first-place run", () => {
  const seed = findSeed({ aiFires: 3 });
  const log = threeEliminationLog();
  const result = validateRun(baseInput(log, {
    seed,
    placement: 1,
    catches: 3,
    survived: 2,
    score: scoreOf({ placement: 1, catches: 3, bluffs: 0, survived: 2 }),
  }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.stats.eliminations, 3);
});

test("roulette replay is order sensitive", () => {
  const seed = findSeed({ aiFires: 2 });
  const events = [
    { p: 1, pulls: 1, fire: true },
    { p: 2, pulls: 1, fire: true },
  ];
  assert.equal(expectedRoulette(seed, events).ok, true);
  assert.equal(expectedRoulette(seed, [events[0], events[0]]).ok, false);
});
