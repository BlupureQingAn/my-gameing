// M10 回写:把本地卡 JSON 的 structured.first_scene.bilingual 写回 PB 记录
//   只动该字段——不碰 title/title_zh/status/cover/order/category(与 pb_import_lang_card.mjs 全量 PATCH 的区别所在)
// 用法: node scripts/pb_writeback_bilingual.mjs --file X.card.json --id <PB记录id> \
//          --email ADMIN --password PASS [--dry-run]
// 前置: 本地卡须先跑 prebake_first_scene.mjs --inplace 生成 bilingual
import process from "node:process";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
if (!args.file || !args.id) { console.error("缺少 --file/--id"); process.exit(2); }
const PB = (args.pb || "https://db.blupure.cn").replace(/\/$/, "");
const EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("缺少 --email/--password"); process.exit(2); }

const card = JSON.parse(fs.readFileSync(args.file, "utf8"));
const bilingual = card.structured?.first_scene?.bilingual;
if (!bilingual || !Array.isArray(bilingual.lines) || !bilingual.lines.length) {
    console.error("✗ 本地卡无 bilingual,先跑 prebake_first_scene.mjs --inplace"); process.exit(3);
}

async function main() {
    const authRes = await fetch(PB + "/api/collections/_superusers/auth-with-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
    });
    const auth = await authRes.json();
    if (!auth.token) { console.error("✗ 管理员登录失败:", JSON.stringify(auth).slice(0, 200)); process.exit(1); }

    const recRes = await fetch(PB + "/api/collections/lang_cards/records/" + args.id, {
        headers: { Authorization: "Bearer " + auth.token }
    });
    const rec = await recRes.json();
    if (!rec || !rec.id) { console.error("✗ 记录读取失败:", JSON.stringify(rec).slice(0, 200)); process.exit(1); }

    const data = rec.data || {};
    const st = data.structured || {};
    const fsc = st.first_scene || {};
    const before = ((fsc.bilingual || {}).lines || []).length;
    fsc.bilingual = bilingual;
    st.first_scene = fsc;
    data.structured = st;

    if (args["dry-run"] !== undefined) {
        console.log(`[dry-run] ${rec.id}「${rec.title_zh}」 bilingual ${before} → ${bilingual.lines.length} 行 (status=${rec.status})`);
        process.exit(0);
    }

    const up = await fetch(PB + "/api/collections/lang_cards/records/" + args.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token },
        body: JSON.stringify({ data })
    });
    const upj = await up.json();
    if (!up.ok) { console.error("✗ 写回失败:", up.status, JSON.stringify(upj).slice(0, 300)); process.exit(1); }
    const after = (((upj.data || {}).structured || {}).first_scene || {}).bilingual;
    console.log(`✓ 写回 ${rec.lang || ""}/${rec.band || ""}「${rec.title_zh}」 id=${rec.id}: bilingual ${before} → ${(after && after.lines || []).length} 行 (status=${upj.status || "?"})`);
    process.exit(0);
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
