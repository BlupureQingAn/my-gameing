/* Lexicon Rush - balance simulation. Run: node lexicon/tests/balance_sim.js --runs 500 --band hs */
"use strict";

const fs = require("fs");
const path = require("path");
const E = require("../core/engine.js");
const C = require("../core/content.js");

function argOf(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const RUNS = Number(argOf("runs", 200));
const BAND = argOf("band", "hs");
const POLICY = argOf("policy", "greedy");
const BANK_PATH = path.join(__dirname, "..", "data", "banks", BAND + ".json");
const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));

function combos5(arr) {
  const out = [];
  for (let a = 0; a < arr.length - 4; a++)
    for (let b = a + 1; b < arr.length - 3; b++)
      for (let c = b + 1; c < arr.length - 2; c++)
        for (let d = c + 1; d < arr.length - 1; d++)
          for (let e = d + 1; e < arr.length; e++) out.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
  return out;
}

function grammarRelax(run) {
  return E.hasRelic(run, "grammar-scholar") ? 1 : 0;
}

function choosePlay(run) {
  const hand = run.hand.filter((c) => !c.blurred);
  if (!hand.length) return null;
  const relax = grammarRelax(run);
  let best = null;
  const consider = (cards) => {
    const det = E.detectPattern(cards, { relax });
    const sc = E.scoreHand(run, cards, det, { declare: false }).score;
    const priority = C.HANDS[det.pattern].priority;
    const key = sc * 10 + priority;
    if (!best || key > best.key) best = { key, cards, det, sc };
  };
  for (const c of hand) consider([c]);
  if (hand.length >= 5) for (const combo of combos5(hand)) consider(combo);
  return best;
}

function discardWorst(run) {
  const hand = run.hand.filter((c) => !c.blurred);
  if (!hand.length) return null;
  const byValue = hand.slice().sort((a, b) => a.w.length - b.w.length);
  return byValue.slice(0, Math.min(5, byValue.length)).map((c) => c.id);
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function playBlindRandom(run, stats, rnd) {
  let guard = 0;
  while (run.phase === "blind" && guard++ < 20) {
    const hand = run.hand.filter((c) => !c.blurred);
    if (!hand.length) break;
    const pool = hand.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    const n = 1 + Math.floor(rnd() * Math.min(5, pool.length));
    const res = E.playHand(run, pool.slice(0, n).map((c) => c.id), "auto");
    if (!res.ok) break;
    stats.patterns[res.pattern] = (stats.patterns[res.pattern] || 0) + 1;
    stats.hands++;
    stats.totalScore += res.detail.score;
    if (res.cleared) break;
  }
}

function playBlind(run, stats, rnd) {
  if (POLICY === "random") return playBlindRandom(run, stats, rnd);
  let guard = 0;
  while (run.phase === "blind" && guard++ < 20) {
    const best = choosePlay(run);
    const strong = best && ["ladder", "grammar", "collocation"].includes(best.det.pattern);
    if (!strong && run.discardsLeft > 0 && run.handsLeft > 1) {
      const ids = discardWorst(run);
      if (ids && ids.length) {
        E.discard(run, ids);
        continue;
      }
    }
    if (!best) break;
    const res = E.playHand(run, best.cards.map((c) => c.id), best.det.pattern);
    if (!res.ok) break;
    stats.patterns[res.pattern] = (stats.patterns[res.pattern] || 0) + 1;
    stats.hands++;
    stats.totalScore += res.detail.score;
    if (res.cleared) break;
  }
}

const MANUAL_PREF = ["grammar-manual", "ladder-manual", "collocation-manual", "flush-manual"];

function useManuals(run) {
  for (let guard = 0; guard < 10; guard++) {
    const idx = run.consumables.findIndex((id) => String(id).endsWith("-manual"));
    if (idx < 0) return;
    if (!E.useConsumable(run, idx).ok) return;
  }
}

function shopStep(run) {
  if (run.phase !== "shop" || !run.shop) return;
  useManuals(run);
  for (let i = 0; i < run.shop.offers.length; i++) {
    const o = run.shop.offers[i];
    if (o.type === "relic" && run.relics.length < 5 && run.money >= o.price && run.money - o.price >= 1) {
      E.buy(run, i);
    }
  }
  // 词牌指南：优先语法手册，买到就当场用掉（库存上限 2 不该卡住成长）
  for (const want of MANUAL_PREF) {
    for (;;) {
      const idx = run.shop.offers.findIndex(
        (o) => o.type === "consumable" && o.id === want && run.money >= o.price && run.money - o.price >= 1
      );
      if (idx < 0) break;
      if (run.consumables.length >= 2) useManuals(run);
      if (!E.buy(run, idx).ok) break;
      useManuals(run);
    }
  }
  E.nextBlind(run);
}

function runOne(seed, stats) {
  const run = E.createRun({ seed, band: BAND, bank });
  const rnd = lcg(seed ^ 0x9e3779b9);
  let guard = 0;
  while (guard++ < 2000) {
    if (run.phase === "blind") playBlind(run, stats, rnd);
    else if (run.phase === "settle") {
      const res = E.settleBlind(run);
      stats.moneyEarned += res.gained;
      if (run.phase === "shop") shopStep(run);
    } else if (run.phase === "shop") shopStep(run);
    else break;
  }
  stats.runs++;
  if (run.phase === "victory" || run.ante > 1) stats.clearedAnte1++;
  if (run.phase === "victory") stats.wins++;
  else {
    stats.gameovers++;
    stats.anteAtDeath[run.ante] = (stats.anteAtDeath[run.ante] || 0) + 1;
  }
  stats.bestAnte[Math.max(stats.bestAnte.max || 0, run.ante - (run.phase === "victory" ? 0 : 1))] = true;
  stats.maxAnte = Math.max(stats.maxAnte, run.ante);
  stats.crystals += run.profile.crystals || 0;
  stats.relicCount += run.relics.length;
  stats.vaultCount += run.vault.length;
  return run;
}

function main() {
  const stats = {
    runs: 0,
    wins: 0,
    clearedAnte1: 0,
    gameovers: 0,
    hands: 0,
    totalScore: 0,
    moneyEarned: 0,
    crystals: 0,
    relicCount: 0,
    vaultCount: 0,
    maxAnte: 0,
    patterns: {},
    anteAtDeath: {},
    bestAnte: {},
  };
  const t0 = Date.now();
  for (let i = 0; i < RUNS; i++) runOne(1000 + i, stats);
  const ms = Date.now() - t0;
  const avg = (x) => (stats.runs ? x / stats.runs : 0);
  const report = {
    band: BAND,
    policy: POLICY,
    runs: stats.runs,
    winRate: +(stats.wins / stats.runs * 100).toFixed(1),
    ante1ClearRate: +(stats.clearedAnte1 / stats.runs * 100).toFixed(1),
    avgHandsPerRun: +avg(stats.hands).toFixed(1),
    avgScorePerHand: +(stats.totalScore / Math.max(1, stats.hands)).toFixed(0),
    avgMoneyEarned: +avg(stats.moneyEarned).toFixed(1),
    avgCrystals: +avg(stats.crystals).toFixed(2),
    avgRelics: +avg(stats.relicCount).toFixed(2),
    avgVault: +avg(stats.vaultCount).toFixed(2),
    maxAnte: stats.maxAnte,
    anteAtDeath: stats.anteAtDeath,
    patterns: stats.patterns,
    ms,
    runsPerSec: +(stats.runs / (ms / 1000)).toFixed(1),
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
