// M10 数据修复:清理卡数据里的 ＜START＞/＜END＞ 标记行(story 首末行 + bilingual 对应行)
//   来源:3 张 ja 卡产卡时 LLM 自带标记(其余 24 张卡无);不清则 full/渐进/简单模式首轮正文都显示「＜开始＞」
// 用法: node scripts/pb_clean_markers.mjs --id <PB记录id> [--file X.card.json(同步清本地)] \
//          --email ADMIN --password PASS [--dry-run]
//   --id 清 PB 记录(story + 若有 bilingual);--file 清本地 JSON(两者独立,可只给其一)
import process from "node:process";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
if (!args.id && !args.file) { console.error("至少给 --id(清PB) 或 --file(清本地)"); process.exit(2); }

const MARK_EN = /^[＜<](?:START|END)[＞>]$/i;
const MARK_ZH = /^[＜<](?:开始|结束)[＞>]$/;
const isMark = (s) => { const t = String(s || "").trim(); return MARK_EN.test(t) || MARK_ZH.test(t); };

function cleanStory(s) {
    const src = String(s || "");
    const lines = src.split("\n").filter((l) => !isMark(l));
    return { out: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), dropped: src.split("\n").length - lines.length };
}
function cleanBi(bi) {
    if (!bi || !Array.isArray(bi.lines)) return { out: bi, dropped: 0 };
    const lines = bi.lines.filter((l) => !(isMark((l || {}).en) || isMark((l || {}).zh)));
    return { out: { ...bi, lines }, dropped: bi.lines.length - lines.length };
}

async function main() {
    let token = null;
    if (args.id) {
        const EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
        const PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
        if (!EMAIL || !PASSWORD) { console.error("清 PB 需 --email/--password"); process.exit(2); }
        const PB = (args.pb || "https://db.blupure.cn").replace(/\/$/, "");
        const auth = await (await fetch(PB + "/api/collections/_superusers/auth-with-password", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
        })).json();
        token = auth.token;
        if (!token) { console.error("✗ 管理员登录失败"); process.exit(1); }

        const rec = await (await fetch(PB + "/api/collections/lang_cards/records/" + args.id, {
            headers: { Authorization: "Bearer " + token }
        })).json();
        if (!rec || !rec.id) { console.error("✗ 记录读取失败"); process.exit(1); }
        const data = rec.data || {};
        const st = data.structured || {};
        const fsc = st.first_scene || {};
        const cs = cleanStory(fsc.story);
        const cb = cleanBi(fsc.bilingual);
        if (!cs.dropped && !cb.dropped) {
            console.log(`[skip] ${rec.id}「${rec.title_zh}」无标记行`);
        } else if (args["dry-run"] !== undefined) {
            console.log(`[dry-run] PB ${rec.id}「${rec.title_zh}」: story 删 ${cs.dropped} 行(${String(fsc.story||'').length}→${cs.out.length} 字符) | bilingual 删 ${cb.dropped} 行(→${(cb.out&&cb.out.lines||[]).length} 行)`);
        } else {
            fsc.story = cs.out;
            if (cb.out !== undefined) fsc.bilingual = cb.out;
            st.first_scene = fsc;
            data.structured = st;
            const up = await fetch(PB + "/api/collections/lang_cards/records/" + args.id, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                body: JSON.stringify({ data })
            });
            if (!up.ok) { console.error("✗ PB 写回失败:", up.status, (await up.text()).slice(0, 200)); process.exit(1); }
            console.log(`✓ PB ${rec.id}「${rec.title_zh}」: story 删 ${cs.dropped} 行 | bilingual 删 ${cb.dropped} 行`);
        }
    }
    if (args.file) {
        const card = JSON.parse(fs.readFileSync(args.file, "utf8"));
        const fsc = ((card.structured || {}).first_scene) || {};
        const cs = cleanStory(fsc.story);
        const cb = cleanBi(fsc.bilingual);
        if (!cs.dropped && !cb.dropped) {
            console.log(`[skip] 本地 ${args.file} 无标记行`);
        } else if (args["dry-run"] !== undefined) {
            console.log(`[dry-run] 本地 ${args.file}: story 删 ${cs.dropped} 行 | bilingual 删 ${cb.dropped} 行(→${(cb.out && cb.out.lines || []).length} 行)`);
        } else {
            fsc.story = cs.out;
            if (cb.out !== undefined) fsc.bilingual = cb.out;
            card.structured.first_scene = fsc;
            fs.writeFileSync(args.file, JSON.stringify(card, null, 2));
            console.log(`✓ 本地 ${args.file}: story 删 ${cs.dropped} 行 | bilingual 删 ${cb.dropped} 行`);
        }
    }
    process.exit(0);
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
