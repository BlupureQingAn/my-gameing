import test from "node:test";
import assert from "node:assert/strict";
import { GameSession, canHumanChallenge } from "../src/game/session.js";
import { makeBank, makeTopic } from "./fixture.js";

function makeView({ chain = [], players = [{ id: 0, alive: true }, { id: 1, alive: true }] } = {}) {
  return { chain, players };
}

test("a joker-only opponent claim still exposes the challenge action", () => {
  const view = makeView({
    chain: [{ player: 1, claimed: 0, count: 1 }],
  });
  assert.equal(canHumanChallenge(view), true);
});

test("challenge is hidden without a prior play or after the human's own play", () => {
  assert.equal(canHumanChallenge(makeView()), false);
  assert.equal(canHumanChallenge(makeView({
    chain: [{ player: 0, claimed: 1, count: 1 }],
  })), false);
});

test("challenge is hidden when the last player is out", () => {
  const view = makeView({
    chain: [{ player: 1, claimed: 1, count: 1 }],
    players: [{ id: 0, alive: true }, { id: 1, alive: false }],
  });
  assert.equal(canHumanChallenge(view), false);
});

test("session skips topics whose words are missing from the bank", () => {
  const good = makeTopic("good");
  const bad = makeTopic("bad");
  bad.distractors.push("ghostword");
  const bank = makeBank();
  const data = {
    words: Object.values(bank).map((item) => [item.w, item.ipa, "n", item.zh, item.def, 1]),
    topics: [bad, good],
  };
  for (let i = 0; i < 20; i += 1) {
    const session = new GameSession({ data, band: "hs", difficulty: "normal", seed: `filter-${i}` });
    assert.equal(session.state.topic.id, "good");
  }
});
