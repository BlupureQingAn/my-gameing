import test from "node:test";
import assert from "node:assert/strict";
import {
  explainFor,
  isNearMiss,
  matchedSenseIndices,
  nearMissExplainFor,
  splitSenses,
  topicSensesText,
} from "../src/core/senses.js";

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

test("explainFor returns a usable explanation and skips empty or none entries", () => {
  const topic = {
    explain: {
      year: { kind: "same", note: "class 的「年级」义与 year 的「年级」义相同", source: "external" },
      college: { kind: "none", note: "" },
      sort: { kind: "adjacent", note: "class 的「类别」义与 sort 的「种类」义语义相邻", source: "lexicon" },
    },
  };
  assert.equal(explainFor(topic, "year").kind, "same");
  assert.equal(explainFor(topic, "sort").kind, "adjacent");
  assert.equal(explainFor(topic, "college"), null);
  assert.equal(explainFor(topic, "missing"), null);
  assert.equal(explainFor(null, "year"), null);
});

test("isNearMiss reads the near-miss list safely", () => {
  const topic = { nearMiss: ["college", "grade"] };
  assert.equal(isNearMiss(topic, "college"), true);
  assert.equal(isNearMiss(topic, "year"), false);
  assert.equal(isNearMiss({}, "college"), false);
  assert.equal(isNearMiss(null, "college"), false);
});

test("nearMissExplainFor only serves words that are actually near-miss", () => {
  const topic = {
    nearMiss: ["wealthy"],
    nearMissExplain: {
      wealthy: { kind: "adjacent", topicSense: "充足的", wordSense: "富裕的", note: "…语义相邻" },
      rich: { kind: "same", topicSense: "丰富的", wordSense: "富裕的", note: "…相同" },
      spare: { kind: "none", topicSense: "多余的", wordSense: "", note: "" },
    },
  };
  assert.equal(nearMissExplainFor(topic, "wealthy").kind, "adjacent");
  assert.equal(nearMissExplainFor(topic, "rich"), null);
  assert.equal(nearMissExplainFor(topic, "spare"), null);
  assert.equal(nearMissExplainFor({ nearMiss: ["wealthy"] }, "wealthy"), null);
  assert.equal(nearMissExplainFor(null, "wealthy"), null);
});

test("topicSensesText joins and truncates sense labels", () => {
  assert.equal(topicSensesText({ topicSenses: ["班级", "年级"] }), "班级 / 年级");
  assert.equal(topicSensesText({ topicSenses: ["班级", "", "年级"] }), "班级 / 年级");
  assert.equal(topicSensesText({ topicSenses: [] }), "");
  assert.equal(topicSensesText(null), "");
  assert.equal(topicSensesText({ topicSenses: ["一二三四五六七八九十"] }, 6), "一二三四五六…");
});
