import test from "node:test";
import assert from "node:assert/strict";
import {
  addAuto,
  addManual,
  emptyBook,
  pickReviewWords,
  recordAnswer,
  removeWord,
  vocabStats,
} from "../src/core/vocab.js";
import { crystalsFor, placementFor, scoreBreakdown, settlementText } from "../src/core/score.js";
import { TopicPicker } from "../src/core/topic.js";
import { createStreams } from "../src/core/rng.js";

test("vocab entries track source and two correct answers master a word", () => {
  const book = emptyBook();
  const first = addAuto(book, {
    w: "alpha", ipa: "/a/", pos: ["n"], zh: "甲", def: "first",
  }, { band: "hs", topicType: "synonym", topicPrompt: "题面" }, 1000);
  assert.equal(first.added, true);
  assert.equal(book.alpha.source, "auto");
  assert.equal(book.alpha.streak, 0);
  assert.equal(book.alpha.band, "hs");

  const wrong = recordAnswer(book, "alpha", false, 2000);
  assert.equal(wrong.tracked, true);
  assert.equal(wrong.mastered, false);
  assert.equal(book.alpha.reviews, 1);
  assert.equal(book.alpha.lastResult, false);

  recordAnswer(book, "alpha", true, 3000);
  assert.equal(book.alpha.streak, 1);
  const mastered = recordAnswer(book, "alpha", true, 4000);
  assert.equal(mastered.mastered, true);
  assert.equal(book.alpha, undefined);
});

test("duplicate adds reset the streak and manual entries are marked", () => {
  const book = emptyBook();
  addManual(book, { w: "bravo", zh: "乙" }, {}, 1000);
  assert.equal(book.bravo.source, "manual");
  recordAnswer(book, "bravo", true, 2000);
  assert.equal(book.bravo.streak, 1);
  const again = addAuto(book, { w: "bravo", zh: "乙" }, {}, 3000);
  assert.equal(again.reset, true);
  assert.equal(book.bravo.streak, 0);
  assert.equal(book.bravo.updatedAt, 3000);
  assert.equal(removeWord(book, "bravo"), true);
  assert.equal(removeWord(book, "bravo"), false);
});

test("review words prefer the least reviewed and oldest entries", () => {
  const book = emptyBook();
  for (const [word, reviews, updatedAt] of [
    ["a", 2, 3000], ["b", 0, 5000], ["c", 1, 4000], ["d", 0, 2000],
  ]) {
    addAuto(book, { w: word }, {}, updatedAt);
    book[word].reviews = reviews;
    book[word].updatedAt = updatedAt;
  }
  assert.deepEqual(pickReviewWords(book, 3), ["d", "b", "c"]);
  assert.equal(pickReviewWords(book, 3, new Set(["d"])).length, 3);
  assert.deepEqual(pickReviewWords(book, 3, new Set(["d"]))[0], "b");
  assert.deepEqual(vocabStats(book).total, 4);
});

test("score and crystal tables follow the PRD", () => {
  assert.equal(placementFor(0), 1);
  assert.equal(placementFor(2), 2);
  assert.equal(placementFor(5), 4);
  assert.equal(crystalsFor(1), 100);
  assert.equal(crystalsFor(4), 20);
  assert.equal(crystalsFor(null), 0);
  const breakdown = scoreBreakdown({ placement: 1, catches: 2, bluffs: 1, survived: 3 });
  assert.equal(breakdown.total, 1180);
  assert.equal(breakdown.catchPoints, 100);
  assert.equal(breakdown.bluffPoints, 50);
  assert.equal(breakdown.survivePoints, 30);
  assert.ok(settlementText(1).length > 0);
  assert.ok(settlementText(null).length > 0);
});

function makeTopics(count = 12) {
  const types = ["definition", "synonym"];
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    groupId: `g${i + 1}`,
    type: types[i % 2],
    prompt: `题面${i + 1}`,
    level: (i % 3) + 1,
    compliant: ["a", "b", "c", "d", "e", "f"],
  }));
}

test("topic picker returns unique candidates and honors recent history", () => {
  const topics = makeTopics(12);
  const picker = new TopicPicker({
    topics,
    difficulty: "normal",
    rng: createStreams("topics").topics,
  });
  const first = picker.initial();
  assert.ok(first && first.id);
  assert.ok(picker.isRecent(first));
  const candidates = picker.candidates(3);
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map((t) => t.id)).size, 3);
  assert.ok(candidates.every((t) => !picker.isRecent(t)));

  for (let i = 0; i < 12; i += 1) picker.markUsed(topics[i]);
  const fallback = picker.candidates(3);
  assert.equal(fallback.length, 3, "falls back when every topic is recent");
  const chosen = picker.pickForAI(candidates, (t) => t.level);
  assert.ok(chosen);
});

test("topic picker ignores malformed topics", () => {
  const topics = [
    ...makeTopics(6),
    { id: "bad", type: "synonym", compliant: ["a"] },
    { id: "bad2", type: "weird", compliant: ["a", "b", "c", "d", "e", "f"] },
  ];
  const picker = new TopicPicker({
    topics,
    difficulty: "easy",
    rng: createStreams("bad").topics,
  });
  assert.equal(picker.topics.length, 6);
  assert.ok(picker.initial());
});
