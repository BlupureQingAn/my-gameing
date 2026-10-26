import test from "node:test";
import assert from "node:assert/strict";
import { matchedSenseIndices, splitSenses } from "../src/core/senses.js";

test("splitSenses keeps semicolon-delimited senses", () => {
  assert.deepEqual(splitSenses("adj. 强(壮)的; 坚固的; 强烈的; 坚强的"), [
    "adj. 强(壮)的",
    "坚固的",
    "强烈的",
    "坚强的",
  ]);
});

test("splitSenses splits when a part carries a second POS marker", () => {
  assert.deepEqual(splitSenses("adj. 结实的, 固体的 n. 固体"), [
    "adj. 结实的, 固体的",
    "n. 固体",
  ]);
  assert.deepEqual(splitSenses("v.保护 adj.安全的, 可靠的, 放心的, 无虑的"), [
    "v.保护",
    "adj.安全的, 可靠的, 放心的, 无虑的",
  ]);
});

test("splitSenses keeps a part whole when it carries only one POS marker", () => {
  assert.deepEqual(
    splitSenses("(smelt, smelt / -ed,-ed) v. 嗅, 闻到; 发气味 n. 气味"),
    ["(smelt, smelt / -ed,-ed) v. 嗅, 闻到", "发气味 n. 气味"],
  );
  assert.deepEqual(splitSenses("n. 便条, 笔记, 注释; 钞票; 音符, 音调 v. 记下,"), [
    "n. 便条, 笔记, 注释",
    "钞票",
    "音符, 音调 v. 记下,",
  ]);
});

test("splitSenses falls back to a single entry", () => {
  assert.deepEqual(splitSenses("adj. 新鲜的"), ["adj. 新鲜的"]);
  assert.deepEqual(splitSenses(""), [""]);
  assert.deepEqual(splitSenses(null), [""]);
});

test("matchedSenseIndices reads topic labels safely", () => {
  assert.deepEqual(matchedSenseIndices({ senseMatch: { fresh: [0, 2] } }, "fresh"), [0, 2]);
  assert.deepEqual(matchedSenseIndices({ senseMatch: { fresh: [] } }, "fresh"), []);
  assert.deepEqual(matchedSenseIndices({ senseMatch: {} }, "fresh"), []);
  assert.deepEqual(matchedSenseIndices(null, "fresh"), []);
});
