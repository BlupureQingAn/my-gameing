// 剧本库打包：scenarios/*.json → scenarios/scenarios.js + scenarios/scenarios.partN.js（滚动懒加载分片）
// 用法：node scripts/build-scenarios.mjs
// 首片(12 张)写 scenarios.js(async 引入,慢网首屏不阻塞),其余每 15 张一片写 partN.js(滚动到底动态注入)
import fs from "node:fs";
import path from "node:path";
import { makeCard } from "./scenario-schema.mjs";

// 分类热度顺序:与 index.html HOT_CATEGORY_ORDER(7361)保持一致,分片按热度从高到低排列,热门分类先加载先展示
const HOT_CATEGORY_ORDER = ["恋爱", "ABO", "乙女", "职场", "修仙", "穿越", "都市", "无限流", "末世", "经营", "科幻", "悬疑", "跑团", "奇幻", "历史", "宫斗", "种田", "女尊", "校园", "娱乐圈", "人外", "同人", "主播"];
function hotRank(cat) {
    const i = HOT_CATEGORY_ORDER.indexOf(String(cat || ""));
    return i < 0 ? HOT_CATEGORY_ORDER.length : i;
}

// 题材 → 内置 BGM 曲目（BGM 2.0，与 index.html BUILTIN_BGMS 的 title 一一对应；无匹配→默认第一首）
const CATEGORY_BGM = {
    "恋爱": "都市轻快恋爱风", "都市": "都市轻快恋爱风", "校园": "都市轻快恋爱风", "职场": "都市轻快恋爱风",
    "主播": "都市轻快恋爱风", "娱乐圈": "都市轻快恋爱风", "同人": "都市轻快恋爱风", "经营": "都市轻快恋爱风",
    "历史": "宏大叙事钢琴纯音乐", "宫斗": "宏大叙事钢琴纯音乐", "修仙": "宏大叙事钢琴纯音乐",
    "女尊": "宏大叙事钢琴纯音乐", "穿越": "宏大叙事钢琴纯音乐", "跑团": "宏大叙事钢琴纯音乐",
    "科幻": "朦胧梦幻科幻", "奇幻": "朦胧梦幻科幻", "人外": "朦胧梦幻科幻",
    "悬疑": "悬疑诡异节奏", "无限流": "悬疑诡异节奏",
    "末世": "沉重氛围节拍",
    "种田": "温柔感动钢琴曲",
    "ABO": "暧昧沉浸节拍", "乙女": "暧昧沉浸节拍",
};
function bgmFor(cat) {
    return CATEGORY_BGM[String(cat || "")] || "都市轻快恋爱风";
}

// 题材 → 默认开局年份（源 JSON 缺失 timeline.start 时注入,让首卡时间贴合剧本设定;makeCard 的 2026 兜底仅作最后保险）
const CATEGORY_YEAR = {
    "恋爱": 2026, "乙女": 2026, "校园": 2026, "职场": 2026, "主播": 2026, "娱乐圈": 2026, "经营": 2026,
    "科幻": 2200, "末世": 2200,
    "ABO": 2035,
    "历史": 2026, "宫斗": 2026, "女尊": 2026, "穿越": 2026, "同人": 2026, "无限流": 2026,
    "修仙": 1, "奇幻": 1, "人外": 1, "跑团": 1,
};

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
        const data = { ...(item.data || {}) };
        if (!data.timeline || !data.timeline.start) {
            data.timeline = { ...(data.timeline || {}), start: { year: CATEGORY_YEAR[String(item.category || "")] || 2026, month: 1, day: 1 } };
        }
        const card = makeCard({ id: item.id, title: item.title, category: item.category, data: { theme: item.theme, ...data } });
        // 封面静态化:scenarios/covers/{id}.jpg 存在则卡片数据带 cover 相对路径,前端直接静态加载(不再走 KV/生成 API)
        const coverFile = path.join(dir, "covers", item.id + ".jpg");
        library.push({
            id: card.id,
            title: card.title,
            category: card.category,
            theme: card.theme,
            structured: card.structured,
            text: card.text,
            sourceType: "official",
            pinned: false,
            bgm: bgmFor(item.category),
            cover: fs.existsSync(coverFile) ? "covers/" + item.id + ".jpg" : undefined
        });
    }
}
// 按分类热度排序(稳定排序,同分类保持源顺序):热门分类进首片,滚动加载顺序 = 热度从高到低
library.sort((a, b) => hotRank(a.category) - hotRank(b.category));
library.forEach((c, i) => { c.order = i + 1; });

// 分片:一个分类一片。首片 = 热度前 2 个分类 → scenarios.js(async 首屏,默认只加载两片),其余每分类一片 → scenarios.partN.js(滚动懒加载)
const FIRST_CHUNK_CATS = 2;
const chunks = [];
const catGroups = new Map();
library.forEach((c) => {
    const k = String(c.category || "其他");
    if (!catGroups.has(k)) catGroups.set(k, []);
    catGroups.get(k).push(c);
});
const catOrder = [...catGroups.keys()]; // 已按热度排序
catOrder.slice(0, FIRST_CHUNK_CATS).forEach((k) => { (chunks[0] = chunks[0] || []).push(...catGroups.get(k)); });
for (let i = FIRST_CHUNK_CATS; i < catOrder.length; i++) {
    chunks.push(catGroups.get(catOrder[i]));
}
const header = `// 剧本库：由 scripts/build-scenarios.mjs 自动生成，请勿手改
// 源文件：scenarios/category_*.json（node scripts/build-scenarios.mjs 重新生成）
`;
const js = `${header}window.SCENARIO_LIBRARY = ${JSON.stringify(chunks[0], null, 2)};
window.SCENARIO_CHUNK_TOTAL = ${chunks.length};
window.SCENARIO_CHUNK_CATS = ${JSON.stringify(chunks.map(c => [...new Set(c.map(x => x.category))]))};
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
