import test from "node:test";
import assert from "node:assert/strict";
import {
  chainTotal,
  challenge,
  createGame,
  getAIView,
  play,
  publicState,
  resolveChallenge,
  resolveRoulette,
  startNextRound,
} from "../src/core/engine.js";
import { PHASE } from "../src/core/constants.js";
import { makeBank, makeTopic, card, stubRoulette } from "./fixture.js";

function newGame(extra = {}) {
  return createGame({
    seed: "engine-seed",
    difficulty: "normal",
    band: "hs",
    topic: makeTopic(),
    bankIndex: makeBank(),
    ...extra,
  });
}

function setHand(state, seat, cards) {
  state.players[seat].alive = true;
  state.players[seat].hand = cards;
}

function begin(state, seat) {
  state.phase = PHASE.TURN;
  state.currentPlayer = seat;
  state.chain = [];
}

test("play requires the current player and valid cards", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("a"), card("b")]);
  assert.throws(() => play(state, 2, ["a"]), /not your turn/);
  assert.throws(() => play(state, 1, []), /1-3/);
  assert.throws(() => play(state, 1, ["a", "a"]), /duplicate/);
  assert.throws(() => play(state, 1, ["zzz"]), /not in hand/);
  const result = play(state, 1, ["a"]);
  assert.equal(result.emptied, false);
  assert.equal(state.currentPlayer, 2);
  assert.equal(state.players[1].hand.length, 1);
  assert.equal(state.chain.length, 1);
  assert.equal(state.log.at(-1).t, "play");
});

test("joker does not count toward K", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("j", { joker: true }), card("lie", { truth: false })]);
  play(state, 1, ["j", "lie"]);
  assert.equal(state.chain[0].claimed, 1);
  assert.equal(chainTotal(state), 1);
});

test("a joker-only claim is challengeable and penalizes the challenger", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("j", { joker: true }), card("spare")]);
  play(state, 1, ["j"]);
  assert.equal(state.currentPlayer, 2);
  const pending = challenge(state, 2);
  assert.deepEqual(pending.cards.map((c) => c.id), ["j"]);
  assert.equal(state.pendingChallenge.answerCards.length, 0);
  const resolved = resolveChallenge(state, {});
  assert.equal(resolved.isLie, false);
  assert.equal(resolved.penalized, 2);
  assert.equal(state.phase, PHASE.ROULETTE);
});

test("emptying the hand keeps the round going while others hold cards", () => {
  const state = newGame();
  begin(state, 0);
  setHand(state, 0, [card("a")]);
  const result = play(state, 0, ["a"]);
  assert.equal(result.emptied, true);
  assert.equal(state.phase, PHASE.TURN);
  assert.equal(state.currentPlayer, 1, "turn passes to the next player with cards");
  assert.equal(state.roundEnd, null);
});

test("only players with cards act; the last holder plays out alone", () => {
  const state = newGame();
  for (const seat of [0, 2, 3]) setHand(state, seat, []);
  begin(state, 1);
  setHand(state, 1, [card("a"), card("b")]);
  play(state, 1, ["a"]);
  assert.equal(state.currentPlayer, 1, "the only player with cards keeps the turn");
  const result = play(state, 1, ["b"]);
  assert.equal(result.emptied, true);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "empty");
  assert.equal(state.roundEnd.nextStarter, 1);
});

test("all hands empty ends the round after the final play", () => {
  const state = newGame();
  for (const seat of [0, 1, 2, 3]) setHand(state, seat, []);
  begin(state, 2);
  setHand(state, 2, [card("a")]);
  const result = play(state, 2, ["a"]);
  assert.equal(result.emptied, true);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "empty");
  assert.equal(state.roundEnd.nextStarter, 2);
  assert.equal(state.human.survived, 1);
});

test("an emptied player can still be challenged", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false })]);
  const result = play(state, 1, ["lie"]);
  assert.equal(result.emptied, true);
  assert.equal(state.currentPlayer, 2);
  const pending = challenge(state, 2);
  assert.equal(pending.targetId, 1);
  assert.deepEqual(pending.answerers, [0, 2, 3]);
});

test("lying target is penalized and starts the next round after a survived shot", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false }), card("spare")]);
  play(state, 1, ["lie"]);
  assert.equal(state.currentPlayer, 2);
  const pending = challenge(state, 2);
  assert.deepEqual(pending.answerers, [0, 2, 3]);
  assert.deepEqual(pending.cards.map((c) => c.id), ["lie"]);
  const resolved = resolveChallenge(state, {
    0: { lie: false },
    2: { lie: false },
    3: { lie: false },
  });
  assert.equal(resolved.isLie, true);
  assert.equal(resolved.penalized, 1);
  assert.equal(state.human.correctAnswers, 1);
  assert.equal(state.human.wrongAnswers, 0);
  assert.equal(state.human.catches, 0);
  assert.equal(state.phase, PHASE.ROULETTE);
  stubRoulette(state, [5]);
  const shot = resolveRoulette(state);
  assert.equal(shot.fire, false);
  assert.equal(shot.probability, "1/6");
  assert.equal(state.players[1].pulls, 1);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "roulette");
  assert.equal(state.roundEnd.nextStarter, 1, "the penalized player starts the next round");
  assert.equal(state.chain.length, 0);
  assert.equal(state.pendingChallenge, null);
  assert.equal(state.revealed.length, 1);
  assert.equal(state.discard.length, 1);
});

test("honest play still penalizes the challenger", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("ok"), card("spare")]);
  play(state, 1, ["ok"]);
  challenge(state, 2);
  const resolved = resolveChallenge(state, { 0: { ok: true }, 2: { ok: true }, 3: { ok: true } });
  assert.equal(resolved.isLie, false);
  assert.equal(resolved.penalized, 2);
  assert.equal(state.human.correctAnswers, 1);
  stubRoulette(state, [5]);
  resolveRoulette(state);
  assert.equal(state.players[2].pulls, 1);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "roulette");
  assert.equal(state.roundEnd.nextStarter, 2, "penalized challenger starts the next round");
});

test("timeout counts as wrong answers and adds review words", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false }), card("spare")]);
  play(state, 1, ["lie"]);
  challenge(state, 2);
  const resolved = resolveChallenge(state, {});
  assert.equal(state.human.wrongAnswers, 1);
  assert.equal(state.human.correctAnswers, 0);
  assert.deepEqual(resolved.learning[0], ["lie"]);
  assert.equal(resolved.results[0].correctCount, 0);
  assert.equal(resolved.results[0].rows[0].answer, null);
});

test("human target has no answer window, and a bullet ends the game", () => {
  const state = newGame();
  begin(state, 0);
  setHand(state, 0, [card("lie", { truth: false }), card("spare")]);
  play(state, 0, ["lie"]);
  challenge(state, 1);
  const resolved = resolveChallenge(state, {});
  assert.equal(resolved.penalized, 0);
  assert.equal(state.human.wrongAnswers, 0);
  assert.equal(state.human.correctAnswers, 0);
  stubRoulette(state, [0]);
  const shot = resolveRoulette(state);
  assert.equal(shot.fire, true);
  assert.equal(state.phase, PHASE.GAME_END);
  assert.equal(state.result.placement, 4);
  assert.equal(state.result.crystals, 20);
  assert.equal(state.result.reason, "hit");
  assert.equal(state.players[0].alive, false);
  assert.equal(state.players[0].hit, true);
});

test("human placement 2 when one AI is left", () => {
  const state = newGame();
  state.players[2].alive = false;
  state.players[3].alive = false;
  begin(state, 0);
  setHand(state, 0, [card("lie", { truth: false }), card("spare")]);
  play(state, 0, ["lie"]);
  challenge(state, 1);
  resolveChallenge(state, {});
  stubRoulette(state, [0]);
  resolveRoulette(state);
  assert.equal(state.result.placement, 2);
  assert.equal(state.result.crystals, 60);
});

test("AI elimination aborts the round; successful challenger goes next", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false }), card("spare")]);
  play(state, 1, ["lie"]);
  challenge(state, 2);
  resolveChallenge(state, { 0: { lie: false } });
  stubRoulette(state, [0]);
  const shot = resolveRoulette(state);
  assert.equal(shot.fire, true);
  assert.equal(state.players[1].alive, false);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "elimination");
  assert.equal(state.roundEnd.eliminated, 1);
  assert.equal(state.roundEnd.nextStarter, 2);
  const built = startNextRound(state, {
    topic: makeTopic("topic-2"),
    starter: state.roundEnd.nextStarter,
  });
  assert.equal(state.round, 2);
  assert.equal(state.phase, PHASE.TURN);
  assert.equal(state.currentPlayer, 2);
  assert.ok(built.hands.every((hand) => hand.length === 5));
  assert.equal(state.players[1].hand.length, 0);
  assert.equal(state.players[1].pulls, 1, "pull count persists across rounds");
});

test("challenger death hands the next round to the honest target", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("ok"), card("spare")]);
  play(state, 1, ["ok"]);
  challenge(state, 2);
  resolveChallenge(state, {});
  stubRoulette(state, [0]);
  resolveRoulette(state);
  assert.equal(state.players[2].alive, false);
  assert.equal(state.roundEnd.eliminated, 2);
  assert.equal(state.roundEnd.nextStarter, 1);
});

test("last surviving human wins placement 1", () => {
  const state = newGame();
  state.players[2].alive = false;
  state.players[3].alive = false;
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false }), card("spare")]);
  play(state, 1, ["lie"]);
  challenge(state, 0);
  resolveChallenge(state, { 0: { lie: false } });
  stubRoulette(state, [0]);
  resolveRoulette(state);
  assert.equal(state.players[1].alive, false);
  assert.equal(state.phase, PHASE.GAME_END);
  assert.equal(state.result.placement, 1);
  assert.equal(state.result.crystals, 100);
  assert.equal(state.result.reason, "last");
  assert.equal(state.players[0].alive, true);
});

test("roulette probability escalates per player", () => {
  const state = newGame();
  stubRoulette(state, [5, 1]);
  begin(state, 1);
  setHand(state, 1, [card("lie1", { truth: false }), card("spare1")]);
  play(state, 1, ["lie1"]);
  challenge(state, 2);
  resolveChallenge(state, { 0: { lie1: false } });
  const first = resolveRoulette(state);
  assert.equal(first.probability, "1/6");
  assert.equal(first.fire, false);
  assert.equal(state.players[1].pulls, 1);
  assert.equal(state.phase, PHASE.ROUND_END);
  assert.equal(state.roundEnd.reason, "roulette");

  startNextRound(state, { topic: makeTopic("topic-2"), starter: 1 });
  setHand(state, 1, [card("lie2", { truth: false }), card("spare2")]);
  play(state, 1, ["lie2"]);
  challenge(state, 2);
  resolveChallenge(state, { 0: { lie2: false } });
  const second = resolveRoulette(state);
  assert.equal(second.probability, "2/6");
  assert.equal(second.fire, true, "draw 1 < 2");
  assert.equal(state.players[1].alive, false);
});

test("cannot challenge with an empty chain", () => {
  const state = newGame();
  begin(state, 1);
  assert.throws(() => challenge(state, 1), /nothing to challenge/);
});

test("public state and AI view hide secrets", () => {
  const state = newGame({ reviewWords: ["bravo"] });
  assert.ok(state.players[0].hand.some((c) => c.w === "bravo"));
  assert.deepEqual(state.injectedReviewWords, ["bravo"]);

  const pub = publicState(state);
  assert.equal(pub.topic.target, undefined);
  assert.equal(pub.players[1].hand, undefined);
  assert.ok(Array.isArray(pub.players[0].hand));
  assert.equal(pub.pendingChallenge, null);

  const view = getAIView(state, 1);
  assert.ok(view.self.hand.every((c) => c.truth === undefined));
  assert.equal(view.players[0].hand, undefined);
  assert.equal(view.topic.target, undefined);
  assert.ok(!("held" in view));
});

test("unresolved challenge truth stays hidden in public state", () => {
  const state = newGame();
  begin(state, 1);
  setHand(state, 1, [card("lie", { truth: false }), card("spare")]);
  play(state, 1, ["lie"]);
  challenge(state, 2);
  const pub = publicState(state);
  assert.equal(pub.pendingChallenge.cards[0].truth, undefined);
  assert.deepEqual(pub.pendingChallenge.humanAnswers.map((c) => c.w), ["lie"]);
  resolveChallenge(state, {});
  const after = publicState(state);
  assert.equal(after.pendingChallenge.cards[0].truth, false);
  assert.equal(after.pendingChallenge.isLie, true);
  assert.equal(after.pendingChallenge.penalized, 1);
});
