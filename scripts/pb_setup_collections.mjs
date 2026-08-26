// PocketBase 集合自动化创建（幂等，可重复跑）
// 用法: node scripts/pb_setup_collections.mjs --pb https://db.blupure.cn --email ADMIN邮箱 --password 密码
// 或环境变量 PB_URL/PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD
// 动作: ①users 集合补字段(缺才补) ②11 个业务集合不存在则创建(读取公开/写仅管理员)
import process from "node:process";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? ""]] : []
));
const PB = (args.pb || process.env.PB_URL || "https://db.blupure.cn").replace(/\/$/, "");
const ADMIN_EMAIL = args.email || process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = args.password || process.env.PB_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error("缺少 --email/--password 或 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD"); process.exit(2); }

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

const F = {
    text: (name, { req = false, max = null } = {}) => ({ name, type: "text", required: req, ...(max ? { max } : {}) }),
    number: (name, { req = true, min = 0 } = {}) => ({ name, type: "number", required: req, min, max: null }),
    json: (name, { req = true, size = 4000000 } = {}) => ({ name, type: "json", required: req, maxSize: size }),
    select: (name, values, { req = true } = {}) => ({ name, type: "select", required: req, values, maxSelect: 1 }),
    autodate: (name = "created_at") => ({ name, type: "autodate", onCreate: true, onUpdate: false }),
};
const READ_PUBLIC = { listRule: "", viewRule: "" };
const ADMIN_WRITE = { createRule: null, updateRule: null, deleteRule: null };

// 业务集合定义（字段对应 worker.js 读写）
const COLLECTIONS = [
    { name: "posts", type: "base", fields: [F.text("content", { req: true, max: 500 }), F.text("author_id", { req: true }), F.text("card_id", { max: 64 }), F.text("image_data", { max: 500000 }), F.number("likes_count"), F.number("comments_count"), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "post_likes", type: "base", fields: [F.text("post_id", { req: true }), F.text("user_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "post_comments", type: "base", fields: [F.text("post_id", { req: true }), F.text("user_id", { req: true }), F.text("content", { req: true, max: 200 }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "follows", type: "base", fields: [F.text("follower_id", { req: true }), F.text("user_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "unlocks", type: "base", fields: [F.text("user_id", { req: true }), F.text("card_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "community_cards", type: "base", fields: [F.text("title", { req: true }), F.text("category"), F.text("theme"), F.json("data"), F.text("author_id", { req: true }), F.select("status", ["pending", "approved"]), F.number("play_count"), F.number("earned_plays"), F.number("unlock_count"), F.json("daily_plays", { req: false, size: 2000000 }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "card_likes", type: "base", fields: [F.text("card_id", { req: true }), F.text("user_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "card_collects", type: "base", fields: [F.text("card_id", { req: true }), F.text("user_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "donations", type: "base", fields: [F.text("card_id", { req: true }), F.text("user_id", { req: true }), F.text("author_id"), F.number("amount", { min: 1 }), F.text("role_id"), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "reviews", type: "base", fields: [F.text("card_id", { req: true }), F.text("user_id", { req: true }), F.text("content", { req: true, max: 200 }), F.text("parent_id", { max: 64 }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
    { name: "character_favorites", type: "base", fields: [F.text("card_id", { req: true }), F.text("character_id", { req: true }), F.text("user_id", { req: true }), F.autodate()], ...READ_PUBLIC, ...ADMIN_WRITE },
];

// users 集合需要确保存在的字段（auth 集合，缺了才补，不动规则）
const USERS_NEED = {
    "coins": F.number("coins"), "last_checkin_date": F.text("last_checkin_date"),
    "checkin_streak": F.number("checkin_streak"), "signature": F.text("signature", { max: 200 }),
    "membership_type": F.text("membership_type"), "membership_expires_at": F.text("membership_expires_at"),
};

const seen = new Set();
async function createOrSkip(col) {
    try {
        await api(`/api/collections/${col.name}`);
        console.log(`已存在: ${col.name}（跳过）`);
    } catch {
        await api(`/api/collections`, { method: "POST", body: JSON.stringify(col) });
        console.log(`已创建: ${col.name}（${col.fields.map(f => f.name).join(", ")}）`);
        seen.add(col.name);
    }
}

async function main() {
    // 1. 管理员登录（新版 _superusers）
    const auth = await api(`/api/collections/_superusers/auth-with-password`, {
        method: "POST", body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
    token = auth.token;
    console.log("✓ 管理员登录成功\n");

    // 2. users 集合补字段
    const users = await api("/api/collections/users");
    const have = new Set((users.fields || []).map(f => f.name));
    const missing = Object.keys(USERS_NEED).filter(f => !have.has(f));
    if (missing.length) {
        const newFields = [...(users.fields || []), ...missing.map(f => USERS_NEED[f])];
        await api("/api/collections/users", { method: "PATCH", body: JSON.stringify({ fields: newFields }) });
        console.log(`✓ users 集合补字段: ${missing.join(", ")}`);
    } else {
        console.log("✓ users 集合字段齐全（coins/last_checkin_date/checkin_streak/signature/membership_*）");
    }

    // 3. 创建业务集合
    for (const col of COLLECTIONS) await createOrSkip(col);

    console.log(`\n---- 完成: 新创建 ${seen.size}/${COLLECTIONS.length} 个集合, 其余已存在 ----`);
    process.exit(0);
}
main().catch(e => { console.error("✗ 失败:", e.message); process.exit(1); });
