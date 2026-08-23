// 剧本 schema 单测：node scripts/test-scenario-schema.mjs
import { CARD_SPEC, THEME_KEYS, emptyData, validateStructured, renderScenarioText, makeCard } from "./scenario-schema.mjs";

let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) { pass++; console.log("PASS -", name); } else { fail++; console.log("FAIL -", name, detail ?? ""); } };

// 1 合法完整数据
const good = {
    theme: "retro-paper",
    world: { era: "1980s 香港", genre: "娱乐圈", summary: "1985年的香港，娱乐圈黄金时代。", rules: ["不可脱离时代", "保持港风"], atmosphere: "霓虹与潮湿" },
    identity: { name: "林知夏", gender: "女", age: "19", background: "从九龙城寨走出的打工少女" },
    npcs: [{ name: "陈探长", role: "娱乐记者", personality: "犀利毒舌", relationship: "潜在帮手" }],
    timeline: { start: { year: 1985, month: 3, day: 1 }, note: "港星黄金十年开端" },
    scene_style: { env_templates: ["霓虹街道", "片场"], option_style: "选项要带行动感" },
    first_scene: { story: "你站在九龙街头。", options: ["去茶餐厅", "去片场"] },
};
let v = validateStructured(good);
t("合法完整通过", v.ok);
t("主题枚举校验", v.ok && v.data.theme === "retro-paper");

// 2 缺必填 → 报错
v = validateStructured({ world: {}, identity: {} });
t("缺必填报错", !v.ok && v.errors.includes("world.summary 必填") && v.errors.includes("identity.name 必填"));

// 3 非对象 → 报错
t("非对象拒绝", !validateStructured(null).ok && !validateStructured("x").ok && !validateStructured([1]).ok);

// 4 字段清洗（超长截断/坏值丢弃）
v = validateStructured({ ...good, theme: "not-a-theme", world: { ...good.world, summary: "x".repeat(3000) }, npcs: [good.npcs[0], { role: "无名" }, 42], timeline: { start: { year: 9999, month: 13 } }, scene_style: { env_templates: ["a", 42, ""] }, first_scene: { story: "s", options: ["1", "2", "3", "4"] } });
t("坏 theme 回退默认", v.ok && v.data.theme === "retro-paper");
t("summary 截断 2000", v.ok && v.data.world.summary.length === 2000);
t("NPC 过滤坏项", v.ok && v.data.npcs.length === 1);
t("非法日期回退", v.ok && v.data.timeline.start.year === 2026 && v.data.timeline.start.month === 1);
t("env_templates 过滤", v.ok && v.data.scene_style.env_templates.length === 1);
t("options 截断 3", v.ok && v.data.first_scene.options.length === 3);

// 5 renderScenarioText 输出结构
const text = renderScenarioText(good);
t("渲染含各章节", ["【世界设定】", "【主角身份】", "【重要人物】", "【时间线】"].every(s => text.includes(s)));
t("渲染含数据", text.includes("1985年3月1日") && text.includes("林知夏") && text.includes("陈探长"));
t("渲染含规则序号", text.includes("1. 不可脱离时代"));

// 6 空数据渲染不崩
t("空数据渲染不崩", typeof renderScenarioText({}) === "string" && renderScenarioText({}).length > 0);

// 7 makeCard 生成卡片记录
const card = makeCard({ id: "scenario_preset_gd_001", title: "测试剧本", category: "宫斗", data: good });
t("makeCard 产出", card.id.startsWith("scenario_preset_") && card.title === "测试剧本" && card.category === "宫斗" && card.theme === "retro-paper" && typeof card.structured === "object" && card.text.includes("【世界设定】"));

// 8 makeCard 校验失败抛错
let threw = false;
try { makeCard({ id: "x", title: "t", data: {} }); } catch (e) { threw = true; }
t("makeCard 坏数据抛错", threw);

// 9 THEME_KEYS 数量（M4 目标 10+）
t("主题枚举 10+", THEME_KEYS.length >= 10);

// 10 emptyData 完整性
const ed = emptyData();
t("emptyData 字段完整", ["theme", "world", "identity", "npcs", "timeline", "scene_style", "first_scene"].every(k => k in ed));

// 11 validateStructured 幂等（二次校验结果一致）
const v1 = validateStructured(good);
const v2 = validateStructured(v1.data);
t("校验幂等", v1.ok && v2.ok && JSON.stringify(v1.data) === JSON.stringify(v2.data));

// 12 CARD_SPEC
t("spec 常量", CARD_SPEC === "bitlife_card_v1");

console.log(`\n---- ${pass}/${pass + fail} PASS ----`);
process.exit(fail ? 1 : 0);
