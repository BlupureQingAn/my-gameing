import test from "node:test";
import assert from "node:assert/strict";
import { buildRoundDeck } from "../src/core/deck.js";
import { createStreams } from "../src/core/rng.js";
import { makeBank, makeTopic, sizes } from "./fixture.js";

function build({ reviewWords = [], seed = "deck-seed", round = 1 } = {}) {
  return buildRoundDeck({
    topic: makeTopic(),
    bankIndex: makeBank(),
    rng: createStreams(seed).deck,
    reviewWords,
    round,
  });
}

test("deck has 24 cards: 6 truth, 17 lies, 1 joker", () => {
  const built = build();
  assert.equal(built.cards.length, sizes.DECK_SIZE);
  const jokers = built.cards.filter((c) => c.joker);
  assert.equal(jokers.length, 1);
  assert.equal(built.cards.filter((c) => !c.joker && c.truth).length, 6);
  assert.equal(built.cards.filter((c) => !c.joker && !c.truth).length, 17);
});

test("deal 20, bury 4 without joker, hands of 5", () => {
  const built = build();
  assert.equal(built.cards.length - built.held.length, sizes.DEAL_SIZE);
  assert.equal(built.held.length, sizes.BURY_SIZE);
  assert.ok(built.held.every((c) => !c.joker));
  assert.equal(built.hands.length, 4);
  for (const hand of built.hands) assert.equal(hand.length, sizes.HAND_SIZE);
  const dealt = built.hands.flat();
  assert.equal(dealt.length, sizes.DEAL_SIZE);
  assert.equal(new Set(dealt.map((c) => c.id)).size, sizes.DEAL_SIZE);
  assert.ok(dealt.some((c) => c.joker));
});

test("deterministic for the same seed", () => {
  const a = build({ seed: "same" });
  const b = build({ seed: "same" });
  assert.deepEqual(
    a.hands.map((h) => h.map((c) => c.id)),
    b.hands.map((h) => h.map((c) => c.id)),
  );
  const c = build({ seed: "other" });
  assert.notDeepEqual(
    a.hands.map((h) => h.map((c2) => c2.id)),
    c.hands.map((h) => h.map((c2) => c2.id)),
  );
});

test("review words are never buried and go to the human hand first", () => {
  const words = ["reviewone", "reviewtwo", "reviewthree"];
  const built = build({ reviewWords: words });
  const reviewCards = built.cards.filter((c) => c.review);
  assert.equal(reviewCards.length, 3);
  for (const word of words) {
    assert.ok(reviewCards.some((c) => c.w === word), `missing review card ${word}`);
  }
  assert.ok(built.held.every((c) => !c.review));
  for (const word of words) {
    assert.ok(built.hands[0].some((c) => c.w === word), `human hand missing ${word}`);
  }
});

test("compliant review words keep truth=true and the topic target stays unreviewed", () => {
  const built = build({ reviewWords: ["bravo", "alpha"] });
  const bravo = built.cards.find((c) => c.w === "bravo");
  assert.equal(bravo.review, true);
  assert.equal(bravo.truth, true);
  assert.equal(built.cards.find((c) => c.w === "alpha").review, false);
});

test("review count is capped at MAX_REVIEW_WORDS", () => {
  const words = ["alpha", "bravo", "reviewone", "reviewtwo", "reviewthree", "d01", "d02"];
  const built = build({ reviewWords: words });
  assert.ok(built.cards.filter((c) => c.review).length <= sizes.MAX_REVIEW_WORDS);
});

test("deck rejects topics without exactly 6 compliant words", () => {
  const topic = makeTopic();
  topic.compliant = topic.compliant.slice(0, 5);
  assert.throws(() => buildRoundDeck({
    topic,
    bankIndex: makeBank(),
    rng: createStreams("x").deck,
  }), /exactly 6 compliant/);
});
