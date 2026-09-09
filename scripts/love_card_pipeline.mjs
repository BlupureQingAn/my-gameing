// R1 恋爱攻略卡产线(2026-09-09,风格定稿 jp_anime 后启用):PRD §6 两步产卡
//   1. 角色池先行:5 精修人设卡(名字/原型硬编码,LLM 细写)→ {slug}.chars/NN-name.char.json
//   2. 剧情壳:love_mode 卡(top-level love_mode/gender_target,structured 含
//      npcs/love_rules/scenes.heartbeat/world/identity/timeline/scene_style/first_scene{story,options带love+target})
// 用法: node scripts/love_card_pipeline.mjs [--only r1-01-xxx] [--out docs/english-cards] [--api-key 智谱key]
// 环境: 模型 glm-4-flash(免费稳定非思考);key 默认读 F:/Claude/zhipu-apikey
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const KEY = args["api-key"] || fs.readFileSync(process.env.ZHIPU_KEY_FILE || "F:/Claude/zhipu-apikey", "utf8").trim();
const OUT_DIR = args.out || "docs/english-cards";
const MODEL = "glm-4-flash";
const MAX_TOK_CAP = 3900;
const BANDS = ["hs", "cet4", "cet6", "ky", "toefl"];
const LOVE_TAGS = ["flirt", "kind", "tease", "neutral", "awkward", "rude", "reject"];

// ---- 恋爱卡主题池(名字+角色原型硬编码:QC 逐名比对;女向=女主视角 5 男,男向反之) ----
// age 与年龄一致性由 LLM 把握(大学生 18-23,都市 22-30)
const TOPICS = [
    {
        slug: "r1-01-film-club", target: "female", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "秋季电影社嘉年华前的两周", premise: "新学期转入 Crestwood 大学的大二女生加入电影社,距社团嘉年华还有两周,期间与社团圈的 5 位男生各自展开交集",
        setting: "美国 Crestwood 大学校园(十月金秋)", start: { year: 2026, month: 10, day: 12 },
        identity: { gender: "女", age: 20, role_seed: "转学来的大二生,爱电影与摄影的新社员" },
        names: ["Ethan", "Liam", "Noah", "Marcus", "Owen"],
        archetypes: {
            Ethan: "电影社社长,大四温柔学长,待人如春风,背着旧胶片相机,全校都知道他暗恋过谁都会脸红",
            Liam: "校篮球队队长,大三阳光开朗,训练完总顺路来社团帮忙搬器材,笑容很亮,有点憨的直球",
            Noah: "图书馆常驻的文学系神秘生,借阅卡上永远写着冷门书名,初见疏离,熟后话匣子很多",
            Marcus: "辩论社主将,毒舌腹黑,第一印象难相处,但与你有过一段针锋相对的公共交锋",
            Owen: "艺术学院大二,在社团活动室窗边画速写,安静治愈系,记得你随口说过的每件小事"
        }
    },
    {
        slug: "r1-02-aurora-cafe", target: "female", band: "cet6", category: "生活", category_zh: "生活",
        title_seed: "街角咖啡店的午后常客", premise: "24 岁的女主在 Aurora 街角咖啡馆做咖啡师,街区五位性格迥异的男人常来,秋日午后故事在吧台内外展开",
        setting: "城市 Aurora 街角咖啡馆与周边街区", start: { year: 2026, month: 10, day: 18 },
        identity: { gender: "女", age: 24, role_seed: "街角咖啡馆咖啡师,刚搬来这街区半年,梦想开自己的小店" },
        names: ["Julian", "Alex", "Daniel", "Leo", "Kevin"],
        archetypes: {
            Julian: "楼上旧书店店主,30 岁沉稳温和,每天下午三点来买一杯美式,言谈有旧纸与威士忌的味道",
            Alex: "隔壁健身房教练,28 岁阳光健气,晨练完总来要蛋白奶昔,笑容感染力强,直来直往",
            Daniel: "附近急诊科医生,29 岁,值完大夜班常来续命,温柔靠谱但总被工作占满,眼神里有疲惫与耐心",
            Leo: "独立乐队吉他手,27 岁自由浪漫,晚上演出前来喝热牛奶开嗓,聊起音乐眼睛会发光",
            Kevin: "西装革履的基金分析师,31 岁,嘴毒挑剔却每天都来,某次发现他外套里揣着给流浪猫的罐头"
        }
    },
    {
        slug: "r1-03-photo-club", target: "male", band: "cet4", category: "campus", category_zh: "校园",
        title_seed: "摄影社暗房里的秋季", premise: "大二男主在社团招新周被拉进摄影社,暗房与采风路上与社内 5 位女生各有交集,秋季影展前两周逐渐心动",
        setting: "美国 Crestwood 大学摄影社与城市采风点", start: { year: 2026, month: 10, day: 5 },
        identity: { gender: "男", age: 20, role_seed: "大二男生,本只想混学分却认真爱上按快门,新社员" },
        names: ["Lily", "Mia", "Ava", "Sofia", "Grace"],
        archetypes: {
            Lily: "学生会主席兼摄影社副社,大三,雷厉风行的飒爽学姐,对作品标准极高却会偷偷收藏你的废片",
            Mia: "美术系大三学姐,气质疏离如画中人,专拍人像,约你做模特的那天下午很漫长",
            Ava: "女篮队长,大二,运动系元气少女,快门永远对不准却最爱按,笑得比取景器还亮",
            Sofia: "校园电台主持人,大二,声音温柔治愈,每周三来社里录采访,耳机里外两个人",
            Grace: "数学系学霸,大二,借相机参数当论文写,天然呆,反差萌,全校社团都挖不动她只留在这里"
        }
    }
];

// ---- LLM 调用层(P3 同款:JSON ask / 围栏 askText / 1305-429 退避 20s / 5 次重试) ----
async function llm(system, user, maxTok, parse) {
    const body = { model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: Math.min(maxTok, MAX_TOK_CAP), temperature: 0.8 };
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
            const wait = /(429|1305)/.test(lastErr) ? 20000 : 2500 * (tryN + 1);
            if (tryN < 4) console.log("  LLM 重试 " + (tryN + 1) + ": " + lastErr.slice(0, 90) + " (等 " + (wait / 1000) + "s)");
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw new Error("LLM 失败: " + lastErr);
}
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
async function askOnce(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        try { return JSON.parse(raw); }
        catch (e) {
            const sq = raw.replace(CTRL, "").replace(/\r/g, "");
            if (sq !== raw) return JSON.parse(sq);
            throw e;
        }
    });
}
// JSON 槽:首轮(含限流退避 5 次);若仍解析失败,带"强制单行 JSON"硬警告换新 prompt 再战一轮
const ONE_LINE_WARN = "\n!!!上一次输出解析失败。强制要求:输出必须是【严格单行 JSON】——整段只能有一行,禁止任何换行与缩进美化;字段值若想分段,一律用空格或句点连接,不得用换行!!!";
async function ask(system, user, maxTok = 4000) {
    let lastErr = null;
    for (let round = 0; round < 2; round++) {
        try { return await askOnce(system, round === 0 ? user : user + ONE_LINE_WARN, maxTok); }
        catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("ask 失败");
}
function askText(system, user, maxTok = 4000) {
    return llm(system, user, maxTok, (raw) => {
        const m = raw.match(/<<<START>>>([\s\S]*?)<<<END>>>/);
        const out = (m ? m[1] : raw).trim();
        if (!out) throw new Error("空文本");
        return stripFences(out);
    });
}
// 围栏残留兜底:模型偶尔不闭合围栏/重复围栏,提取后仍可能有 <<START>> 类标记 → 全局剥离
function stripFences(s) {
    return String(s).replace(/<{2,3}\s*START\s*>{2,3}/gi, " ").replace(/<{2,3}\s*END\s*>{2,3}/gi, " ").replace(/[ \t]{2,}/g, " ").trim();
}

const SYS_BASE = "你是云吞吞文游的恋爱攻略向英语编剧(乙女/逆乙女文游向)。严格遵守输出格式要求,不输出任何格式之外的文字、注释或 markdown 围栏。";
const SYS_TEXT = "你是云吞吞文游的恋爱攻略向英语编剧。长文本用围栏包裹(围栏之外不要任何东西):\n<<<START>>>\n内容\n<<<END>>>";

function toneOf(b) { return "写作语言全英文;人称用 you(玩家);短句为主,对话自然浪漫不油腻,词汇全部限制在" + ({ hs: "高中大纲", cet4: "CET-4 大纲", cet6: "CET-6 大纲", ky: "考研大纲", toefl: "托福高频" })[b] + "以内,像真实英语青春小说。"; }

const CJK = /[一-鿿]/g;
function cjkCount(s) { return (String(s).match(CJK) || []).length; }
const EN_WARN = "\n(硬性检查:内容必须 100% 纯英文,任何中文/日文字符都算失败!)";
async function genEnBlock(label, doAsk) {
    for (let i = 0; i < 3; i++) {
        const raw = await doAsk(i > 0 ? EN_WARN : "");
        if (raw && cjkCount(raw) <= 2) return raw;
        console.log(label + "  含中文 " + cjkCount(raw) + " 字,重试…");
    }
    throw new Error("三次生成均含中文");
}

// ---- 槽位 1:标题 ----
async function genTitle(t) {
    const d = await ask(SYS_BASE,
        toneOf(t.band) + `\n为恋爱攻略英语卡起名(标题体现场景与心动钩子,不剧透结局):\n场景:${t.title_seed}\n` +
        `输出单行 JSON:{"title":"英文标题≤5词","title_zh":"中文标题≤8字"}`, 1500);
    return { title: String(d.title || "").trim().slice(0, 60), title_zh: String(d.title_zh || "").trim().slice(0, 30) };
}

// ---- 槽位 2:5 精修人设卡(一卡一角色,appearance_en 将作立绘 prompt 素材) ----
const CHAR_FIELDS = "{\"role_zh\":\"身份一句话(中文)\",\"age\":数字,\"appearance_en\":\"英文外貌 12-22 词纯外貌短句:体型身高/发色发型/瞳色/衣着/气质,直接可作 AI 绘画 prompt 主体\",\"personality_zh\":\"中文性格 2-3 句(含说话习惯)\",\"personality_en\":\"英文性格 2-3 句(说话习惯/口头禅)\",\"hobby_en\":\"英文兴趣 1 句\",\"redline_en\":\"英文雷区 1 句\",\"soft_en\":\"英文心动点 1 句(会被什么打动)\",\"speech_en\":\"英文称呼习惯 1 句(ta 怎么称呼你/常用语气)\",\"relationship_zh\":\"与玩家初始关系一句话(中文)\"}";
async function genCharCard(t, name, arch) {
    const d = await ask(SYS_BASE,
        toneOf(t.band) + `\n为恋爱攻略卡《${name} 的人设卡》细写角色「${name}」。该卡为${t.target === "female" ? "女向(玩家为女主)" : "男向(玩家为男主)"}攻略卡,${name} 是 5 个可攻略对象之一。\n` +
        `题材:${t.category_zh};场景:${t.setting}。\n角色原型(不得偏离):${arch}\n` +
        `注意:${name} 是让人向往的${t.target === "female" ? "男性" : "女性"},魅力点要有层次。写外貌时突出可画性(半身像构图友好)。\n` +
        `输出单行 JSON:${CHAR_FIELDS}`, 2500);
    const out = { name, gender: t.target === "female" ? "男" : "女", ...d };
    return out;
}

// ---- 槽位 3:text 设定(3 段接力;People 段按人设卡写 5 人;Arc 攻略向三幕) ----
async function genText(t, title, chars) {
    const charLines = chars.map((c) => `- ${c.name}:${c.personality_en}${c.hobby_en ? " 兴趣:" + c.hobby_en : ""}${c.soft_en ? " 心动点:" + c.soft_en : ""}${c.redline_en ? " 雷区:" + c.redline_en : ""}${c.speech_en ? " 称呼习惯:" + c.speech_en : ""}`).join("\n");
    const SEGS = [
        { n: 320, spec: "## Premise(3 句:主角是谁、此刻什么处境、想要什么)\n## The World(世界观 2-3 段,只含本卡相关范围:地点/人群/社团节奏)" },
        { n: 420, spec: `## People(恰好 5 人:${t.names.join("/")},顺序即登场顺序,不许改名/加人/漏人。每人 3-4 行,不要抄录下面人设卡原文,写:TA 在故事中的角色位置/你们最初如何相遇/相处时最鲜明的互动氛围):\n角色素材:\n${charLines}` },
        { n: 330, spec: "## Love Routes — meeting phase: 4-5 rounds in which the player naturally meets and lightly bonds with all five candidates one scene at a time; name each candidate's route hook in 1-2 lines (where that route leads, what unlocks closeness with that person). Heating phase: 5-6 rounds of deepening, the player may pursue 1-2 of the routes (3 concurrent lines max, the player decides whom to approach). Name at least 3 heartbeat-moment triggers (place + timing + mood, e.g. alone in the club room after a shared task, walking home together after rain, backstage before the show). Lock-line note: once one bond passes the threshold the others naturally step back into the background. Ending notes: HE = confessed mutual love with a proper confession scene; BE = warm affection that ends in a missed goodbye; the ending must contain a confession or farewell scene." },
        { n: 230, spec: "## Round map — list roughly 13-16 rounds as a simple table (use pipes or hyphens): round number | scene keyword | characters present. Finish with the ideal final round for a confession." }
    ];
    let acc = "";
    for (const seg of SEGS) {
        const piece = await genEnBlock(seg.n + "+", (warn) => askText(SYS_TEXT,
            `卡《${title}》英文恋爱攻略设定,分段协作写作,你只写其中一段;小节标题用 ## 开头。\n` +
            toneOf(t.band) + warn + `\n场景种子:${t.premise}。地点:${t.setting}。攻略对象名单(5 人,顺序即登场顺序):${t.names.join("/")}。\n` +
            (acc ? `前方已写内容(不要重复,顺着风格往下写):\n${acc.slice(-1500)}\n` : "") +
            `本段内容要求(从 ## 小节标题开始写):\n${seg.spec}\n` +
            `本段应约 ${seg.n} 词:写完后自己数一遍单词数,不足 ${Math.round(seg.n * 0.85)} 词就继续充实细节直到达标再收尾。`, 9000));
        acc = (acc ? acc + "\n\n" : "") + piece;
        console.log("  seg " + piece.split(/\s+/).length + " 词");
    }
    return acc;
}

// ---- 槽位 4:世界元信息 + 心动场景定义 ----
async function genWorldMeta(t, title, textHead) {
    const d = await ask(SYS_BASE,
        `卡《${title}》设定前段:\n${textHead}\n` +
        `输出单行 JSON:{"world":{"era":"时代/地域一句话(中文)","genre":"题材标签(中文,如:校园恋爱)","summary":"英文 4-6 句世界观综述(纯英文)","rules":"该世界对主角的 3-4 条规则(中文)","atmosphere":"氛围(中文)","vocab":["8 个本卡核心考点词(贴合${t.band})"]},"heartbeats":[{"where":"心动时刻地点(中文)","when":"触发时机/情绪条件(中文)"}]}`, 5000);
    return d;
}

// ---- 槽位 5:主角 identity ----
async function genIdentity(t, title, textHead) {
    const d = await ask(SYS_BASE,
        `卡《${title}》(${t.target === "female" ? "女向:玩家是女主" : "男向:玩家是男主"}):为主角定身份。参考前面设定,玩家以第二人称 you 存在。\n${textHead}\n` +
        `输出单行 JSON:{"name":"英文名","gender":"${t.identity.gender}","age":${t.identity.age},"role":"${t.identity.role_seed}","background":"英文 2-3 句背景(纯英文)"}`, 2000);
    return d.identity || d;
}

// ---- 槽位 6:开场(双语 story 围栏 + options JSON 带 love 标签与 target) ----
async function genFirstScene(t, title, text, chars) {
    const base = `卡《${title}》完整设定:\n${text.slice(0, 4600)}\n`;
    let story = await genEnBlock("fs", (warn) => askText(SYS_TEXT,
        base +
        `写开场故事:开始于设定时间点前几分钟,第二人称 you,现在时,340-420 词,停在「你必须立刻做选择」的节骨眼,不展开后续。` +
        `开场要让玩家与至少 2 位攻略对象${t.names[0]}/${t.names[1]}自然相遇(可按名字写,${t.names[0]}${t.names[1]}必须真人出场且有台词)。` +
        warn +
        `句长 8-15 词为主,对话自然,营造心动感的画面细节。`, 9000));
    const w0 = story.split(/\s+/).length;
    if (w0 < 300) {
        console.log("  fs " + w0 + " 词不足,补写…");
        const add = await askText(SYS_TEXT,
            base + `上面这份开场草稿还不够长(才 ${w0} 词)。请补写续段直接接在草稿末尾(从草稿最后一句话之后继续,不要重复),使总长达到 380-440 词。\n草稿原文:\n${story}\n输出格式:仅围栏包裹的续段内容。`, 9000);
        story = story + "\n\n" + add;
    }
    // options:带 love 标签(结算)+ target(作用对象),开场须 ≥2 正向(flirt/kind);模型偶尔漏 love 字段 → 渐进警告重问
    let options = [];
    const posN = (arr) => arr.filter((o) => o.love === "flirt" || o.love === "kind").length;
    const optPrompt = (warn, extra) => `开场故事节选:\n${story.slice(0, 2400)}\n` +
        `为这个开场设计 4 个可行动选项。每条一个 JSON 对象 {"text":"英文行动 4-10 词(具体行动,非是/否,you 视角)","love":"${LOVE_TAGS.join("/")} 之一","target":"该选项主要影响的对象:必须来自名单 ${t.names.join("/")} 之一"}\n` +
        `love 分布要求:至少 2 条正向(flirt 或 kind),1 条 tease/neutral,1 条由你按剧情定;target 建议 2 条给 ${t.names[0]}、1 条给 ${t.names[1]}。` +
        `love 与 target 字段是必填的,禁止省略、禁止拼写错误、禁止使用名单外的 target。\n` +
        `输出单行 JSON:{"options":[…]} (text 必须 100% 纯英文)` + warn + (extra || "");
    for (let i = 0; i < 5 && (options.length < 4 || posN(options) < 2); i++) {
        const extra = i === 0 ? "" : "\n!!!上一轮不合格(选项不足 4 条、或正向 flirt/kind 不足 2 条、或 love/target 字段缺失)。请重新输出完整的 4 条,每条的 love 必须显式给出且 target 必须在名单内!!!";
        const raw = await askText(SYS_TEXT, base + optPrompt(i >= 2 ? EN_WARN : "", extra), 2500);
        const m = raw.match(/\{[\s\S]*\}/);
        try {
            const obj = JSON.parse((m ? m[0] : raw).replace(CTRL, ""));
            const arr = Array.isArray(obj) ? obj : (Array.isArray(obj?.options) ? obj.options : null);
            if (arr) {
                options = arr.map((o) => ({
                    text: String(o.text || "").trim(),
                    love: LOVE_TAGS.includes(o.love) ? o.love : "neutral",
                    target: t.names.includes(o.target) ? o.target : t.names[0]
                })).filter((o) => o.text && cjkCount(o.text) === 0);
            } else { options = []; }
        } catch (e) { console.log("  opts JSON 解析失败,重问…(" + String(e).slice(0, 60) + ")"); options = []; }
        console.log("  opts " + options.length + " 条(正向 " + posN(options) + ")" + (options.length < 4 || posN(options) < 2 ? ",重问…" : ""));
    }
    return { story, options: options.slice(0, 4) };
}

// ---- QC:硬校验(含恋爱卡新规) ----
function qcCard(card, t) {
    const errs = [];
    const s = card.structured || {};
    if (!card.title || card.title.length < 2) errs.push("title 无效");
    if (!card.title_zh || card.title_zh.length < 2) errs.push("title_zh 无效");
    if (!BANDS.includes(card.band)) errs.push("band 无效");
    if (card.love_mode !== true) errs.push("love_mode 缺失");
    if (card.gender_target !== t.target) errs.push("gender_target 应为 " + t.target);
    if (!card.text || card.text.split(/\s+/).length < 800) errs.push("text 词数不足(<800): " + (card.text || "").split(/\s+/).length);
    if (s.band !== card.band) errs.push("structured.band 不一致");
    if (!s.world || !String(s.world.summary || "").trim()) errs.push("world.summary 缺失");
    if (!s.identity || !String(s.identity.name || "").trim()) errs.push("identity.name 缺失");
    const npcs = s.npcs || [];
    if (!Array.isArray(npcs) || npcs.length !== 5) errs.push("npcs 必须恰好 5 个,实得 " + npcs.length);
    if (npcs.map((n) => n && n.name).join(",") !== t.names.join(",")) errs.push("npcs 名字应为 " + t.names.join("/") + ",实得 " + npcs.map((n) => n && n.name).join("/"));
    const wantG = t.target === "female" ? "男" : "女";
    if (npcs.some((n) => n && n.gender !== wantG)) errs.push("npcs gender 须全为" + wantG + "(与 gender_target 互补)");
    if (s.identity && ((s.identity.gender || "") !== t.identity.gender)) errs.push("玩家性别应为 " + t.identity.gender);
    const lr = s.love_rules;
    if (!lr || typeof lr !== "object") errs.push("love_rules 缺失");
    else {
        if (!(lr.affection && typeof lr.affection === "object")) errs.push("love_rules.affection 缺失");
        if (Number(lr.lock_at) < 60) errs.push("lock_at 异常");
    }
    if (!s.first_scene || String(s.first_scene.story || "").split(/\s+/).length < 280) errs.push("first_scene.story 词数不足(<280)");
    const opts = s.first_scene?.options || [];
    if (!Array.isArray(opts) || opts.length < 3) errs.push("options 不足 3");
    else {
        const bad = opts.filter((o) => !(o && String(o.text || "").trim()));
        if (bad.length) errs.push(bad.length + " 个选项无 text");
        const badLove = opts.filter((o) => !LOVE_TAGS.includes(o.love));
        if (badLove.length) errs.push("选项 love 标签非法: " + JSON.stringify(badLove.map((o) => o.love)));
        const badTgt = opts.filter((o) => !t.names.includes(o.target));
        if (badTgt.length) errs.push("选项 target 越界: " + JSON.stringify(badTgt.map((o) => o.target)));
        const posN = opts.filter((o) => o.love === "flirt" || o.love === "kind").length;
        if (posN < 1) errs.push("选项须至少 1 个正向(flirt/kind)");
    }
    const all = card.text + " " + (s.first_scene?.story || "");
    const cjk = cjkCount(all);
    if (cjk > 5) errs.push("正文混入中文 " + cjk + " 字");
    return errs;
}

async function genOne(t) {
    const chars = [];
    console.log(`[${t.slug}] T1 标题…`);
    const meta = await genTitle(t);
    console.log(`[${t.slug}] T2 人设卡 5/5…`);
    for (let i = 0; i < t.names.length; i++) {
        const c = await genCharCard(t, t.names[i], t.archetypes[t.names[i]]);
        chars.push(c);
        console.log("  char " + (i + 1) + "/5 " + c.name + " (age " + c.age + ")");
    }
    const text = await genText(t, meta.title, chars);
    console.log(`[${t.slug}] text 合计 ` + text.split(/\s+/).length + " 词");
    console.log(`[${t.slug}] T3 世界元+心动场景…`);
    const meta2 = await genWorldMeta(t, meta.title, text.slice(0, 700));
    const head = text.slice(0, 900) + "\n…\n" + text.slice(-600);
    console.log(`[${t.slug}] T4 主角…`);
    const ident = await genIdentity(t, meta.title, head);
    const npcs = chars.map((c) => ({
        name: c.name, gender: c.gender, age: Number(c.age) || null,
        role: c.role_zh, personality: c.personality_zh, relationship: c.relationship_zh,
        appearance: c.appearance_en, profile: {
            personality: c.personality_en, hobby: c.hobby_en, redline: c.redline_en,
            soft: c.soft_en, speech: c.speech_en
        }
    }));
    console.log(`[${t.slug}] T5 开场…`);
    const fs1 = await genFirstScene(t, meta.title, text, chars);

    const structured = {
        band: t.band,
        theme: "minimal",
        love_mode: true,
        world: meta2.world || {},
        identity: ident,
        npcs,
        timeline: { start: t.start, note: "恋爱攻略线,单次会话 15-25 分钟可通关一段完整攻略" },
        scene_style: { env_templates: [], option_style: "romantic daily choices" },
        love_rules: {
            slots: 3,
            lock_at: 70,
            he_end: { min_affection: 75, heartbeat_min: 1 },
            be_end: { min_affection: 30 },
            affection: {
                flirt: { favor: 1, affection: 6 }, kind: { favor: 4, affection: 1 },
                tease: { favor: 2, affection: 2 }, neutral: { favor: 1, affection: 0 },
                awkward: { favor: 0, affection: -2 }, rude: { favor: -4, affection: -3 },
                reject: { favor: -3, affection: -8 }
            }
        },
        scenes: { heartbeat: meta2.heartbeats || [] },
        first_scene: { story: fs1.story, options: fs1.options }
    };
    const card = {
        title: meta.title, title_zh: meta.title_zh, lang: "en", band: t.band,
        category: t.category, category_zh: t.category_zh, theme: "minimal",
        love_mode: true, gender_target: t.target,
        text, structured
    };
    const errs = qcCard(card, t);
    return { card, chars, errs };
}

const only = args.only ? String(args.only) : "";
const wanted = TOPICS.filter((t) => !only || t.slug === only || t.slug.startsWith(only));
if (!wanted.length) { console.error("无匹配主题: " + only); process.exit(1); }
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
let okN = 0;
for (const t of wanted) {
    const f = path.join(OUT_DIR, t.slug + ".card.json");
    const charDir = path.join(OUT_DIR, t.slug + ".chars");
    try {
        const { card, chars, errs } = await genOne(t);
        if (errs.length) {
            console.log(`✗ ${t.slug} 质检失败:\n  - ` + errs.join("\n  - "));
            continue;
        }
        fs.mkdirSync(charDir, { recursive: true });
        for (let i = 0; i < chars.length; i++) {
            fs.writeFileSync(path.join(charDir, String(i + 1).padStart(2, "0") + "-" + chars[i].name + ".char.json"), JSON.stringify(chars[i], null, 2), "utf8");
        }
        fs.writeFileSync(f, JSON.stringify(card, null, 2), "utf8");
        console.log(`✓ ${t.slug} → ${f}(${(fs.statSync(f).size / 1024).toFixed(1)}KB) + 人设卡 ${charDir}`);
        okN++;
    } catch (e) {
        console.log(`✗ ${t.slug} 生成异常: ${e.message}`);
    }
}
console.log(`\n---- 完成: ${okN}/${wanted.length} 张质检过卡 ----`);
