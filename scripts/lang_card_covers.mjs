// 英语卡(M8a)官方封面生成:5 张在线卡手写 prompt(视觉体系同中文官方卡 4:3 无字横版)→ POST 生产 cover 接口 pregen 通道
// → 落盘 scenarios/covers/lang_{pbId}.jpg(静态文件,前端 CoverService 直接归一加载,不走 KV)
// 用法: node scripts/lang_card_covers.mjs --email PB管理员邮箱 --password PB管理员密码 [--pb https://db.blupure.cn]
// pregen key 读取: 环境变量 COVER_PREGEN_KEY_FILE(默认 F:/Claude/cover-pregen-key,worker secret COVER_PREGEN_KEY 同值)
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const PB = (args.pb || process.env.PB_URL || "https://db.blupure.cn").replace(/\/$/, "");
const ADMIN_EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error("缺少 --email/--password 或 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD"); process.exit(2); }
const BASE = "https://ai.blupure.cn";
const KEY_FILE = process.env.COVER_PREGEN_KEY_FILE || "F:/Claude/cover-pregen-key";
const PREGEN_KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
const OUT_DIR = path.join(process.cwd(), "scenarios", "covers");
const USER_EMAIL = "cover_pregen@test.local";
const USER_PASS = "cover_pregen_2026!";

// 每卡 prompt(手写,≤200 字符;主体/场景/氛围中文 + 风格段英文,对齐旧 6 段模板气质)
const CARDS = [
    { id: "438v6062rf5eorf", file: "card-01-first-semester.card.json",
      prompt: "大一新生 Kai 独自拖着行李箱,深夜抵达美国小城大学城的初秋校园,路灯下的忐忑与期待;Makoto Shinkai style, youthful campus anime, warm hopeful light;4:3 横版封面构图;8k, highly detailed, masterpiece, no text, no watermark" },
    { id: "l5swqbkdmta2n1h", file: "card-02-moonlight-diner.card.json",
      prompt: "海风小镇主街尽头的午夜 diner,雨夜霓虹在湿沥青上倒映,窗内夜班服务员 Riley 的身影,怪谈却温暖;atmospheric anime illustration, film-noir neon reflections, cozy mystery mood;4:3 横版封面构图;8k, highly detailed, masterpiece, no text, no watermark" },
    { id: "kwtlgha9t7on3hk", file: "card-03-last-train-home.card.json",
      prompt: "深夜 23:47 空荡的末班车厢,一人独坐,昏黄车厢灯,黑窗滑落雨痕,克制的怪谈与酸暖;Makoto Shinkai style night train, melancholic, rain-streaked glass reflections;4:3 横版封面构图;8k, highly detailed, masterpiece, no text, no watermark" },
    { id: "jganx0kf0rvm77v", file: "card-04-night-watch.card.json",
      prompt: "北境边城 Kilgore 雪前的冬夜,结霜的城墙砖与火炬光,见习夜巡 Rowan 持灯巡墙,墙根浓雾低伏,人文向低奇幻;warm epic fantasy illustration, torchlight frost and fog, grounded human heroic;4:3 横版封面构图;8k, highly detailed, masterpiece, no text, no watermark" },
    { id: "zgtcu5wjqmp01ec", file: "card-05-echoes-of-the-deep.card.json",
      prompt: "近未来离岸声学监听站,冬夜风暴中的甲板,屏幕波形微光,夜班技术员 Avery 望着墨色大海,克制悬念;cinematic sci-fi illustration, deep-sea listening station, storm-lit, restrained suspense;4:3 横版封面构图;8k, highly detailed, masterpiece, no text, no watermark" }
];

async function pbJson(url, opts) {
    const res = await fetch(url, opts);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PB ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return d;
}
async function getToken() {
    const admin = await pbJson(`${PB}/api/collections/_superusers/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
    const adminH = { "Content-Type": "application/json", "Authorization": `Bearer ${admin.token}` };
    const tryLogin = () => pbJson(`${PB}/api/collections/users/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: USER_EMAIL, password: USER_PASS })
    });
    try { return (await tryLogin()).token; } catch (e) {}
    // 预生成账号不存在才创建(密码曾改过/被删的兜底)
    await pbJson(`${PB}/api/collections/users/records`, {
        method: "POST", headers: adminH,
        body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS, passwordConfirm: USER_PASS, name: "封面预生成", verified: true })
    });
    console.log("已创建预生成账号", USER_EMAIL);
    return (await tryLogin()).token;
}
async function genOne(prompt, token, forceSF) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 150000);
    try {
        const res = await fetch(`${BASE}/api/cover/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token, "X-Cover-Pregen": PREGEN_KEY },
            body: JSON.stringify(forceSF ? { prompt, provider: "siliconflow" } : { prompt }),
            signal: ac.signal
        });
        clearTimeout(timer);
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.image) return { ok: false, status: res.status, err: String(d.error || "no image").slice(0, 120) };
        return { ok: true, image: d.image, genErr: String(d.genErr || "") };
    } catch (e) {
        clearTimeout(timer);
        return { ok: false, status: 0, err: String(e).slice(0, 120) };
    }
}
async function main() {
    const token = await getToken();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`待生成 ${CARDS.length} 张,key=${PREGEN_KEY.slice(0, 6)}…,输出 ${OUT_DIR}`);
    for (const c of CARDS) {
        const src = path.join(process.cwd(), "docs", "english-cards", c.file);
        if (!fs.existsSync(src)) { console.log(`SKIP ${c.id} 缺 ${c.file}`); continue; }
        let r = await genOne(c.prompt, token, false);
        if (!r.ok && (r.status === 503 || r.status === 502 || r.status === 0)) {
            console.log(`  ${c.id} Agnes 失败(${r.err}),转 SILICONFLOW 重试…`);
            await new Promise((s) => setTimeout(s, 5000));
            r = await genOne(c.prompt, token, true);
        }
        if (!r.ok) { console.log(`FAIL ${c.id} ${r.status} ${r.err}`); continue; }
        const b64 = String(r.image).split(",")[1] || "";
        const buf = Buffer.from(b64, "base64");
        const out = path.join(OUT_DIR, `lang_${c.id}.jpg`);
        fs.writeFileSync(out, buf);
        console.log(`OK   ${c.id} → lang_${c.id}.jpg ${(buf.length / 1024).toFixed(0)}KB ${r.genErr || ""}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
