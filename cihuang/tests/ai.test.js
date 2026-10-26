import test from "node:test";
import assert from "node:assert/strict";
import { AIPlayer } from "../src/core/ai.js";
import { MAX_PLAY } from "../src/core/constants.js";
import { makeBank, makeTopic } from "./fixture.js";

function makeAI(extra = {}) {
  return new AIPlayer({
    seat: 1,
    difficulty: "normal",
    seed: "ai-seed",
    bankIndex: makeBank(),
    topic: makeTopic(),
    ...extra,
  });
}

function handOf(words) {
  return words.map((w, i) => ({ id: `h${i}`, w, joker: w === "JOKER" }));
}

function viewOf({ hand, chain = [], x = 0, players, revealed = [], pulls = 0 }) {
  const seat = 1;
  return {
    seat,
    self: { hand, pulls, alive: true },
    players: players || [
      { id: 0, alive: true, handCount: 5, pulls: 0 },
      { id: 1, alive: true, handCount: hand.length, pulls },
      { id: 2, alive: true, handCount: 5, pulls: 0 },
      { id: 3, alive: true, handCount: 5, pulls: 0 },
    ],
    chain,
    x,
    revealed,
    topic: { k: 6 },
  };
}

test("judge is consistent and true when both words are known", () => {
  const ai = makeAI();
  ai.knows = () => true;
  assert.equal(ai.judge("alpha"), true);
  assert.equal(ai.judge("d01"), false);
  assert.equal(ai.judge("alpha"), true);
  assert.equal(ai.judge("JOKER"), true);
});

test("answers only cover non-joker cards", () => {
  const ai = makeAI();
  ai.knows = () => true;
  const answers = ai.answerCards([
    { id: "a", w: "alpha" },
    { id: "b", w: "d01" },
    { id: "j", w: "JOKER", joker: true },
  ]);
  assert.deepEqual(answers, { a: true, b: false });
});

test("AI always plays 1-3 cards and empties when it can win", () => {
  const ai = makeAI();
  ai.knows = () => true;
  const hand = handOf(["alpha", "bravo", "d01", "d02", "d03"]);
  const action = ai.choosePlay(viewOf({ hand }));
  assert.equal(action.type, "play");
  assert.ok(action.cardIds.length >= 1 && action.cardIds.length <= MAX_PLAY);
  for (const id of action.cardIds) assert.ok(hand.some((c) => c.id === id));

  const winning = ai.choosePlay(viewOf({ hand: handOf(["d01", "d02", "d03"]) }));
  assert.deepEqual(winning.cardIds.sort(), ["h0", "h1", "h2"]);
});

test("forced lie uses only cards from hand", () => {
  const ai = makeAI();
  ai.judge = () => false;
  const hand = handOf(["d01", "d02", "d03", "d04", "d05"]);
  const action = ai.choosePlay(viewOf({ hand }));
  assert.ok(action.cardIds.length >= 1 && action.cardIds.length <= MAX_PLAY);
  assert.ok(action.cardIds.every((id) => hand.some((c) => c.id === id)));
});

test("challenge refuses empty chains, joker-only claims, and short hands", () => {
  const ai = makeAI();
  assert.equal(ai.chooseChallenge(viewOf({ hand: handOf(["d01", "d02", "d03", "d04", "d05"]) })), false);
  const chain = [{ player: 0, claimed: 2, challenged: false }];
  const jokerOnly = [{ player: 0, claimed: 0, challenged: false }];
  assert.equal(ai.chooseChallenge(viewOf({
    hand: handOf(["d01", "d02", "d03", "d04", "d05"]),
    chain: jokerOnly,
    x: 0,
  })), false);
  const shortHand = ai.chooseChallenge(viewOf({
    hand: handOf(["d01", "d02", "d03"]),
    chain,
    x: 2,
  }));
  assert.equal(shortHand, false, "with <= MAX_PLAY cards the AI plays out instead");
});

test("AI can challenge a target that has already emptied their hand", () => {
  const ai = makeAI();
  ai.estimateLie = () => 0.95;
  const chain = [{ player: 2, claimed: 2, challenged: false }];
  const players = [
    { id: 0, alive: true, handCount: 5, pulls: 0 },
    { id: 1, alive: true, handCount: 5, pulls: 0 },
    { id: 2, alive: true, handCount: 0, pulls: 0 },
    { id: 3, alive: true, handCount: 5, pulls: 0 },
  ];
  const view = viewOf({
    hand: handOf(["d01", "d02", "d03", "d04", "d05"]),
    chain,
    x: 4,
    players,
  });
  assert.equal(ai.chooseChallenge(view), true);
});

test("normal AI challenges a very likely lie", () => {
  const ai = makeAI();
  ai.estimateLie = () => 0.95;
  const chain = [{ player: 2, claimed: 3, challenged: false }];
  const view = viewOf({ hand: handOf(["d01", "d02", "d03", "d04", "d05"]), chain, x: 5 });
  assert.equal(ai.chooseChallenge(view), true);
});

test("easy AI follows the X/K heuristic", () => {
  const ai = makeAI({ difficulty: "easy" });
  const chain = [{ player: 2, claimed: 2, challenged: false }];
  ai.rng = { next: () => 0, int: () => 0 };
  assert.equal(ai.chooseChallenge(viewOf({
    hand: handOf(["d01", "d02", "d03", "d04", "d05"]),
    chain,
    x: 6,
  })), true);
  ai.rng = { next: () => 0.9, int: () => 0 };
  assert.equal(ai.chooseChallenge(viewOf({
    hand: handOf(["d01", "d02", "d03", "d04", "d05"]),
    chain,
    x: 1,
  })), false);
});

test("lie estimate reacts to joker-only segments and overclaiming", () => {
  const ai = makeAI();
  ai.knows = () => true;
  const hand = handOf(["alpha", "bravo", "charlie", "delta", "echo"]);
  const low = ai.estimateLie(viewOf({
    hand,
    chain: [{ player: 0, claimed: 0, challenged: false }],
    x: 0,
  }));
  assert.ok(low < 0.1);
  const high = ai.estimateLie(viewOf({
    hand,
    chain: [{ player: 0, claimed: 3, challenged: false }],
    x: 9,
  }));
  assert.ok(high > 0.5);
});

test("AI picks the topic it knows best", () => {
  const ai = makeAI();
  const good = { ...makeTopic("good"), target: "alpha", compliant: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"] };
  const bad = { ...makeTopic("bad"), target: "alpha", compliant: ["alpha", "bravo", "charlie", "delta", "echo", "x"] };
  ai.judge = (word, target, compliant) => compliant.includes(word) && word !== "x";
  const chosen = ai.chooseTopic([bad, good]);
  assert.equal(chosen.id, "good");
});

test("challenge results feed the per-player memory", () => {
  const ai = makeAI();
  ai.noteChallengeResult({ targetId: 2, isLie: true });
  ai.noteChallengeResult({ targetId: 2, isLie: false });
  assert.equal(ai.memory.challenges[2], 2);
  assert.equal(ai.memory.lies[2], 1);
});

test("frequency bonus raises effective accuracy and clamps", () => {
  const bank = makeBank();
  bank.rare = { w: "rare", freq: 0 };
  bank.common = { w: "common", freq: 100 };
  const ai = makeAI({ bankIndex: { ...bank }, difficulty: "hard" });
  assert.equal(ai.accuracy("rare"), 0.85);
  assert.equal(ai.accuracy("common"), 0.95);
});
