// 清理主题库里无法组牌的主题：合规词/干扰词缺失、词数与词表不同步。
// 用法：node cihuang/tools/prune_orphan_topics.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bands = ["hs", "cet4", "cet6", "ky", "toefl"];
const write = process.argv.includes("--write");

function usable(topic, words) {
  if (!topic || !Array.isArray(topic.compliant) || topic.compliant.length !== 6) return false;
  const extra = (topic.distractors || []).filter(
    (word) => !topic.compliant.includes(word) && word !== topic.target,
  );
  return extra.length >= 17 && topic.compliant.concat(extra).every((word) => words.has(word));
}

let removedTotal = 0;
for (const band of bands) {
  const topicsPath = join(root, "data", "topics", `${band}.json`);
  const gamePath = join(root, "data", "game", `${band}.json`);
  const doc = JSON.parse(readFileSync(topicsPath, "utf8"));
  const game = JSON.parse(readFileSync(gamePath, "utf8"));
  const words = new Set(game.words.map((row) => (Array.isArray(row) ? row[0] : row.w)));
  const topics = Array.isArray(doc) ? doc : doc.topics;
  const kept = topics.filter((topic) => usable(topic, words));
  const removed = topics.length - kept.length;
  removedTotal += removed;
  console.log(`${band}: ${topics.length} -> ${kept.length} (-${removed})`);
  if (write && removed) {
    const next = Array.isArray(doc) ? kept : { ...doc, topics: kept };
    writeFileSync(topicsPath, JSON.stringify(next));
  }
}
console.log(write ? `rewrote data/topics/*.json, removed ${removedTotal}` : `dry run, would remove ${removedTotal}; pass --write to rewrite`);
