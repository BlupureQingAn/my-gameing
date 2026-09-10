// R1 M4 角色立绘批量生成:遍历 docs/english-cards/{r1,m5}-*.card.json 的 structured.npcs
// prompt = 人名 + 性别化固定画风 + npc.appearance(总长≤200,超长按词截断) → /api/cover/generate ratio 3:4(pregen 通道)
// 画风:女=japanese anime 定稿(小徐 2026-09-10 确认);男=照片级半写实 CG(小徐 2026-09-10 指定)
// 产物: scenarios/covers/loveart_{slug}_{npc}.png(全小写下划线);并回填卡 JSON structured.npcs[i].art(https://bitlife.blupure.cn/scenarios/covers/xxx.png)
// 用法: node F:/Claude/tmp/gen_love_art.mjs <pregenKey> <pbAdminEmail> <pbAdminPassword> [--slug r1-01] [--dry]
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
).filter(([k]) => ["slug", "dry"].includes(k)));
const [pregenKey, pbAdminEmail, pbAdminPassword] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (!pregenKey || !pbAdminEmail || !pbAdminPassword) {
    console.error("用法: node gen_love_art.mjs <pregenKey> <pbAdminEmail> <pbAdminPassword> [--slug r1-01]");
    process.exit(1);
}
const PB_URL = process.env.PB_URL || "https://db.blupure.cn";
const API = process.env.COVER_API || "https://ai.blupure.cn/api/cover/generate";
const CARDS_DIR = "docs/english-cards";
const OUT_DIR = "scenarios/covers";
const STATIC_BASE = "https://bitlife.blupure.cn/scenarios/covers/";
const MAX_PROMPT = 200;
// 女向定稿(jp_anime 样张,小徐 2026-09-10:"女生的挺合适"):不动
const STYLE_F = "Japanese anime key visual style, clean cel shading, vivid bright colors, large expressive eyes, waist-up bust portrait";
const SUFFIX_F = ", soft blurred campus background, high quality";
// 男向新画风(小徐 2026-09-10 指定):照片级半写实 CG + 冷调电影人像光影 + 漫画化精致美少年 + 真人摄影质感/二次元美化五官
// male/young man 双锚点防性别漂移(旧版无性别锚,多个男角色被画成女生)
const STYLE_M = "Photorealistic semi-realistic CG, cool cinematic lighting, refined beautiful young man, real-photo texture, anime-refined features, male";
const SUFFIX_M = ", bust shot";
const isMaleNpc = (npc) => String((npc && npc.gender) || "").trim() === "男";

function slugify(s) { return String(s || "npc").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function enHead(s, n) {
    const words = String(s || "").split(/\s+/).filter(Boolean);
    let out = "";
    for (const w of words) { if ((out + " " + w).trim().length > n) break; out = (out ? out + " " : "") + w; }
    return out.trim();
}

async function pbJson(url, opts) {
    const res = await fetch(url, opts);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PB ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return d;
}
async function getToken() {
    const admin = await pbJson(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: pbAdminEmail, password: pbAdminPassword })
    });
    const USER_EMAIL = "cover_pregen@test.local";
    const USER_PASS = "cover_pregen_2026!";
    const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${admin.token}` };
    try {
        await pbJson(`${PB_URL}/api/collections/users/records`, {
            method: "POST", headers: authH,
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS, passwordConfirm: USER_PASS, name: "封面预生成", verified: true })
        });
        console.log("已创建预生成账号", USER_EMAIL);
    } catch (e) {
        if (!/validation_not_unique/.test(String(e.message))) throw e;
    }
    const user = await pbJson(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: USER_EMAIL, password: USER_PASS })
    });
    return user.token;
}

const onlySlug = args.slug ? String(args.slug) : "";
const cardFiles = fs.readdirSync(CARDS_DIR).filter((f) => /^(r1|m5)-.*\.card\.json$/.test(f) && (!onlySlug || f.startsWith(onlySlug))).sort();
if (!cardFiles.length) { console.error("无匹配卡:", onlySlug || "r1-*/m5-*"); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const token = await getToken();
let ok = 0, failed = 0, skipped = 0;
const perCard = [];
for (const cf of cardFiles) {
    const card = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, cf), "utf8"));
    const slug = cf.replace(/\.card\.json$/, "");
    const npcs = (card.structured && Array.isArray(card.structured.npcs)) ? card.structured.npcs : [];
    const filled = [];
    for (const npc of npcs) {
        if (!npc || !npc.name) continue;
        const nm = slugify(npc.name);
        const rel = `loveart_${slug}_${nm}.png`;
        const file = path.join(OUT_DIR, rel);
        if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
            console.log(`SKIP ${rel} 已存在`);
            filled.push({ name: npc.name, art: STATIC_BASE + rel });
            skipped++;
            continue;
        }
        const male = isMaleNpc(npc);
        const STYLE = male ? STYLE_M : STYLE_F;
        const SUFFIX = male ? SUFFIX_M : SUFFIX_F;
        // 人名前缀:多一个身份/性别锚点,并保证同批 prompt 两两不同(旧版截断后多个角色 prompt 撞车出同图)
        const prefix = String(npc.name).trim() + ", " + STYLE + ", ";
        const body = enHead(String(npc.appearance || npc.personality || "").replace(/\s+/g, " ").trim(), MAX_PROMPT - prefix.length - SUFFIX.length);
        if (!body) { console.log(`SKIP ${npc.name} 无 appearance 描述`); filled.push({ name: npc.name, art: "" }); skipped++; continue; }
        const prompt = (prefix + body + SUFFIX).slice(0, MAX_PROMPT);
        if (args.dry !== undefined) { console.log(`DRY[${male ? "M" : "F"}] ${npc.name} (${prompt.length}): ${prompt}`); skipped++; continue; }
        const start = Date.now();
        try {
            const res = await fetch(API, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Auth-Token": `Bearer ${token}`, "X-Cover-Pregen": pregenKey },
                body: JSON.stringify({ prompt, ratio: "3:4" }),
                signal: AbortSignal.timeout(180000)
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.image) throw new Error(`${res.status} ${d.error || ""}`);
            const b64 = String(d.image).slice(String(d.image).indexOf(",") + 1);
            fs.writeFileSync(file, Buffer.from(b64, "base64"));
            console.log(`OK   ${rel} ${(Date.now() - start) / 1000}s`);
            filled.push({ name: npc.name, art: STATIC_BASE + rel });
            ok++;
        } catch (e) {
            failed++;
            console.log(`FAIL ${npc.name}: ${String(e).slice(0, 140)}`);
            filled.push({ name: npc.name, art: "" });
        }
    }
    perCard.push({ file: path.join(CARDS_DIR, cf), card, filled });
}

// 回填卡 JSON structured.npcs[i].art
let refilled = 0;
for (const { file, card, filled } of perCard) {
    const map = new Map(filled.filter((f) => f.art).map((f) => [f.name, f.art]));
    let chg = false;
    for (const npc of (card.structured.npcs || [])) {
        const a = npc && npc.name ? map.get(npc.name) : "";
        if (a && npc.art !== a) { npc.art = a; chg = true; }
    }
    if (chg) { fs.writeFileSync(file, JSON.stringify(card, null, 2), "utf8"); refilled++; }
}
console.log(`\n完成: 新生成 ${ok} / 失败 ${failed} / 跳过 ${skipped};回填卡 ${refilled}/${perCard.length} 张 → ${OUT_DIR}/`);
