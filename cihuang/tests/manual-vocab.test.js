import test from "node:test";
import assert from "node:assert/strict";
import { LOOKUP_COST, MAX_REVIEW_WORDS } from "../src/core/constants.js";
import { mergeReviewWords, pickManualReviewWords } from "../src/core/vocab.js";

function entry(w, overrides = {}) {
  return {
    w,
    band: "hs",
    source: "manual",
    streak: 0,
    deleted: false,
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...overrides,
  };
}

test("manual review snapshot keeps current-band live manual words and orders by recency", () => {
  const entries = [
    entry("alpha", { updatedAt: "2026-10-26T10:00:00.000Z" }),
    entry("beta", { streak: 1, updatedAt: "2026-10-26T11:00:00.000Z" }),
    entry("gamma", { streak: 2, updatedAt: "2026-10-26T12:00:00.000Z" }),
    entry("delta", { band: "cet4", updatedAt: "2026-10-26T13:00:00.000Z" }),
    entry("epsilon", { source: "auto", updatedAt: "2026-10-26T14:00:00.000Z" }),
    entry("zeta", { deleted: true, updatedAt: "2026-10-26T15:00:00.000Z" }),
  ];
  assert.deepEqual(pickManualReviewWords(entries, "hs", 5), ["beta", "alpha"]);
  assert.deepEqual(pickManualReviewWords(entries, "cet4", 5), ["delta"]);
});

test("manual review snapshot caps at the configured review limit", () => {
  const entries = Array.from({ length: 8 }, (_, i) => entry(`w${i}`, {
    updatedAt: `2026-10-26T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
  }));
  const picked = pickManualReviewWords(entries, "hs", 99);
  assert.equal(picked.length, MAX_REVIEW_WORDS);
  assert.deepEqual(picked, ["w7", "w6", "w5", "w4", "w3"]);
});

test("review merge puts manual words first, deduplicates and respects the cap", () => {
  assert.deepEqual(
    mergeReviewWords(["beta", "alpha"], ["gamma", "alpha", "beta", "delta"], 5),
    ["beta", "alpha", "gamma", "delta"],
  );
  assert.deepEqual(mergeReviewWords(["beta", "alpha"], ["gamma", "delta"], 3), ["beta", "alpha", "gamma"]);
  assert.deepEqual(mergeReviewWords(["", " alpha "], ["alpha", "beta"], 5), ["alpha", "beta"]);
});

test("lookup cost is ten crystals", () => {
  assert.equal(LOOKUP_COST, 10);
});
