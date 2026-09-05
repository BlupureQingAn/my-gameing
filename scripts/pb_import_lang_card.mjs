// M6b 产卡脚本:结构化英语卡 JSON → lang_cards 集合(幂等 upsert)
// 用法: node scripts/pb_import_lang_card.mjs --pb https://db.blupure.cn --email ADMIN --password PASS \
//          --file docs/cards/first-semester.card.json [--id 记录id(更新)] [--status draft|online] [--order N]
// 环境变量 PB_URL/PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD 亦可;--file 缺省读 stdin
// JSON 形状(官方卡子集):
//   { title, title_zh, lang:"en", band:"cet4", category, category_zh, theme, text, structured:{...} }
//   structured 须含 band/world/identity/npcs/first_scene{story,options}/stats/endings 等 editor 协议键
import process from "node:process";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const PB = (args.pb || process.env.PB_URL || "https://db.blupure.cn").replace(/\/$/, "");
const EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("缺少 --email/--password 或 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD"); process.exit(2); }

const input = args.file
    ? fs.readFileSync(args.file, "utf8")
    : fs.readFileSync(0, "utf8");
const card = JSON.parse(input);

const BANDS = ["hs", "cet4", "cet6", "ky", "toefl"];
const LANGS = ["en", "ja", "ko"];
const STATUSES = ["draft", "online", "offline"];

// ---- 校验 ----
const errs = [];
if (!card.title || !String(card.title).trim()) errs.push("缺 title(英文名)");
if (!card.title_zh || !String(card.title_zh).trim()) errs.push("缺 title_zh(中文名)");
if (!BANDS.includes(card.band)) errs.push(`band 必须 ∈ [${BANDS}]`);
if (!LANGS.includes(card.lang || "en")) errs.push(`lang 必须 ∈ [${LANGS}]`);
if (!card.text || !String(card.text).trim()) errs.push("缺 text(英文设定全文,给 AI 当 world bible)");
if (!card.structured || typeof card.structured !== "object") errs.push("缺 structured");
else {
    if (String(card.structured.band || "") !== card.band) errs.push(`structured.band(${card.structured.band}) ≠ 顶层 band(${card.band})`);
    if (!card.structured.world || !String(card.structured.world.summary || "").trim()) errs.push("structured.world.summary 缺失(validateStructured 必填)");
    if (!card.structured.identity || !String(card.structured.identity.name || "").trim()) errs.push("structured.identity.name 缺失(validateStructured 必填)");
    if (!card.structured.first_scene || !String(card.structured.first_scene.story || "").trim()) errs.push("structured.first_scene.story 缺失(零 AI 首轮)");
    if (!Array.isArray(card.structured.first_scene?.options) || !card.structured.first_scene.options.length) errs.push("structured.first_scene.options 空(至少 1 选项)");
}
if (errs.length) { console.error("✗ 校验失败:\n  - " + errs.join("\n  - ")); process.exit(3); }

let token = null;
async function api(path, opts = {}) {
    const res = await fetch(PB + path, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
    return data;
}

const status = STATUSES.includes(args.status) ? args.status : "draft";
const record = {
    title: String(card.title).trim().slice(0, 80),
    title_zh: String(card.title_zh).trim().slice(0, 40),
    lang: card.lang || "en",
    band: card.band,
    category: String(card.category || card.structured.world?.genre || "").slice(0, 30),
    category_zh: String(card.category_zh || "").slice(0, 30),
    theme: String(card.theme || "minimal").slice(0, 30),
    data: { text: card.text, structured: card.structured },
    status,
};

async function main() {
    const auth = await api("/api/collections/_superusers/auth-with-password", {
        method: "POST", body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
    });
    token = auth.token;
    console.log("✓ 管理员登录成功");

    let targetId = args.id || "";
    if (!targetId) {
        // 幂等:同 title_zh+band 视为同一张卡,更新而非重复建
        const q = await api(`/api/collections/lang_cards/records?perPage=200&filter=${encodeURIComponent(`title_zh='${record.title_zh}' && band='${record.band}' && lang='${record.lang}'`)}`);
        if ((q.items || []).length) targetId = q.items[0].id;
    }

    if (targetId) {
        const patch = { ...record, ...(args.order ? { order: Number(args.order) } : {}) };
        await api(`/api/collections/lang_cards/records/${targetId}`, { method: "PATCH", body: JSON.stringify(patch) });
        console.log(`✓ 已更新 ${record.lang}/${record.band}「${record.title_zh}」 id=${targetId} status=${status}`);
    } else {
        let order = args.order ? Number(args.order) : null;
        if (!order) {
            const oq = await api("/api/collections/lang_cards/records?perPage=1&sort=-order");
            order = ((oq.items || [])[0]?.order || 0) + 1;
        }
        const created = await api("/api/collections/lang_cards/records", {
            method: "POST", body: JSON.stringify({ ...record, play_count: 0, unlock_count: 0, order })
        });
        console.log(`✓ 已创建 ${record.lang}/${record.band}「${record.title_zh}」 id=${created.id} status=${status} order=${order}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
