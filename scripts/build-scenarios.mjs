// 剧本库打包：scenarios/*.json → scenarios/scenarios.js + scenarios/scenarios.partN.js（滚动懒加载分片）
// 用法：node scripts/build-scenarios.mjs
// 首片(12 张)写 scenarios.js(async 引入,慢网首屏不阻塞),其余每 15 张一片写 partN.js(滚动到底动态注入)
import fs from "node:fs";
import path from "node:path";
import { makeCard } from "./scenario-schema.mjs";

const FIRST_CHUNK = 12;   // 首片卡数(首屏可见,~30KB 压缩后)
const CHUNK_SIZE = 15;    // 后续每片卡数

const dir = path.join(process.cwd(), "scenarios");
const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("category_") && f.endsWith(".json"))
    .sort();

const library = [];
for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const item of arr) {
        // makeCard 内部做完整 schema 校验，坏剧本直接抛错中断打包
        // theme 在源 JSON 顶层,需并入 data 供 schema 校验读取(否则全部降级 retro-paper)
        const card = makeCard({ id: item.id, title: item.title, category: item.category, data: { theme: item.theme, ...item.data } });
        library.push({
            id: card.id,
            title: card.title,
            category: card.category,
            theme: card.theme,
            structured: card.structured,
            text: card.text,
            sourceType: "official",
            pinned: false
        });
    }
}
library.forEach((c, i) => { c.order = i + 1; });

// 分片:首片 12 张 → scenarios.js(async 首屏),其余每 15 张 → scenarios.partN.js(滚动懒加载)
const chunks = [library.slice(0, FIRST_CHUNK)];
for (let i = FIRST_CHUNK; i < library.length; i += CHUNK_SIZE) {
    chunks.push(library.slice(i, i + CHUNK_SIZE));
}
const header = `// 剧本库：由 scripts/build-scenarios.mjs 自动生成，请勿手改
// 源文件：scenarios/category_*.json（node scripts/build-scenarios.mjs 重新生成）
`;
const js = `${header}window.SCENARIO_LIBRARY = ${JSON.stringify(chunks[0], null, 2)};
window.SCENARIO_CHUNK_TOTAL = ${chunks.length};
`;
fs.writeFileSync(path.join(dir, "scenarios.js"), js, "utf8");

for (let i = 1; i < chunks.length; i++) {
    const part = `${header}// 分片 ${i + 1}/${chunks.length}(滚动懒加载,下滑到底动态注入)
(function(){ window.SCENARIO_LIBRARY = window.SCENARIO_LIBRARY || []; window.SCENARIO_LIBRARY.push(...${JSON.stringify(chunks[i], null, 2)}); })();
`;
    fs.writeFileSync(path.join(dir, `scenarios.part${i + 1}.js`), part, "utf8");
}

const cats = [...new Set(library.map(c => c.category))];
console.log(`生成 scenarios.js(首片 ${chunks[0].length} 张) + part2~${chunks.length}(${chunks.length - 1} 片):共 ${library.length} 个剧本 / ${cats.length} 类，schema 全部校验通过`);
