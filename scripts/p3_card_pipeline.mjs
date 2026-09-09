// P3 产卡流水线(2026-09-09):考试场景题材池 → LLM 逐槽生成 → 拼装校验 → .card.json
// 骨架/结构由脚本保证(对齐 editor 协议与 pb_import_lang_card 校验),LLM 只填英文创作槽位。
// 用法: node scripts/p3_card_pipeline.mjs [--all|--topic N] [--out docs/english-cards] [--api-key 智谱key]
// 环境: F:/Claude/zhipu-apikey(默认读此文件);模型 glm-4-flash(免费稳定非思考,单次输出约 870 词上限,长文分段接力)
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const KEY = args["api-key"] || fs.readFileSync(process.env.ZHIPU_KEY_FILE || "F:/Claude/zhipu-apikey", "utf8").trim();
const OUT_DIR = args.out || "docs/english-cards";
const MODEL = "glm-4-flash";
const MAX_TOK_CAP = 3900; // glm-4-flash 输出上限 4096,统一留余量
const BANDS = ["hs", "cet4", "cet6", "ky", "toefl"];

// ---- 考试场景题材池(category/category_zh 与线上题材一致;band 词域约束) ----
const TOPICS = [
    {
        slug: "p3-01-last-desk", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "英语期末周图书馆占座", premise: "期末周图书馆最后一排空座被「纪念品」占位大战",
        setting: "美国某大学期末周图书馆", start: { year: 2026, month: 12, day: 14 },
        names: ["Maya", "Leo", "Priya", "Sam"]
    },
    {
        slug: "p3-02-landing-intern", band: "cet6", category: "求职", category_zh: "职场",
        title_seed: "一周内拿到心仪实习 offer", premise: "简历海投无回音后收到面试通知,只剩三天准备",
        setting: "城市科技公司面试周", start: { year: 2026, month: 9, day: 7 },
        names: ["Daniel", "Ava", "Mr. Okafor", "Rosa"]
    },
    {
        slug: "p3-03-group-presentation", band: "cet4", category: "校园", category_zh: "校园",
        title_seed: "小组展示日队友集体掉线", premise: "演讲前夜队友失联,只剩你和课件撑全场",
        setting: "大学课堂与宿舍", start: { year: 2026, month: 11, day: 3 },
        names: ["Emma", "Jake", "Noah", "Iris"]
    },
    {
        slug: "p3-04-flatmates", band: "cet6", category: "生活", category_zh: "生活",
        title_seed: "合租屋的账单与边界", premise: "水电账单分摊引发的合租信任危机",
        setting: "校外合租公寓", start: { year: 2026, month: 10, day: 18 },
        names: ["Ben", "Chloe", "Ahmed", "Mia"]
    },
    {
        slug: "p3-05-debate-club", band: "hs", category: "校园", category_zh: "校园",
        title_seed: "辩论社招新现场被点名挑战", premise: "招新摊位前的即兴辩论决定了你能否进社",
        setting: "大学社团招新季", start: { year: 2026, month: 9, day: 21 },
        names: ["Tessa", "Marcus", "Yuki", "Owen"]
    }
];

// ---- LLM 调用层:单次取回 content;ask=JSON 槽位,askText=围栏纯文本槽位 ----
async function llm(system, user, maxTok, parse) {
    const body = {
        model: MODEL,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user }
        ],
        max_tokens: Math.min(maxTok, MAX_TOK_CAP), temperature: 0.8
    };
    let lastErr = "";
    for (let tryN = 0; tryN < 5; tryN++) {
        try {
            const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error("HTTP " + r.status + " " + JSON.stringify(d.error || {}).slice(0, 160));
            const text = d.choices?.[0]?.message?.content || "";
            if (!text.trim()) throw new Error("空内容");
            const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
            return parse(cleaned);
        } catch (e) {
            lastErr = String(e.message || e);
            // 1305/429=免费档瞬时限流,退避加长;其余递增
            const wait = /(429|1305)/.test(lastErr) ? 20000 : 2500 * (tryN + 1);
            if (tryN < 4) console.log("  LLM 重试 " + (tryN + 1) + ": " + lastErr.slice(0, 90) + " (等 " + (wait / 1000) + "s)");
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw new Error("LLM 失败: " + lastErr);
}
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
function ask(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        try { return JSON.parse(raw); }
        catch (e) {
            const sq = raw.replace(CTRL, "").replace(/\r/g, "");
            if (sq !== raw) return JSON.parse(sq);
            throw e;
        }
    });
}
// 纯文本槽位:剥 <<<START>>>…<<<END>>> 围栏(缺围栏则整段使用),避开 JSON 转义与控制字符
function askText(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        const m = raw.match(/<<<START>>>([\s\S]*?)<<<END>>>/);
        const out = (m ? m[1] : raw).trim();
        if (!out) throw new Error("空文本");
        return out;
    });
}

const SYS_BASE = "你是云吞吞文游的英语考试向文游编剧。严格遵守输出格式要求,不输出任何格式之外的文字、注释或 markdown 围栏。";
const SYS_TEXT = "你是云吞吞文游的英语考试向文游编剧。长文本请用如下围栏包裹(围栏之外不要任何东西):\n<<<START>>>\n内容\n<<<END>>>";
const TONE = "写作语言全英文;人称用 you(玩家);短句为主,词汇全部限制在" +
    ((b) => ({ hs: "高中大纲", cet4: "CET-4 大纲", cet6: "CET-6 大纲", ky: "考研大纲", toefl: "托福高频" })[b] || "CET-4") + "以内,语气温暖口语不幼稚,像真实英语小说。";

const CJK = /[一-鿿]/g;
function cjkCount(s) { return (String(s).match(CJK) || []).length; }
const EN_WARN = "\n(硬性检查:内容必须 100% 纯英文,任何中文/日文字符都算失败!)";

// 纯英文文本槽位:生成 + 自检(含中文超标则带强警告重试一次)
async function genEnBlock(label, doAsk) {
    for (let i = 0; i < 2; i++) {
        const raw = await doAsk(i === 1 ? EN_WARN : "");
        if (raw && cjkCount(raw) <= 2) return raw;
        console.log(label + "  含中文 " + cjkCount(raw) + " 字,重试…");
    }
    throw new Error("两次生成均含中文");
}

// ---- 各槽位 ----
async function genTitle(t) {
    const d = await ask(SYS_BASE,
        TONE + `\n为考试场景英语卡起名(标题体现场景钩子,不剧透结局):\n场景:${t.title_seed}\n题材:${t.category_zh}\n输出单行 JSON:{"title":"英文标题≤6词","title_zh":"中文标题≤9字"}`, 1500);
    return { title: String(d.title || "").trim().slice(0, 80), title_zh: String(d.title_zh || "").trim().slice(0, 40) };
}
// glm-4-flash 单次输出 ~870 词即自行 stop,text 分 3 段接力(前文截尾喂下一段保持连贯)
async function genText(t, title) {
    const SEGS = [
        { n: 350, spec: "## Premise(3 句:主角是谁、此刻什么处境、想要的与害怕的)\n## The World(世界观 2-3 段,只含本卡相关范围)" },
        { n: 400, spec: `## People(恰好 4 人:${t.names.join("/")},每人 4-5 行:身份/性格/与你利害/说话习惯)` },
        { n: 500, spec: "## The Arc(三幕走向:第一幕 4-5 轮建立处境与盟友,第二幕 4-5 轮冲突升级+1 个情绪高光,第三幕 3-4 轮收束;明确轮数分配)\n## Endings(三档结局一句话:圆满/平淡/遗憾)" }
    ];
    let acc = "";
    for (const seg of SEGS) {
        const piece = await genEnBlock(seg.n + "+", (warn) => askText(SYS_TEXT,
            `卡《${title}》英文完整设定,分段协作写作,你只写其中一段;小节标题用 ## 开头。\n` +
            TONE + warn + `\n场景种子:${t.premise}。地点:${t.setting}。\n` +
            (acc ? `前方已写内容(不要重复,顺着剧情风格往下写):\n${acc.slice(-1400)}\n` : "") +
            `本段内容要求(从 ## 小节标题开始写):\n${seg.spec}\n` +
            `本段应约 ${seg.n} 词:写完后自己数一遍单词数,不足 ${Math.round(seg.n * 0.85)} 词就继续充实细节直到达标再收尾。`, 9000));
        acc = (acc ? acc + "\n\n" : "") + piece;
        console.log("  seg " + piece.split(/\s+/).length + " 词");
    }
    return acc;
}
async function genWorldMeta(t, title, textHead) {
    const d = await ask(SYS_BASE,
        `卡《${title}》设定前段:\n${textHead}\n输出单行 JSON:{"world":{"era":"时代/地域一句话(中文)","genre":"题材标签(中文)","summary":"英文 4-6 句世界观综述(纯英文)","rules":"该世界对主角的 3-4 条规则/约束(中文)","atmosphere":"氛围(中文)","vocab":["8 个本卡核心考点词"]},"scene_style":{"env_templates":["7 个场景短标签(中文,如:期末周图书馆四楼)","…"],"option_style":"选项风格(中文)"},"timeline":{"start":{"year":${t.start.year},"month":${t.start.month},"day":${t.start.day}},"note":"时间线说明(中文)"}}`, 5000);
    return d;
}
async function genIdentity(t, title, textHead) {
    const d = await ask(SYS_BASE,
        `卡《${title}》:为主角定身份。参考 People 段(4 人:${t.names.join("/")},主角不在其中,你在设定里用第二人称 you 描述主角)。\n${textHead}\n` +
        `输出单行 JSON:{"identity":{"name":"英文名","gender":"男或女","age":18 到 22 之间选一个数字,"role":"身份一句话(中文)","background":"英文 2-3 句背景(纯英文)"}}`, 2000);
    return d.identity || d;
}
async function genNpcs(t, title, textHead) {
    // 名字必须与 People 段一致:逐条指定,禁止改名
    const named = t.names.map((n) => `{"name":"${n}",…}`).join(",");
    const d = await ask(SYS_BASE,
        `卡《${title}》:依据 People 段产出 4 位人物卡(数组,顺序即登场顺序)。名字必须严格使用:${t.names.join("/")}(逐个对应 People 段的 4 人,不许改名、不许漏人)。\n${textHead}\n` +
        `输出单行 JSON:{"npcs":[${named}]}其中每条为 {"gender":"男/女","role":"身份(中文)","personality":"性格(中文,含说话习惯)","relationship":"与主角的关系(中文)"}`, 3000);
    return Array.isArray(d.npcs) ? d.npcs : d;
}
// first_scene:story 用围栏纯文本(340-420 词),不足则补写;options 单独小 JSON
async function genFirstScene(t, title, text, optionsHint) {
    const base = `卡《${title}》完整设定:\n${text.slice(0, 4200)}\n`;
    let story = await genEnBlock("fs", (warn) => askText(SYS_TEXT,
        base +
        `写开场故事:开始于设定时间点前几分钟,第二人称 you,现在时,340-420 词,停在「你必须立刻做选择」的节骨眼,不展开后续。` +
        warn +
        `句长 8-15 词为主,对话自然。${optionsHint ? "你的选项将包括:" + optionsHint.join(" / ") : ""}`, 9000));
    const w0 = story.split(/\s+/).length;
    if (w0 < 300) {
        console.log("  fs " + w0 + " 词不足,补写…");
        const add = await askText(SYS_TEXT,
            base + `上面这份开场草稿还不够长(才 ${w0} 词)。请补写续段直接接在草稿末尾(从草稿的最后一句话之后继续,不要重复已写内容),使总长达到 380-440 词。\n草稿原文:\n${story}\n输出格式:仅围栏包裹的续段内容。`, 9000);
        story = story + "\n\n" + add;
    }
    let options = [];
    for (let i = 0; i < 2 && options.length < 3; i++) {
        const rawOpt = await askText(SYS_TEXT,
            base + `开场故事节选:\n${story.slice(0, 2400)}\n` +
            `为这个故事的开场设计 4 个可行动选项(每个 4-10 词,具体行动而非是/否,角色视角 you,全英文,不要序号和行首符号,一行恰好一个选项)。`,
            (i ? 1500 : 2000));
        options = rawOpt.split("\n").map((x) => x.trim().replace(/^[0-9.)\]•·\-*\s]+/, "")).filter((x) => x.length >= 3 && cjkCount(x) === 0).slice(0, 4);
        if (options.length < 3) console.log("  opts 仅 " + options.length + " 条,重问…");
    }
    return { story, options: options.slice(0, 4) };
}

// ---- 本地质检(与 pb_import_lang_card 校验对齐 + 词数/一致性) ----
function qcCard(card, t) {
    const errs = [];
    const s = card.structured || {};
    if (!card.title || card.title.length < 2) errs.push("title 无效");
    if (!card.title_zh || card.title_zh.length < 2) errs.push("title_zh 无效");
    if (!BANDS.includes(card.band)) errs.push("band 无效");
    if (!card.text || card.text.split(/\s+/).length < 800) errs.push("text 词数不足(<800): " + (card.text || "").split(/\s+/).length);
    if (s.band !== card.band) errs.push("structured.band 不一致");
    if (!s.world || !String(s.world.summary || "").trim()) errs.push("world.summary 缺失");
    if (!s.identity || !String(s.identity.name || "").trim()) errs.push("identity.name 缺失");
    if (!Array.isArray(s.npcs) || s.npcs.length < 3) errs.push("npcs 不足 3");
    if (t && s.npcs.map((n) => n && n.name).join(",") !== t.names.join(","))
        errs.push("npcs 名字应为 " + t.names.join("/") + ",实得 " + s.npcs.map((n) => n && n.name).join("/"));
    if (!s.first_scene || String(s.first_scene.story || "").split(/\s+/).length < 280) errs.push("first_scene.story 词数不足(<280)");
    if (!Array.isArray(s.first_scene?.options) || s.first_scene.options.length < 3) errs.push("options 不足 3");
    if (!s.timeline?.start || !s.timeline.start.year) errs.push("timeline.start 缺失");
    const all = card.text + " " + s.first_scene.story;
    const cjk = cjkCount(all);
    if (cjk > 5) errs.push("正文混入中文 " + cjk + " 字");
    return errs;
}

async function genOne(t, idx) {
    const label = `[${idx + 1}/${TOPICS.length}] ${t.slug}`;
    console.log(label + " T1 标题+设定…");
    const meta = await genTitle(t);
    const text = await genText(t, meta.title);
    console.log(label + "  text 合计 " + text.split(/\s+/).length + " 词");
    console.log(label + " T2 世界观元信息…");
    const meta2 = await genWorldMeta(t, meta.title, text.slice(0, 700));
    const head = text.slice(0, 900) + "\n…\n" + text.slice(-500);
    console.log(label + " T3 主角+人物…");
    const ident = await genIdentity(t, meta.title, head);
    const npcs = await genNpcs(t, meta.title, head);
    console.log(label + " T4 开场…");
    const fs1 = await genFirstScene(t, meta.title, text, npcs.slice(0, 2).map((n) => n && n.name).filter(Boolean));

    const structured = {
        band: t.band,
        theme: "minimal",
        world: meta2.world || {},
        identity: ident,
        npcs: npcs.slice(0, 6),
        timeline: meta2.timeline || { start: t.start },
        scene_style: meta2.scene_style || {},
        first_scene: { story: fs1.story, options: fs1.options }
    };
    const card = {
        title: meta.title, title_zh: meta.title_zh, lang: "en", band: t.band,
        category: t.category, category_zh: t.category_zh, theme: "minimal",
        text, structured
    };
    const errs = qcCard(card, t);
    return { card, errs };
}

const idxArg = args.topic !== undefined ? Number(args.topic) : null;
const wanted = args.all !== undefined ? TOPICS.map((_, i) => i) : (idxArg !== null && TOPICS[idxArg] ? [idxArg] : [0]);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
let okN = 0;
for (const idx of wanted) {
    const t = TOPICS[idx];
    const f = path.join(OUT_DIR, t.slug + ".card.json");
    try {
        const { card, errs } = await genOne(t, idx);
        if (errs.length) {
            console.log(`✗ ${t.slug} 质检失败:\n  - ` + errs.join("\n  - "));
            continue;
        }
        fs.writeFileSync(f, JSON.stringify(card, null, 2), "utf8");
        console.log(`✓ ${t.slug} → ${f}(${(fs.statSync(f).size / 1024).toFixed(1)}KB)`);
        okN++;
    } catch (e) {
        console.log(`✗ ${t.slug} 生成异常: ${e.message}`);
    }
}
console.log(`\n---- 完成: ${okN}/${wanted.length} 张质检过卡 ----`);
