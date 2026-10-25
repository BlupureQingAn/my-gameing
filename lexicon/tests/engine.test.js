/* Lexicon Rush - engine tests. Run: node lexicon/tests/engine.test.js */
"use strict";

const assert = require("assert");
const E = require("../core/engine.js");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name, err: e });
  }
}

function W(w, pos, extra) {
  return Object.assign({ w, pos, syl: 2, affixes: [], syn: [], ant: [], zh: w, def: w, freq: 5, proper: false }, extra || {});
}

function bigBank(n) {
  const bank = [];
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let i = 0;
  for (const a of letters) {
    for (const b of letters) {
      if (bank.length >= (n || 120)) break;
      bank.push(W("z" + a + b, ["n"], { syl: 1 + (i % 4) }));
      i++;
    }
  }
  return bank;
}

function card(w, pos, extra) {
  const c = E.cardFromWord(W(w, pos, extra), 0);
  Object.assign(c, extra || {});
  return c;
}

function soloRun(opts) {
  const o = opts || {};
  const run = E.createRun({ seed: o.seed || 7, bank: o.bank || bigBank(120), profile: o.profile || {} });
  run.discardPile.push(...run.hand);
  run.hand = [];
  E.drawToLimit(run);
  run.handsLeft = 4;
  run.target = 1000000;
  if (o.relics) run.relics.push(...o.relics);
  return run;
}

function poolCount(run) {
  return run.hand.length + run.drawPile.length + run.discardPile.length + run.vault.length;
}

function idsOf(cards) {
  return cards.map((c) => c.id);
}

// ---------- deck / rng ----------
test("createRun builds 80 unique-word cards and full draw pile", () => {
  const run = E.createRun({ seed: 1, bank: bigBank(120) });
  assert.strictEqual(run.deck.length, 80);
  assert.strictEqual(run.drawPile.length, 72);
  assert.strictEqual(run.hand.length, 8);
  const uniq = new Set(run.deck.map((c) => c.w.toLowerCase()));
  assert.strictEqual(uniq.size, 80);
  assert.strictEqual(poolCount(run), 80);
});

test("buildDeck skips duplicate source words", () => {
  const bank = bigBank(100);
  bank.push(Object.assign({}, bank[0]));
  const run = E.createRun({ seed: 2, bank });
  const uniq = new Set(run.deck.map((c) => c.w.toLowerCase()));
  assert.strictEqual(uniq.size, run.deck.length);
});

test("same seed replays same deck", () => {
  const a = E.createRun({ seed: 99, bank: bigBank(120) });
  const b = E.createRun({ seed: 99, bank: bigBank(120) });
  assert.deepStrictEqual(a.deck.map((c) => c.w), b.deck.map((c) => c.w));
});

test("createRun filters stopwords and proper nouns", () => {
  const bank = [W("the", ["det"]), W("London", ["n"], { proper: true }), W("apple", ["n"]), W("run", ["v"])];
  const run = E.createRun({ seed: 3, bank });
  const words = run.deck.map((c) => c.w);
  assert(!words.includes("the"));
  assert(!words.includes("London"));
  assert(words.includes("apple"));
});

// ---------- pattern detection ----------
test("detects grammar flush via template", () => {
  const cards = [card("bigs", ["adj"]), card("cats", ["n"]), card("runs", ["v"]), card("fasts", ["adv"]), card("trees", ["n"])];
  const d = E.detectPattern(cards);
  assert.strictEqual(d.pattern, "grammar");
});

test("detects pos flush", () => {
  const cards = ["alpha", "bravo", "delta", "gamma", "omega"].map((w) => card(w, ["n"]));
  const d = E.detectPattern(cards);
  assert.strictEqual(d.pattern, "posFlush");
  assert.deepStrictEqual(d.detail.pos, ["n"]);
});

test("detects semantic ladder by ascending frequency rank", () => {
  const cards = [1, 4, 6, 9, 12].map((r, i) => card("ladv" + i, ["n"], { rank: r }));
  assert.strictEqual(E.detectPattern(cards).pattern, "ladder");
  const same = [3, 3, 4, 5, 6].map((r, i) => card("ladv" + i, ["n"], { rank: r }));
  assert.strictEqual(E.detectPattern(same).pattern, "posFlush");
});

test("detects collocation with synonym trio and antonym pair", () => {
  const a = card("synone", ["n"], { syn: ["syntwo", "synthree"] });
  const b = card("syntwo", ["n"], { syn: ["synone", "synthree"] });
  const c = card("synthree", ["n"], { syn: ["synone", "syntwo"] });
  const d = card("antone", ["n"], { ant: ["anttwo"] });
  const e = card("anttwo", ["n"], { ant: ["antone"] });
  const r = E.detectPattern([a, b, c, d, e]);
  assert.strictEqual(r.pattern, "collocation");
  assert.deepStrictEqual(r.detail.trio, [0, 1, 2]);
  assert.deepStrictEqual(r.detail.pair, [3, 4]);
});

test("falls back to high card", () => {
  const cards = [card("alpha", ["interj"]), card("bravo", ["num"]), card("delta", ["aux"]), card("gamma", ["interj"]), card("omega", ["num"])];
  assert.strictEqual(E.detectPattern(cards).pattern, "high");
});

test("grammar relax relic allows 4 of 5", () => {
  const cards = [card("bigs", ["adj"]), card("cats", ["n"]), card("runs", ["v"]), card("fasts", ["adv"]), card("zzqx", ["num"])];
  assert.strictEqual(E.detectPattern(cards).pattern, "high");
  assert.strictEqual(E.detectPattern(cards, { relax: 1 }).pattern, "grammar");
});

// ---------- scoring ----------
test("high card score uses floor((base+card chips)*mult*clean 1.5)", () => {
  const run = soloRun();
  const detail = E.scoreHand(run, [card("cat", ["n"])], { pattern: "high", detail: {} });
  assert.strictEqual(detail.chips, 10);
  assert.strictEqual(detail.mult, 1);
  assert.strictEqual(detail.cleanMult, 1.5);
  assert.strictEqual(detail.score, 15);
});

test("hinted card contributes no chips and kills clean bonus", () => {
  const run = soloRun();
  const c = card("cat", ["n"], { hintedThisBlind: true });
  const detail = E.scoreHand(run, [c], { pattern: "high", detail: {} });
  assert.strictEqual(detail.chips, 5);
  assert.strictEqual(detail.cleanMult, 1);
  assert.strictEqual(detail.score, 5);
});

test("gold card multiplies x10", () => {
  const run = soloRun();
  const c = card("cat", ["n"], { gold: true });
  const detail = E.scoreHand(run, [c], { pattern: "high", detail: {} });
  assert.strictEqual(detail.goldMult, 10);
  assert.strictEqual(detail.score, 150);
});

test("pos chain gives +2 mult, letter chain doubles card chips", () => {
  const run = soloRun();
  const detail = E.scoreHand(run, [card("cat", ["n"]), card("trees", ["n"])], { pattern: "high", detail: {} });
  assert.strictEqual(detail.chain, 1);
  assert.strictEqual(detail.letterChain, 1);
  assert.strictEqual(detail.mult, 3);
  assert.strictEqual(detail.chips, 5 + 5 + 8 * 2);
});

test("wrong book chunks apply once then clear on success", () => {
  const run = soloRun();
  const c = card("cat", ["n"], { wrongBookChips: 50 });
  const detail = E.scoreHand(run, [c], { pattern: "high", detail: {} });
  assert.strictEqual(detail.chips, 5 + 5 + 50);
  run.hand = [c];
  E.playHand(run, [c.id], "auto");
  assert.strictEqual(c.wrongBookChips, 0);
});

test("prefix boost doubles later card chips", () => {
  const run = soloRun();
  const first = card("cats", ["n"], { enhancement: "prefixBoost" });
  const plain = E.scoreHand(run, [card("cats", ["n"]), card("trees", ["n"])], { pattern: "high", detail: {} });
  const boosted = E.scoreHand(run, [first, card("trees", ["n"])], { pattern: "high", detail: {} });
  assert.strictEqual(boosted.chips - plain.chips, 8);
});

test("interference resist keeps quarter of clean bonus after hint", () => {
  const run = soloRun({ relics: ["interference-resist"] });
  const hinted = card("cat", ["n"], { hintedThisBlind: true });
  const detail = E.scoreHand(run, [hinted], { pattern: "high", detail: {} });
  assert.strictEqual(detail.cleanMult, 1.25);
});

// ---------- relics ----------
test("flush tutor raises hand level", () => {
  const run = soloRun({ relics: ["flush-tutor"] });
  const cards = ["alpha", "bravo", "delta", "gamma", "omega"].map((w) => card(w, ["n"]));
  const detail = E.scoreHand(run, cards, { pattern: "posFlush", detail: {} });
  assert.strictEqual(detail.level, 2);
  assert.strictEqual(detail.chips, 30 + 15 + 5 * 8);
});

test("initial hunter earns money per letter chain", () => {
  const run = soloRun({ relics: ["initial-hunter"] });
  run.hand = [card("cat", ["n"]), card("trees", ["n"])];
  const money = run.money;
  const res = E.playHand(run, idsOf(run.hand), "auto");
  assert(res.ok);
  assert.strictEqual(run.money - money, 1);
});

test("lexicographer only pays for first-seen words", () => {
  const plain = soloRun();
  const run = soloRun({ relics: ["lexicographer"] });
  const w = card("newword", ["n"]);
  const a = E.scoreHand(plain, [card("newword", ["n"])], { pattern: "high", detail: {} });
  const b = E.scoreHand(run, [w], { pattern: "high", detail: {} });
  assert.strictEqual(b.chips - a.chips, 15);
  run.stats.wordsSeen["newword"] = 1;
  const c = E.scoreHand(run, [card("newword", ["n"])], { pattern: "high", detail: {} });
  assert.strictEqual(c.chips, a.chips);
});

test("synonym lens adds chips inside collocation trio", () => {
  const run = soloRun({ relics: ["synonym-lens"] });
  const cards = [card("synone", ["n"]), card("syntwo", ["n"]), card("synthree", ["n"]), card("antone", ["n"]), card("anttwo", ["n"])];
  const detail = E.scoreHand(run, cards, { pattern: "collocation", detail: { trio: [0, 1, 2], pair: [3, 4] } });
  const base = soloRun();
  const plain = E.scoreHand(base, cards.map((c) => card(c.w, ["n"])), { pattern: "collocation", detail: { trio: [0, 1, 2], pair: [3, 4] } });
  assert.strictEqual(detail.chips - plain.chips, 30);
});

// ---------- lifecycle ----------
test("clean streak arms vault at threshold", () => {
  const run = soloRun();
  const c = run.hand[0];
  c.cleanStreak = 2;
  const res = E.playHand(run, [c.id], "auto");
  assert(res.ok);
  assert(run.vault.includes(c));
  assert(res.events.some((e) => e.type === "vaulted"));
});

test("clean gold card is banked with gold success event", () => {
  const run = soloRun();
  const c = run.hand[0];
  c.gold = true;
  const res = E.playHand(run, [c.id], "auto");
  assert(run.vault.includes(c));
  assert(res.events.some((e) => e.type === "gold_success"));
});

test("broken gold card returns to discard pile", () => {
  const run = soloRun();
  const c = run.hand[0];
  c.gold = true;
  c.hintedThisBlind = true;
  const res = E.playHand(run, [c.id], "auto");
  assert(!run.vault.includes(c));
  assert(run.discardPile.includes(c));
  assert(res.events.some((e) => e.type === "gold_broken"));
});

test("deck stays conserved across blinds", () => {
  const run = E.createRun({ seed: 5, bank: bigBank(120) });
  run.target = 1;
  E.playHand(run, [run.hand[0].id], "auto");
  assert.strictEqual(run.phase, "settle");
  E.settleBlind(run);
  const nb = E.nextBlind(run);
  assert(nb.ok);
  assert.strictEqual(poolCount(run), 80);
});

// ---------- bosses ----------
test("blackout blocks hints", () => {
  const run = soloRun();
  run.blindType = "boss";
  run.blind.bossType = "blackout";
  assert.strictEqual(E.useHint(run, run.hand[0].id).ok, false);
});

test("decay blurs cards held through three plays", () => {
  const run = soloRun();
  run.ante = 3;
  run.blindType = "boss";
  E.startBlind(run);
  assert.strictEqual(run.blind.bossType, "decay");
  run.target = 1e9;
  for (let i = 0; i < 3; i++) E.playHand(run, [run.hand.find((c) => !c.blurred).id], "auto");
  const blurred = run.hand.filter((c) => c.blurred);
  assert(blurred.length > 0);
  const res = E.playHand(run, [blurred[0].id], "auto");
  assert.strictEqual(res.reason, "BLURRED");
});

test("surge opens with three gold cards and x1000 multiplies", () => {
  const run = soloRun();
  run.ante = 5;
  run.blindType = "boss";
  E.startBlind(run);
  assert.strictEqual(run.blind.bossType, "surge");
  assert(run.hand.slice(0, 3).every((c) => c.gold));
  run.target = 1e12;
  const res = E.playHand(run, idsOf(run.hand.slice(0, 3)), "auto");
  assert.strictEqual(res.detail.goldMult, 1000 ** 3);
  assert.strictEqual(run.blind.surgeVoid, false);
});

test("surge voids gold multiplier after a hinted gold card", () => {
  const run = soloRun();
  run.ante = 5;
  run.blindType = "boss";
  E.startBlind(run);
  run.target = 1e12;
  const g = run.hand.find((c) => c.gold);
  E.useHint(run, g.id);
  const res = E.playHand(run, [g.id], "auto");
  assert.strictEqual(res.detail.goldMult, 1);
  assert.strictEqual(run.blind.surgeVoid, true);
});

// ---------- economy / shop ----------
test("blind settle pays base, hands left, interest and clean bonus", () => {
  const run = E.createRun({ seed: 8, bank: bigBank(120) });
  run.target = 1;
  E.playHand(run, [run.hand[0].id], "auto");
  const money = run.money;
  const res = E.settleBlind(run);
  assert.strictEqual(res.gained, 4 + 3 + 0 + 2);
  assert.strictEqual(run.money - money, 9);
  assert.strictEqual(run.phase, "shop");
  assert.strictEqual(run.shop.offers.length, 4);
});

test("shop buy, refresh limit and erase work", () => {
  const run = E.createRun({ seed: 9, bank: bigBank(120) });
  run.target = 1;
  E.playHand(run, [run.hand[0].id], "auto");
  E.settleBlind(run);
  run.money = 100;
  const first = run.shop.offers[0];
  const res = E.buy(run, 0);
  assert(res.ok);
  assert(res.offer.type === "relic");
  assert(run.relics.includes(first.id));
  assert.strictEqual(run.shop.offers[0].type, "sold");

  run.money = 100;
  assert(E.refreshShop(run).ok);
  assert(E.refreshShop(run).ok);
  assert(E.refreshShop(run).ok);
  assert.strictEqual(E.refreshShop(run).reason, "MAX_REFRESH");

  run.money = 100;
  run.shop.offers[3] = { type: "erase", id: "erase", name: "词库剔除", desc: "", price: 3 };
  const before = run.deck.length;
  const er = E.eraseCard(run, run.deck[0].id);
  assert(er.ok);
  assert.strictEqual(run.deck.length, before - 1);
});

test("next blind advances small -> big -> boss -> ante", () => {
  const run = E.createRun({ seed: 10, bank: bigBank(120) });
  run.phase = "shop";
  assert.strictEqual(E.nextBlind(run).blindType, "big");
  run.phase = "shop";
  assert.strictEqual(E.nextBlind(run).blindType, "boss");
  run.phase = "shop";
  const r = E.nextBlind(run);
  assert.strictEqual(r.ante, 2);
  assert.strictEqual(r.blindType, "small");
});

test("upgrade purchase consumes crystals and applies effect", () => {
  const profile = E.defaultProfile();
  profile.crystals = 10;
  const r = E.buyUpgrade(profile, "memory");
  assert(r.ok);
  assert.strictEqual(profile.crystals, 7);
  assert.strictEqual(profile.upgrades.memory, 1);
  const eff = E.upgradeEffects(profile);
  assert.strictEqual(eff.vaultThreshold, -1);
  assert.strictEqual(E.buyUpgrade(profile, "nope").reason, "BAD_LINE");
});

// ---------- consumables ----------
test("synonym scroll swaps to a same synGroup card", () => {
  const run = soloRun();
  run.consumables = ["synonym-scroll"];
  const target = run.hand[0];
  target.synGroup = 42;
  const mate = card("matetwin", ["n"], { synGroup: 42 });
  run.drawPile.push(mate);
  const res = E.useConsumable(run, 0, target.id);
  assert(res.ok);
  assert(run.hand.some((c) => c.id === mate.id));
  assert(run.discardPile.some((c) => c.id === target.id));
});

test("derive scroll rotates multi-pos and rejects single-pos", () => {
  const run = soloRun();
  run.consumables = ["derive-scroll"];
  const target = run.hand[0];
  target.posPlayable = ["n", "v"];
  target.pos = ["n", "v"];
  const res = E.useConsumable(run, 0, target.id);
  assert(res.ok);
  assert.deepStrictEqual(target.posPlayable, ["v", "n"]);
  run.consumables = ["derive-scroll"];
  target.posPlayable = ["n"];
  const bad = E.useConsumable(run, 0, target.id);
  assert.strictEqual(bad.reason, "NO_MULTI_POS");
  assert.strictEqual(run.consumables.length, 1);
});

test("gold foil forces the card into the next blind", () => {
  const run = soloRun();
  run.consumables = ["gold-foil"];
  const target = run.hand[0];
  const res = E.useConsumable(run, 0, target.id);
  assert(res.ok);
  assert(run.vault.some((c) => c.id === target.id && c.gold));
  E.startBlind(run);
  assert(run.hand.some((c) => c.id === target.id && c.gold));
});

test("manual consumables raise hand levels", () => {
  const run = soloRun();
  const before = Object.assign({}, run.levels);
  for (const id of ["flush-manual", "grammar-manual", "ladder-manual", "collocation-manual"]) {
    run.consumables = [id];
    assert(E.useConsumable(run, 0).ok, id);
  }
  assert.strictEqual(run.levels.posFlush, before.posFlush + 1);
  assert.strictEqual(run.levels.grammar, before.grammar + 1);
  assert.strictEqual(run.levels.ladder, before.ladder + 1);
  assert.strictEqual(run.levels.collocation, before.collocation + 1);
});

// ---------- full run ----------
test("scripted run reaches victory at ante 8 boss", () => {
  const run = E.createRun({ seed: 123, bank: bigBank(200) });
  let guard = 0;
  while (run.phase !== "victory" && run.phase !== "gameover" && guard++ < 2000) {
    if (run.phase === "blind") {
      run.target = 1;
      const ids = run.hand.filter((c) => !c.blurred).slice(0, 5).map((c) => c.id);
      if (!ids.length) break;
      const res = E.playHand(run, ids, "auto");
      assert(res.ok, "play failed: " + res.reason);
    } else if (run.phase === "settle") {
      E.settleBlind(run);
    } else if (run.phase === "shop") {
      const nb = E.nextBlind(run);
      assert(nb.ok, "nextBlind failed: " + nb.reason);
    } else {
      break;
    }
  }
  assert.strictEqual(run.phase, "victory");
  assert(run.profile.crystals > 0);
  assert.strictEqual(run.profile.runs, 1);
  assert(Object.keys(run.profile.seenWords).length > 0);
});

// ---------- report ----------
if (failures.length) {
  console.error("FAIL " + failures.length + " / " + (passed + failures.length));
  for (const f of failures) {
    console.error("\nFAILED: " + f.name);
    console.error(f.err && f.err.stack ? f.err.stack : f.err);
  }
  process.exit(1);
}
console.log("PASS " + passed + "/" + passed);
