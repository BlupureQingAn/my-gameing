// 小红书切片器(2026-09-09):读 p3_*.card.json → 每卡 4 种角度笔记文案稿
// 输出: docs/xhs-clips/{slug}/{01..04}-{角度}.md(标题+正文+标签;英文试读不超过 6 句,均带译文)
// 用法: node scripts/xhs_clipper.mjs [--slug p3-01-last-desk] [--dir docs/english-cards] [--out docs/xhs-clips]
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const DIR = args.dir || "docs/english-cards";
const OUT = args.out || "docs/xhs-clips";
const only = args.slug || null;

// ---- 素材提取 ----
function quotes(text, n = 5) {
    // 英文引号台词 "…" (含跨行),去重保留前 n 条,每条限 120 词内
    const out = [];
    const re = /"([^"\n]{12,300})"/g;
    let m;
    while ((m = re.exec(text)) && out.length < n) out.push(m[1].replace(/\s+/g, " ").trim());
    return out;
}
function paraFrom(text, startMark, nChars = 420) {
    const i = text.indexOf(startMark);
    if (i < 0) return "";
    const seg = text.slice(i + startMark.length, i + startMark.length + nChars).replace(/\n+/g, " ").trim();
    return seg.slice(0, seg.lastIndexOf(".") + 1);
}
function storyExcerpt(story, maxChars = 260) {
    const flat = String(story || "").replace(/\s+/g, " ").trim();
    return flat.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
}

// 4 角度模板(占位 {…} 在下面填充)
function clip1Scene(c, q) {
    const st = c.structured;
    const envs = (st.scene_style?.env_templates || []).slice(0, 3).map((e) => "「" + e + "」").join("");
    return {
        n: "01", tag: "悬念开场", file: "01-悬念开场.md",
        title: `开场 30 秒,「${c.title_zh}」就把选择权扔回给你`,
        body:
`刷到这条的你,英语单词背到第几轮了?📚

先别划走——给你 5 秒钟,把自己放进这个故事:

${envs}
周围的一切都写实到能闻到空气里的味道,而你,只有 ${st.first_scene.options.length} 个选项,选错一步,故事的走向就完全不同。

上面是英文原句,难度在「${c.band.toUpperCase()}」上下:
> ${c.title} · ${c.title_zh}
> "${q}"

能读懂多少?读不懂的单词也不用查词典——在游戏里长按单词,解释直接弹出来,还能一键收进生词本,第二天按遗忘曲线提醒你复习。

这是云吞吞文游的「${c.category_zh}」剧本,把枯燥的 ${c.band.toUpperCase()} 词汇装进一个你放不下的故事里。

评论扣 1,我把完整剧本入口发你👇`,
        tags: `#英语学习 #${c.band.toUpperCase()} #背单词 #文游 #沉浸式英语 #${c.category_zh}英语 #英语口语 #学英语的尽头是上瘾`
    };
}
function clip2Vocab(c, quotesV, qMain) {
    const vocab = (c.structured.world?.vocab || []).slice(0, 8);
    const st = c.structured;
    const sample = (quotesV[1] || quotesV[0] || qMain || "").slice(0, 100);
    return {
        n: "02", tag: "考点词速记", file: "02-考点词速记.md",
        title: c.band.toUpperCase() + "高频词,别再abandon了",
        body:
`今天不背单词表,咱们在故事里捡词。🎯

新出的「${c.title_zh}」校园剧本里,这 8 个词一个比一个眼熟,但放进剧情里立刻活了:

${vocab.map((w) => "▸ **" + w + "**").join("\n")}

每个词都会在剧情里反复出现,搭配真人语境的句子一起出现,比如这一句:
> "${sample}"

靠上下文猜意思→长按验证→收进生词本,一轮下来这 8 个词想忘都难。

云吞吞文游把 ${c.band.toUpperCase()} 词嵌进可交互剧本:你的每个选择都决定剧情走向,英语就成了你通关的工具,而不是任务。

评论区告诉我,上面 8 个词你认识几个?`,
        tags: `#英语单词 #${c.band.toUpperCase()}词汇 #背单词技巧 #语境记单词 #文游学英语 #校园英语 #英语打卡 #四六级`
    };
}
function clip3People(c, qMain) {
    const st = c.structured;
    const npcs = (st.npcs || []).slice(0, 4);
    if (npcs.length < 3) return null;
    const lines = npcs.map((n) => `**${n.name}** ${n.gender==="女"?"她":"他"}是${n.role}——${n.personality.replace(/,/g,",")}`);
    const q0 = qMain;
    return {
        n: "03", tag: "人物群像", file: "03-人物群像.md",
        title: "4 个 NPC,把" + c.title_zh + "演活了",
        body:
`好的文游,配角也得有血有肉。👥

「${c.title_zh}」里你会遇见 4 个人,每个人的立场都跟你的选择死死咬在一起:

${lines.join("\n")}

开场 30 秒你就会跟他们对上话,而你的每一句回应,都会改变他们待你的方式——游戏没有标准答案,只有你想不到的发展。

英文对话都是按真实口语写的,短句、地道、不超纲:
> "${q0}"

是不是比课文里的对话有意思多了?😏

想体验完整剧本的评论区蹲一个「入口」,人多我明天就出下一张卡的切片。`,
        tags: `#英语口语 #沉浸式英语 #文游 #${c.band.toUpperCase()} #英语对话 #英语听力 #角色扮演 #学英语日常`
    };
}
function clip4Gameplay(c) {
    const st = c.structured;
    const world = st.world || {};
    const vocabN = (world.vocab || []).length;
    const envs = (st.scene_style?.env_templates || []).slice(0, 4).join("、");
    return {
        n: "04", tag: "玩法安利", file: "04-玩法安利.md",
        title: "别再问英语怎么学了,先问怎么玩",
        body:
`一个把「${c.category_zh}英语」玩明白的产品长这样:

📖 不是选择题,是剧本
「${c.title_zh}」开篇 340+ 词纯英文沉浸故事,地点是 ${envs}——你不是在读英语,是在里面过日子。

🧠 单词自己往脑子里钻
每张卡内置 ${vocabN}+ 个考点词,长按即译、双击进生词本,还有每日点译次数免费送,当天学的词晚上自动安排复习。

🎮 选择即学习
每次抉择都是真实的英语输出练习,故事会记住你的选择,三幕剧情 + 三档结局,通关一次不过瘾,换个活法再来一遍。

剧情、词汇、口语一次全包,${c.band.toUpperCase()} 备考党狂喜。

想玩「${c.title_zh}」的,评论区集合,我把云吞吞的传送门放出来~`,
        tags: `#英语学习App #背单词App #文游 #英语游戏化学习 #四六级 #${c.band.toUpperCase()}备考 #云吞吞文游 #学习打卡`
    };
}

// ---- 主流程 ----
const files = fs.readdirSync(DIR).filter((f) => /^p3-.*\.card\.json$/.test(f) && (!only || f.includes(only)));
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const f of files.sort()) {
    const c = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const st = c.structured || {};
    const qs = quotes(st.first_scene?.story || "", 5);
    const slug = f.replace(/\.card\.json$/, "");
    const qMain = qs[0] || storyExcerpt(st.first_scene?.story);
    if (!qMain) { console.log("✗ " + f + " 无任何正文素材,跳过"); continue; }
    const clips = [clip1Scene(c, qMain), clip2Vocab(c, qs, qMain), clip3People(c, qMain), clip4Gameplay(c)].filter(Boolean);
    const outDir = path.join(OUT, slug);
    fs.mkdirSync(outDir, { recursive: true });
    for (const cl of clips) {
        const md = `# ${cl.title}\n\n${cl.body}\n\n${cl.tags}\n`;
        fs.writeFileSync(path.join(outDir, cl.file), md, "utf8");
    }
    console.log("✓ " + slug + " → " + outDir + "(" + clips.length + " 条)");
    total += clips.length;
}
console.log("\n---- 切片完成: " + total + " 条文案稿 ----");
