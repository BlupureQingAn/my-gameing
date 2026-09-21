// 语言卡封面字段回填:scenarios/covers/lang_<pbId>.jpg 已落盘但 PB lang_cards.cover 为空 → PATCH 补上
// 背景:cover 是静态文件(不走 PB 文件存储),但前端/worker 是从记录字段读路径的,文件在而字段空 = 剧本库显示无封面
// 用法: node scripts/pb_sync_lang_covers.mjs --email ADMIN --password PASS [--pb https://db.blupure.cn] [--dry]
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const PB = (args.pb || process.env.PB_URL || "https://db.blupure.cn").replace(/\/$/, "");
const EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("缺少 --email/--password 或 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD"); process.exit(2); }
const DRY = "dry" in args;
const COVER_DIR = path.join(process.cwd(), "scenarios", "covers");
const coverPath = (id) => `covers/lang_${id}.jpg`;

async function pb(url, opts) {
    const res = await fetch(url, opts);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PB ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return d;
}

async function main() {
    const auth = await pb(`${PB}/api/collections/_superusers/auth-with-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
    });
    const H = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` };

    const list = await pb(`${PB}/api/collections/lang_cards/records?perPage=200&fields=id,title_zh,lang,cover`, { headers: H });
    const items = list.items || [];
    let fixed = 0, missing = 0, ok = 0;
    for (const c of items) {
        const want = coverPath(c.id);
        if (String(c.cover || "").trim() === want) { ok++; continue; }
        if (!fs.existsSync(path.join(COVER_DIR, `lang_${c.id}.jpg`))) {
            missing++;
            console.log(`缺文件  ${c.id}  ${c.lang}  ${c.title_zh}  (cover 现为 ${JSON.stringify(c.cover || "")})`);
            continue;
        }
        if (DRY) { console.log(`[dry] 待补 ${c.id} → ${want}`); fixed++; continue; }
        await pb(`${PB}/api/collections/lang_cards/records/${c.id}`, {
            method: "PATCH", headers: H, body: JSON.stringify({ cover: want })
        });
        fixed++;
        console.log(`OK     ${c.id}  ${c.lang}  ${c.title_zh}  → ${want}`);
    }
    console.log(`\n已一致 ${ok} / 本次补写 ${fixed} / 缺封面文件 ${missing} (共 ${items.length} 张)`);
}
main().catch((e) => { console.error("✗ 失败:", e.message); process.exit(1); });
