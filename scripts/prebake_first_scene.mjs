// 语言卡"开场双语预制":对 structured.first_scene.story 切句(与前端 LangAssist cutSentences 同规则,按段切)
//   → 分批调用站点 gloss 接口(≤10 句/批)取得逐句 zh+词注 → 组装 bilingual.lines
//   en 行直接取原文切句 → 与播放端烘烤匹配 100%(无需依赖模型回显逐字一致)。
// 入库流程化:新卡 JSON → 本脚本 --inplace 生成 bilingual → pb_import_lang_card.mjs 导入上线(玩家零 AI 零等待)
//
// 用法:
//   node scripts/prebake_first_scene.mjs --file card.json [--inplace|--out out.json] [--dry-run]
//     --gloss-email <PB 登录邮箱> --gloss-password <密码>        # gloss 鉴权(seed 等会员号零配额限制)
//     [--pb-auth-url https://db.blupure.cn] [--gloss-url https://ai.blupure.cn] [--sleep-ms 6500]
//   gloss 接口每用户 6s 限频 → 默认批间隔 6.5s(可 --sleep-ms 0 提速,429 时自动退避 8s 重试)
import process from "node:process";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
if (!args.file) { console.error("缺少 --file <卡 JSON>"); process.exit(2); }
const glossEmail = args["gloss-email"];
const glossPassword = args["gloss-password"];
if (!glossEmail || !glossPassword) { console.error("缺少 --gloss-email/--gloss-password(站内 PB 账号,建议会员号:gloss 零配额零限制)"); process.exit(2); }
const AUTH_URL = (args["pb-auth-url"] || "https://db.blupure.cn").replace(/\/$/, "");
const GLOSS_URL = (args["gloss-url"] || "https://ai.blupure.cn").replace(/\/$/, "");
const SLEEP_MS = args["sleep-ms"] !== undefined ? Number(args["sleep-ms"]) : 6500;

// ---- 切句:复制前端 LangAssist cutSentences + ABBR(须与其保持同步,勿单独演化) ----
const ABBR = { "mr": 1, "mrs": 1, "ms": 1, "dr": 1, "st": 1, "vs": 1, "etc": 1, "e.g": 1, "i.e": 1, "no": 1, "inc": 1, "ltd": 1, "co": 1, "jr": 1, "sr": 1, "prof": 1, "capt": 1, "jan": 1, "feb": 1, "mar": 1, "apr": 1, "jun": 1, "jul": 1, "aug": 1, "sep": 1, "sept": 1, "oct": 1, "nov": 1, "dec": 1, "mt": 1, "rd": 1, "ave": 1, "approx": 1 };
function cutSentences(text) {
    const cuts = []; let s = 0, i, j, nx, len = text.length;
    for (i = 0; i < len; i++) {
        const c = text.charAt(i);
        if (c === "." || c === "!" || c === "?" || c === "…") {
            j = i + 1;
            while (j < len && '"\'”’)]}»'.includes(text.charAt(j))) j++;
            if (j >= len) { cuts.push([s, j]); return cuts; }
            if (/\s/.test(text.charAt(j))) {
                nx = j; while (nx < len && /\s/.test(text.charAt(nx))) nx++;
                if (nx < len && /[a-z0-9,;:（]/.test(text.charAt(nx))) { i = j - 1; continue; }
                if (c === ".") {
                    let ws = text.lastIndexOf(" ", i - 1) + 1;
                    if (ws < s) ws = s;
                    const tail = text.slice(ws, i + 1).replace(/[^A-Za-z.]/g, "").toLowerCase();
                    if (ABBR[tail]) { i = j - 1; continue; }
                }
                cuts.push([s, j]);
                s = j;
                i = j - 1;
            }
        }
    }
    if (s < len) cuts.push([s, len]);
    return cuts;
}
function splitByPara(text) {
    const out = [];
    for (const para of String(text || "").split(/\r?\n+/)) {
        for (const [a, b] of cutSentences(para)) {
            const t = para.slice(a, b).replace(/\s+/g, " ").trim();
            if (t) out.push(t);
        }
    }
    return out;
}

function esc(s) { return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 500); } // 500=worker GLOSS_SENTENCE_MAX_CHARS 同值

async function getToken() {
    const res = await fetch(AUTH_URL + "/api/collections/users/auth-with-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: glossEmail, password: glossPassword })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.token) throw new Error(`PB 登录失败(${res.status}): ${d.message || "未知错误"}`);
    return d.token;
}

async function callGloss(token, sentences) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(GLOSS_URL + "/api/lang/gloss", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token },
            body: JSON.stringify({ sentences })
        });
        if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 8000)); // 限频/忙碌退避重试
            continue;
        }
        const d = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(d.items)) return d.items;
        throw new Error(`gloss ${res.status}: ${d.error || "未知错误"} (${d.code || ""})`);
    }
    throw new Error(`gloss 连续 429(限频),已放弃,请稍后重跑`);
}

async function main() {
    const card = JSON.parse(fs.readFileSync(args.file, "utf8"));
    const fsObj = card.structured && card.structured.first_scene;
    if (!fsObj || !String(fsObj.story || "").trim()) { console.error("✗ structured.first_scene.story 缺失"); process.exit(3); }
    if (fsObj.bilingual && !args.force) { console.error(`✗ 已存在 bilingual(${fsObj.bilingual.lines?.length || 0} 行),重生成加 --force`); process.exit(3); }

    const sentences = splitByPara(fsObj.story);
    console.log(`✓ 切句 ${sentences.length} 句 (story ${fsObj.story.length} 字符)`);
    if (!sentences.length) process.exit(3);

    const token = await getToken();
    console.log(`✓ 登录 ${glossEmail}`);
    const zhBy = new Map();   // en 句 → {zh, words}
    async function translateBatch(batch) {
        const items = await callGloss(token, batch);
        for (const it of items) {
            const en = esc(it && it.sentence);
            if (!sentences.includes(en)) continue;
            const old = zhBy.get(en) || { zh: "", words: [] };
            const nw = Array.isArray(it?.words) ? it.words : [];
            zhBy.set(en, {
                zh: esc(it?.zh) || old.zh,
                words: nw.length ? nw : old.words   // 单句轮/兜底响应若缺 words,保留已有
            });
        }
        return batch.filter((s) => String(zhBy.get(s)?.zh || "").trim()).length;
    }
    for (let i = 0; i < sentences.length; i += 10) {
        const batch = sentences.slice(i, i + 10);
        const got = await translateBatch(batch);
        console.log(`  ✓ 批 ${Math.floor(i / 10) + 1}: ${got}/${batch.length} 句`);
        if (i + 10 < sentences.length) await new Promise((r) => setTimeout(r, SLEEP_MS));
    }
    // 模型偶发漏句/缺词注:单句聚焦重试 ≤2 轮(单句请求命中率高,连 words 一起补;
    // 群故障日批量 zh 多由有道兜底填充→words 恒空,单句轮可换成完整 AI 词注)
    const complete = (s) => {
        const g = zhBy.get(s);
        return g && String(g.zh || "").trim() && Array.isArray(g.words) && g.words.length;
    };
    for (let round = 0; round < 2; round++) {
        const again = sentences.filter((s) => !complete(s));
        if (!again.length) break;
        console.log(`  ↻ 单句重试第 ${round + 1} 轮:${again.length} 句(补 zh/词注)`);
        for (const s of again) {
            await translateBatch([s]);
            await new Promise((r) => setTimeout(r, SLEEP_MS));
        }
    }

    const lines = sentences.map((en) => {
        const g = zhBy.get(en);
        const zh = String(g?.zh || "").trim().slice(0, 600);
        const words = (Array.isArray(g?.words) ? g.words : [])
            .map((x) => ({ w: String(x?.w || "").trim().slice(0, 64), zh: String(x?.zh || "").trim().slice(0, 200) }))
            .filter((x) => x.w).slice(0, 3);
        return { en, zh, words };
    });
    const miss = lines.filter((l) => !l.zh).length;
    const noWd = lines.filter((l) => l.zh && !l.words.length).length;
    if (miss) console.warn(`⚠ ${miss} 句未取到译文(将标注空 zh,播放端走 queueGloss AI 兜底;建议重跑一次至 miss=0)`);
    if (noWd) console.warn(`⚠ ${noWd} 句有译文缺词注(群故障日 2 轮单句后仍空,不影响行间 zh;建议择时重跑补全)`);

    fsObj.bilingual = { v: 1, lines };
    const outPath = args.out || (args.inplace ? args.file : null);
    if (!outPath) {
        console.log(JSON.stringify(fsObj.bilingual, null, 1).slice(0, 2000));
        console.log(`…共 ${lines.length} 行(未写盘,用 --inplace 写回或 --out 指定)`);
    } else {
        fs.writeFileSync(outPath, JSON.stringify(card, null, 2), "utf8");
        console.log(`✓ 已写入 ${outPath} (bilingual ${lines.length} 行, miss=${miss})`);
    }
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
