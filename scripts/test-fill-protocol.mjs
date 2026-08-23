// 填空协议单测：node scripts/test-fill-protocol.mjs
import { parseRoundFill, normalizeRoundFill, buildRoundFillPrompt, ROUND_FILL_DOC } from "./fill-protocol.mjs";

let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) { pass++; console.log("PASS -", name); } else { fail++; console.log("FAIL -", name, detail ?? ""); } };

// 1 合法完整
let r = parseRoundFill(JSON.stringify({ story: "剧情一。\n\n王老板 对主角说：“来了？”", time: { year: 1985, month: 3, day: 2 }, stats: [{ key: "金钱", value: "120/200" }], items: ["旧怀表"], options: ["接受邀请", "拒绝"], scene: "夜晚/酒馆" }));
t("合法完整解析", r.ok && r.data.story.includes("王老板") && r.data.options.length === 2 && r.data.time.year === 1985 && r.data.scene === "夜晚/酒馆");

// 2 markdown 围栏包裹
r = parseRoundFill("```json\n" + JSON.stringify({ story: "被围栏包裹", options: ["A"] }) + "\n```");
t("剥 markdown 围栏", r.ok && r.data.story === "被围栏包裹");

// 3 前后多余文字（AI 说废话）
r = parseRoundFill('好的，这是你的剧情：\n{"story":"中间有 JSON","options":["A","B"]}\n希望你喜欢！');
t("前后废话剥离", r.ok && r.data.story === "中间有 JSON");

// 4 缺 story → 失败
r = parseRoundFill(JSON.stringify({ options: ["A"] }));
t("缺 story 拒绝", !r.ok && r.reason === "story-missing");

// 5 story 空串 → 失败
r = parseRoundFill(JSON.stringify({ story: "  " }));
t("空 story 拒绝", !r.ok && r.reason === "story-missing");

// 6 坏 JSON → 失败
r = parseRoundFill('{"story": "未闭合');
t("坏 JSON 拒绝", !r.ok && r.reason === "invalid-json");

// 7 纯文本无 JSON → 失败
r = parseRoundFill("今天天气不错");
t("纯文本拒绝", !r.ok && r.reason === "no-json-object");

// 8 空输入
r = parseRoundFill("");
t("空输入拒绝", !r.ok && r.reason === "empty");

// 9 options 超 3 条截断
r = parseRoundFill(JSON.stringify({ story: "s", options: ["1", "2", "3", "4", "5"] }));
t("options 截断到3", r.ok && r.data.options.length === 3);

// 10 options 非数组 → 失败
r = parseRoundFill(JSON.stringify({ story: "s", options: "不是数组" }));
t("options 非数组拒绝", !r.ok && r.reason === "options-not-array");

// 11 stats 过滤坏项
r = parseRoundFill(JSON.stringify({ story: "s", options: ["A"], stats: [{ key: "金钱", value: "10" }, { key: "", value: "x" }, { value: "无key" }, "垃圾"] }));
t("stats 过滤坏项", r.ok && r.data.stats.length === 1 && r.data.stats[0].key === "金钱");

// 12 time 非法值丢弃
r = parseRoundFill(JSON.stringify({ story: "s", options: ["A"], time: { year: "abc", month: 3 } }));
t("time 非法丢弃", r.ok && r.data.time === undefined);

// 13 未知字段丢弃
r = parseRoundFill(JSON.stringify({ story: "s", options: ["A"], evil: "x", html: "<script>" }));
t("未知字段丢弃", r.ok && r.data.evil === undefined && r.data.html === undefined);

// 14 空 options 数组 → 允许（字段省略）
r = parseRoundFill(JSON.stringify({ story: "s", options: [] }));
t("空 options 容忍", r.ok && r.data.options === undefined);

// 15 items 过滤
r = parseRoundFill(JSON.stringify({ story: "s", options: ["A"], items: ["剑", "", 42] }));
t("items 过滤", r.ok && r.data.items.length === 1 && r.data.items[0] === "剑");

// 16 buildRoundFillPrompt 结构
const p = buildRoundFillPrompt({ scenarioText: "1985年香港", timeText: "1985年3月1日", statsSummary: "金钱 100", historySummary: "上一轮…", userText: "去酒馆" });
t("prompt 含设定+状态+行动", p.system.includes("只输出一个 JSON") && p.user.includes("1985年香港") && p.user.includes("去酒馆") && p.user.includes("【最近剧情】"));
t("prompt 不含 HTML 指令", !p.system.includes("<div"));

// 17 ROUND_FILL_DOC 完整性
t("协议文档含全部字段", ["story", "time", "stats", "items", "options", "scene"].every(k => ROUND_FILL_DOC.includes(k)));

// 18 normalizeRoundFill 直接调用（非字符串 story）
r = normalizeRoundFill({ story: 123 });
t("story 非字符串拒绝", !r.ok && r.reason === "story-missing");

// 19 嵌套 JSON 在 HTML 里（AI 没听话输出 HTML+JSON 混合）
r = parseRoundFill('<div class="card">{"story":"混在HTML里","options":["A"]}</div>');
t("HTML 包裹剥离", r.ok && r.data.story === "混在HTML里");

// 20 输出是 JSON 数组 → 拒绝
r = parseRoundFill('[{"story":"数组里的"}]');
t("JSON 数组拒绝", !r.ok && r.reason === "array-not-object");

console.log(`\n---- ${pass}/${pass + fail} PASS ----`);
process.exit(fail ? 1 : 0);
