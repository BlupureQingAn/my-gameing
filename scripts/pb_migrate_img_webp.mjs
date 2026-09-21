// PB 图片引用 WebP 迁移(2026-09-21 一次性):
//   lang_cards.cover  covers/lang_<id>.jpg → .webp
//   lang_cards.data   内嵌立绘 URL ..._<npc>.png → .webp
//   posts.image_data  scenario_preset_*.jpg → .webp
// 幂等:已经是 .webp 的记录跳过。用法:node scripts/pb_migrate_img_webp.mjs [--dry]
const PB = process.env.PB_URL || "https://db.blupure.cn";
const DRY = process.argv.includes("--dry");
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : [])));
const ADMIN_EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error("缺少 --email/--password 或 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD"); process.exit(2); }

async function pbJson(path, opts) {
    const res = await fetch(PB + path, opts);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
    return d;
}

async function main() {
    const admin = await pbJson("/api/collections/_superusers/auth-with-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + admin.token };

    let nCover = 0, nData = 0, nPost = 0;

    // 1) lang_cards:cover + data 内的立绘 URL
    const cards = await pbJson("/api/collections/lang_cards/records?perPage=200", { headers: H });
    for (const c of cards.items) {
        const patch = {};
        if (c.cover && /\.(jpg|jpeg|png)$/i.test(String(c.cover))) {
            patch.cover = String(c.cover).replace(/\.(jpg|jpeg|png)$/i, ".webp");
        }
        // data 是 JSON 字段:整体序列化后做字符串替换,再原样送回,不改结构
        if (c.data != null) {
            const raw = typeof c.data === "string" ? c.data : JSON.stringify(c.data);
            const out = raw.replace(/(loveart_[A-Za-z0-9_-]+)\.(?:jpg|jpeg|png)/g, "$1.webp");
            if (out !== raw) patch.data = typeof c.data === "string" ? out : JSON.parse(out);
        }
        if (!Object.keys(patch).length) continue;
        if (patch.cover) { nCover++; console.log(`  cover  ${c.id} ${c.cover} → ${patch.cover}`); }
        if (patch.data) { nData++; console.log(`  data   ${c.id} 立绘 URL → .webp`); }
        if (!DRY) await pbJson(`/api/collections/lang_cards/records/${c.id}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
    }

    // 2) posts.image_data
    const posts = await pbJson("/api/collections/posts/records?perPage=500", { headers: H });
    for (const p of posts.items) {
        if (!p.image_data || !/\.(jpg|jpeg|png)(\?|$)/i.test(String(p.image_data))) continue;
        const next = String(p.image_data).replace(/\.(?:jpg|jpeg|png)(\?|$)/i, ".webp$1");
        nPost++;
        console.log(`  post   ${p.id} ${p.image_data} → ${next}`);
        if (!DRY) await pbJson(`/api/collections/posts/records/${p.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ image_data: next }) });
    }

    // 3) users.faceimg:相对路径 avatars/avatar_NN.jpg 与绝对 URL .../avatars/m0.jpg 两种都要改
    let nUser = 0;
    const users = await pbJson("/api/collections/users/records?perPage=500", { headers: H });
    for (const u of users.items) {
        const av = String(u.faceimg || "");
        // 只动自家 avatars 静态资源:users.faceimg 里混着 login.mapay.cn 的第三方微信头像,
        // 那些不归我们管,改扩展名必 404
        if (!/^(avatars\/|https:\/\/bitlife\.blupure\.cn\/avatars\/)/.test(av)) continue;
        if (!/\.(jpg|jpeg|png)$/i.test(av)) continue;
        const next = av.replace(/\.(jpg|jpeg|png)$/i, ".webp");
        nUser++;
        if (nUser <= 4) console.log(`  faceimg ${u.id} ${av} → ${next}`);
        if (!DRY) await pbJson(`/api/collections/users/records/${u.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ faceimg: next }) });
    }
    if (nUser > 4) console.log(`  user   …共 ${nUser} 条`);

    console.log(`\n${DRY ? "[dry run] " : ""}cover ${nCover} / data ${nData} / posts ${nPost} / users ${nUser}`);
    if (!DRY && (nCover + nData + nPost)) {
        // 复查:再扫一遍确认没有残留(除 icons/pay 这类白名单外)
        const chk = await pbJson("/api/collections/lang_cards/records?perPage=200", { headers: H });
        const left = chk.items.filter((c) => JSON.stringify(c).match(/\.(jpg|jpeg|png)"/i)).length;
        console.log(`复查 lang_cards 残留: ${left} 条`);
    }
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
