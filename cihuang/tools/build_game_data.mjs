// 生成前端紧凑词池：只保留主题牌面可能出现的单词，压缩冗余字段。
// 用法: node cihuang/tools/build_game_data.mjs [band...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bankDir = path.join(repo, "cihuang/data/banks");
const topicDir = path.join(repo, "cihuang/data/topics");
const outDir = path.join(repo, "cihuang/data/game");
fs.mkdirSync(outDir, { recursive: true });

const ALL = ["hs", "cet4", "cet6", "ky", "toefl"];
const bands = process.argv.slice(2).filter((b) => ALL.includes(b));
const targets = bands.length ? bands : ALL;

function compact(item) {
  return [
    item.w,
    item.ipa || "",
    Array.isArray(item.pos) ? item.pos.join(",") : "",
    item.zh || "",
    String(item.def || item.en || "").slice(0, 240),
    Number(item.freq) || 0,
  ];
}

for (const band of targets) {
  const bankPath = path.join(bankDir, `${band}.json`);
  const topicPath = path.join(topicDir, `${band}.json`);
  if (!fs.existsSync(bankPath) || !fs.existsSync(topicPath)) {
    console.log(`${band}: 跳过（词库或主题缺失）`);
    continue;
  }
  const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  const topics = JSON.parse(fs.readFileSync(topicPath, "utf8")).topics || [];
  const index = new Map(bank.items.map((item) => [item.w, item]));
  const words = new Set();
  for (const topic of topics) {
    for (const word of [topic.target, ...(topic.compliant || []), ...(topic.distractors || [])]) {
      if (index.has(word)) words.add(word);
    }
  }
  const rows = Array.from(words).sort().map((word) => compact(index.get(word)));
  const payload = {
    band,
    generatedAt: new Date().toISOString(),
    topics: topics.length,
    words: rows,
  };
  const outPath = path.join(outDir, `${band}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`${band}: ${rows.length} 词 / ${topics.length} 主题 → ${kb} KB`);
}
