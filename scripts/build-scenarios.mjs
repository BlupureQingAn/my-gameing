// 剧本库打包：scenarios/*.json → scenarios/scenarios.js（window.SCENARIO_LIBRARY）
// 用法：node scripts/build-scenarios.mjs
// 生成文件为纯数据 JS，前端 <script src="scenarios.js"> 直接可用，保持单文件架构
import fs from "node:fs";
import path from "node:path";
import { makeCard } from "./scenario-schema.mjs";

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

const js = `// 剧本库：由 scripts/build-scenarios.mjs 自动生成，请勿手改
// 源文件：scenarios/category_*.json（node scripts/build-scenarios.mjs 重新生成）
window.SCENARIO_LIBRARY = ${JSON.stringify(library, null, 2)};
`;
fs.writeFileSync(path.join(dir, "scenarios.js"), js, "utf8");

const cats = [...new Set(library.map(c => c.category))];
console.log(`生成 scenarios/scenarios.js：${library.length} 个剧本 / ${cats.length} 类（${cats.join(" / ")}），schema 全部校验通过`);
