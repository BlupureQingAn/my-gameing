// ==================== 1. 配置中心 ====================

// 非会员每日免费次数
const DAILY_FREE_QUOTA = 20;
// Cloudflare Worker 环境是 UTC，固定用 UTC+8 计算"今天"
const TIMEZONE_OFFSET_MS = 8 * 3600 * 1000;
const LIFETIME_EXPIRY = "2226-01-01T00:00:00.000Z";

// 模型池：Worker 自动路由（tier 越小越优先；dailyCap 为当日全局调用上限；enabled=false 池内禁用）
// ChatAnywhere 免费版（gpt_api_free）：每日 10000 点平台额度 + 各模型每日次数上限
const MODEL_POOL = [
    // ---- 智谱（主模型:实测从 CF 边缘 TTFB 0.3s,池内最快;官方按 RPM/TPM 限流无日次硬限,dailyCap 为自设保险）----
    { id: "zp-glm-4-air",   url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY", model: "glm-4-air",   dailyCap: 1000, tier: 5,  enabled: true },
    { id: "zp-glm-4-flash", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY", model: "glm-4-flash", dailyCap: 5000, tier: 6,  enabled: true },
    // ---- ChatAnywhere（2026-08-25 实测:403 "请求客户端IP不支持访问,请勿使用Cloudflare等反向代理"= 永久拒绝 CF 出口,key 再对也白耗,整池禁用;若换非 CF 出口部署可恢复）----
    { id: "ca-gpt-4o-mini",   url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4o-mini",    dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-3.5-turbo", url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-3.5-turbo",  dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-4.1-mini",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1-mini",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-4.1-nano",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1-nano",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5-mini",    url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5-mini",     dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5-nano",    url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5-nano",     dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5.4-mini",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5.4-mini",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5.4-nano",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5.4-nano",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-deepseek-v3.2",          url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v3.2",        dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-deepseek-v4-flash",      url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v4-flash",    dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-deepseek-v4-pro",        url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v4-pro",      dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-gpt-4o",        url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4o",         dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-gpt-4.1",       url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1",        dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-gpt-5",         url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5",          dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-deepseek-v3.2-thinking", url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v3.2-thinking", dailyCap: 30, tier: 95, enabled: false },
    // ---- DeepSeek 官方（池内禁用，等流量大了再启用）----
    { id: "ds-deepseek-chat",     url: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY",     model: "deepseek-chat",     dailyCap: Infinity, tier: 40, enabled: false },
    { id: "ds-deepseek-reasoner", url: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY",     model: "deepseek-reasoner", dailyCap: Infinity, tier: 40, enabled: false },
    // ---- NVIDIA（2026-08-24 实测 12s+ 无响应疑似额度耗尽,禁用防拖慢 fallback;key 恢复后启用）----
    // NVIDIA:原 qwen3.5-122b-a10b 已于 2026-07-20 EOL(HTTP 410),换 llama-3.3-70b-instruct(实测 TTFB 27ms)
    { id: "nv-llama-3.3-70b", url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY",  model: "meta/llama-3.3-70b-instruct", dailyCap: Infinity, tier: 90, enabled: false },
    // ---- SiliconFlow Qwen3-8B（免费，最后兜底）----
    { id: "sf-qwen3-8b",      url: "https://api.siliconflow.cn/v1",      apiKeyEnv: "SILICONFLOW_KEY", model: "Qwen/Qwen3-8B",     dailyCap: Infinity, tier: 99, enabled: true },
];

// ==================== 上游限流管理(防 429) ====================
// 智谱按"并发数"限流(免费档并发极低,第三方实测 ~5RPM),会员绕过 dailyCap 后洪峰更需客户端自限速
// 策略(openai-cookbook 最佳实践):并发信号量 + 滑动窗口,本地近似(CF 多实例叠加后仍留余量)
const RATE_LIMIT = { concurrency: 2, windowMs: 60 * 1000, maxPerWindow: 12, acquireTimeoutMs: 8000 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const upstreamGates = new Map(); // apiKeyEnv -> { active, timestamps }
function gateFor(envName) {
    let g = upstreamGates.get(envName);
    if (!g) { g = { active: 0, timestamps: [] }; upstreamGates.set(envName, g); }
    return g;
}
async function gateAcquire(envName) {
    const g = gateFor(envName);
    const start = Date.now();
    while (true) {
        const now = Date.now();
        g.timestamps = g.timestamps.filter(t => now - t < RATE_LIMIT.windowMs);
        if (g.active < RATE_LIMIT.concurrency && g.timestamps.length < RATE_LIMIT.maxPerWindow) {
            g.active++;
            g.timestamps.push(now);
            return true;
        }
        if (Date.now() - start > RATE_LIMIT.acquireTimeoutMs) return false;
        await sleep(50);
    }
}
function gateRelease(envName) {
    const g = upstreamGates.get(envName);
    if (g && g.active > 0) g.active--;
}
// Retry-After 解析:优先毫秒(OpenAI 系 retry-after-ms),其次秒(HTTP 标准 retry-after)
function parseRetryAfterMs(resp) {
    const ms = resp.headers.get("retry-after-ms") || resp.headers.get("x-ratelimit-reset-requests");
    if (ms) { const n = parseInt(ms, 10); if (!isNaN(n)) return n; }
    const s = resp.headers.get("retry-after");
    if (s) { const n = parseInt(s, 10); if (!isNaN(n)) return n * 1000; }
    return null;
}

// 失败熔断:候选模型调用失败后 5 分钟内直接跳过,避免每次请求都重走失败链
// (实测:key 过期的 ChatAnywhere 每次 ~0.5s 失败 × 11 个候选 = 每请求固定浪费 ~6.5s)
// CF Workers 多实例内存隔离,仅用 Map 时每实例各自重走失败链;叠加 Cache API(zone 内全局共享)做跨实例熔断
const MODEL_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
const modelFailTimes = new Map(); // modelId -> lastFailTime (本实例内存快路径)

const failCacheUrl = (modelId) => `https://ai.blupure.cn/_internal/fail/${encodeURIComponent(modelId)}`;

async function isModelInCooldown(modelId) {
    const t = modelFailTimes.get(modelId);
    if (t) {
        if (Date.now() - t > MODEL_FAIL_COOLDOWN_MS) {
            modelFailTimes.delete(modelId);
            return false;
        }
        return true;
    }
    try {
        const hit = await caches.default.match(failCacheUrl(modelId));
        if (hit) return true;
    } catch (e) { /* Cache API 异常时仅靠内存判断 */ }
    return false;
}

async function setModelCooldown(modelId) {
    modelFailTimes.set(modelId, Date.now());
    try {
        await caches.default.put(failCacheUrl(modelId), new Response("1", {
            headers: { "Cache-Control": `max-age=${Math.floor(MODEL_FAIL_COOLDOWN_MS / 1000)}` }
        }));
    } catch (e) { /* best-effort */ }
}

async function clearModelCooldown(modelId) {
    modelFailTimes.delete(modelId);
    try { await caches.default.delete(failCacheUrl(modelId)); } catch (e) { /* best-effort */ }
}

// 充值档位（金额与 worker 校验共用，前端仅展示）：币值 = 基础 + 赠送；首充 = 基础 ×2
const CHARGE_PLANS = {
    c6:  { id: "c6",  name: "6000 云币", price: "6",  base: 6000,  bonus: 600 },
    c18: { id: "c18", name: "18000 云币", price: "18", base: 18000, bonus: 1800 },
    c30: { id: "c30", name: "30000 云币", price: "30", base: 30000, bonus: 4500 },
    c68: { id: "c68", name: "68000 云币", price: "68", base: 68000, bonus: 13600 },
};
// 终身会员（会员改革后唯一保留的会员档，非充值档）
const LIFETIME_PLAN = { id: "lifetime", name: "终身会员", price: "89", days: 73000 };

// 环境变量（Cloudflare Secrets，勿写入代码）：
//   CHATANYWHERE_KEY / SILICONFLOW_KEY / NVIDIA_KEY / DEEPSEEK_KEY / ZHIPU_KEY / PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD
//   H5_APP_ID / H5_APP_SECRET / PAY_NOTIFY_URL=https://ai.blupure.cn/api/pay/notify

// ==================== 2. 工具函数 ====================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        // 保留 X-Cloud-Card-Id 兼容旧前端灰度期
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Cloud-Card-Id",
        "Access-Control-Max-Age": "86400",
    };
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            const repairedText = text.replace(/\\(?!(["\\\/bfnrt]|u[0-9a-fA-F]{4}))/g, "\\\\");
            return JSON.parse(repairedText);
        } catch (innerError) {
            throw new Error(`JSON 解析失败: ${e.message}`);
        }
    }
}

function escapePocketBaseFilterValue(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

function errorResponse(msg, status = 500, detail = null, code = "") {
    return new Response(JSON.stringify({ error: msg, detail, code }), {
        status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
}

function getTodayStr() {
    return new Date(Date.now() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

// 标准 MD5（公共域算法，纯 JS 免依赖；Worker 运行时 WebCrypto 不支持 MD5）
function md5(str) {
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    const add = (x, y) => (x + y) & 0xFFFFFFFF;
    const K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
    const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const bytes = unescape(encodeURIComponent(str));
    const msg = [];
    for (let i = 0; i < bytes.length; i++) msg.push(bytes.charCodeAt(i));
    const origLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 0; i < 8; i++) msg.push(Math.floor(origLen / Math.pow(2, 8 * i)) & 0xFF);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let i = 0; i < msg.length; i += 64) {
        const M = [];
        for (let j = 0; j < 16; j++) M[j] = msg[i + j * 4] | (msg[i + j * 4 + 1] << 8) | (msg[i + j * 4 + 2] << 16) | (msg[i + j * 4 + 3] << 24);
        let A = a0, B = b0, C = c0, D = d0;
        for (let j = 0; j < 64; j++) {
            let F, g;
            if (j < 16) { F = (B & C) | (~B & D); g = j; }
            else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
            else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * j) % 16; }
            F = add(add(F, A), add(K[j], M[g]));
            const tmp = D; D = C; C = B; B = add(B, rotl(F, S[j])); A = tmp;
        }
        a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    const toHex = n => {
        let s = "";
        for (let i = 0; i < 4; i++) s += ("0" + ((n >>> (i * 8)) & 0xFF).toString(16)).slice(-2);
        return s;
    };
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

// ==================== 3. 数据库服务层（PocketBase） ====================

async function getAdminToken(env) {
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const credentials = { identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD };
    const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
    });
    if (res.ok) return (await res.json()).token;
    const resOld = await fetch(`${pbUrl}/api/collections/admins/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
    });
    if (resOld.ok) return (await resOld.json()).token;
    throw new Error("PocketBase 身份验证失败");
}

async function pbAdminFetch(env, path, options = {}) {
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const adminToken = await getAdminToken(env);
    return fetch(`${pbUrl}${path}`, {
        ...options,
        headers: {
            "Authorization": `Bearer ${adminToken}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
}

// 读取当日各模型已用次数 → { modelId: count }
async function readModelUsageMap(env, today) {
    const q = await pbAdminFetch(
        env,
        `/api/collections/model_usage/records?perPage=50&skipTotal=true&filter=${encodeURIComponent(`usage_date='${today}'`)}`
    );
    if (!q.ok) return {};
    const data = await q.json();
    const map = {};
    for (const it of data.items || []) map[it.model_id] = Number(it.count || 0);
    return map;
}

// 模型调用成功后才计数（全局配额，所有用户共享）
async function bumpModelUsage(env, modelId, today) {
    const filter = encodeURIComponent(`usage_date='${today}' && model_id='${escapePocketBaseFilterValue(modelId)}'`);
    const q = await pbAdminFetch(env, `/api/collections/model_usage/records?perPage=1&skipTotal=true&filter=${filter}`);
    if (!q.ok) return;
    const data = await q.json();
    if ((data.items || []).length) {
        const rec = data.items[0];
        await pbAdminFetch(env, `/api/collections/model_usage/records/${rec.id}`, {
            method: "PATCH",
            body: JSON.stringify({ count: Number(rec.count || 0) + 1 })
        });
    } else {
        await pbAdminFetch(env, `/api/collections/model_usage/records`, {
            method: "POST",
            body: JSON.stringify({ usage_date: today, model_id: modelId, count: 1 })
        });
    }
}

// 用户每日计数（仅非会员；跨天重置）
async function bumpUserUsage(env, userId, usageDate, usageCount) {
    const today = getTodayStr();
    const next = (usageDate === today ? Number(usageCount || 0) : 0) + 1;
    await pbAdminFetch(env, `/api/collections/users/records/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ usage_date: today, usage_count: next })
    });
}

// ==================== 4. 会员与配额 ====================

function isMember(record) {
    const t = record.membership_type;
    if (!t) return false;
    if (t === "lifetime") return true;
    return !!(record.membership_expires_at && Date.parse(record.membership_expires_at) > Date.now());
}

function isMemberExpired(record) {
    const t = record.membership_type;
    if (!t || t === "lifetime") return false;
    return !!(record.membership_expires_at && Date.parse(record.membership_expires_at) <= Date.now());
}

// 按 tier 升序选当日未超限的第一个 enabled 模型；全无返回 null
function pickModel(usageMap, today, isMember) {
    // 会员不受池配额(dailyCap)限制:付费用户优先命中池内最优质模型,且不占用免费用户配额
    return MODEL_POOL
        .filter(m => m.enabled)
        .sort((a, b) => a.tier - b.tier)
        .find(m => isMember || (usageMap[m.id] || 0) < m.dailyCap) || null;
}

// ==================== 5. H5 支付（h5zhifu.com） ====================

// 签名：非空参数（除 sign）按参数名 ASCII 升序拼接 a=b&c=d，追加 &key=密钥，md5 转大写（微信 APIv2 风格）
function h5BuildSign(params, secret) {
    const keys = Object.keys(params)
        .filter(k => k !== "sign" && params[k] !== "" && params[k] != null)
        .sort();
    const str = keys.map(k => `${k}=${params[k]}`).join("&");
    return md5(str + "&key=" + secret).toUpperCase();
}

function verifyH5Sign(params, secret) {
    const sign = String(params.sign || "");
    if (!sign) return false;
    return h5BuildSign(params, secret) === sign.toUpperCase();
}

// 创建订单：本地落库 pay_orders → 调 H5 支付 open.h5zhifu.com/api/h5 → 返回 { orderNo, jumpUrl }
async function createPayOrder(env, userId, planId, payType) {
    const plan = CHARGE_PLANS[planId] || (planId === "lifetime" ? LIFETIME_PLAN : null);
    if (!plan) throw new Error("无效的充值档位");
    const orderNo = "MP" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
    const timestamp = new Date().toISOString();

    const orderRes = await pbAdminFetch(env, `/api/collections/pay_orders/records`, {
        method: "POST",
        body: JSON.stringify({
            order_no: orderNo, user_id: userId, plan_id: planId,
            amount: plan.price, status: "pending", trade_no: "",
            created_at: timestamp, paid_at: ""
        })
    });
    if (!orderRes.ok) throw new Error("订单创建失败");

    const params = {
        app_id: Number(env.H5_APP_ID),
        out_trade_no: orderNo,
        description: plan.name,
        pay_type: payType === "wxpay" ? "wechat" : "alipay",
        amount: Math.round(parseFloat(plan.price) * 100), // 单位：分（整数）
        attach: userId,
        notify_url: env.PAY_NOTIFY_URL,
    };
    params.sign = h5BuildSign(params, env.H5_APP_SECRET);

    let payRes;
    try {
        payRes = await fetch("https://open.h5zhifu.com/api/h5", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(15000)
        });
    } catch (e) {
        throw new Error(e.name === "TimeoutError" ? "支付网关响应超时，请稍后重试" : "支付网关连接失败");
    }
    const payJson = await payRes.json().catch(() => ({}));
    if (payJson.code === 200 && payJson.data && payJson.data.jump_url) {
        return { orderNo, jumpUrl: payJson.data.jump_url, tradeNo: payJson.data.trade_no || "" };
    }
    throw new Error(payJson.msg || "支付网关返回异常");
}

// 回调处理：验签 → paid/success → 订单/金额校验 → 幂等 → 充值档发云币(首充双倍)/lifetime 开通会员
async function handlePayNotify(env, params) {
    try {
        if (!verifyH5Sign(params, env.H5_APP_SECRET)) return "fail";
        if (!["paid", "success"].includes(params.trade_status)) return "fail";

        const filter = encodeURIComponent(`order_no='${escapePocketBaseFilterValue(params.out_trade_no || "")}'`);
        const q = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${filter}`);
        if (!q.ok) return "fail";
        const data = await q.json();
        const order = (data.items || [])[0];
        if (!order) return "fail";
        if (order.status === "paid") return "success"; // 幂等：重复回调不重复发放

        const expectAmount = Math.round(parseFloat(order.amount) * 100);
        if (String(params.amount) !== String(expectAmount)) return "fail"; // 金额(分)校验防伪造

        const now = new Date().toISOString();
        const isLifetime = order.plan_id === "lifetime";
        const plan = isLifetime ? LIFETIME_PLAN : CHARGE_PLANS[order.plan_id];
        if (!plan) return "fail";

        // 读当前余额（PocketBase 无原子自增，先读后写）
        const userRes = await pbAdminFetch(env, `/api/collections/users/records/${order.user_id}`);
        if (!userRes.ok) return "fail";
        const user = await userRes.json();

        const patch = {};
        if (isLifetime) {
            patch.membership_type = "lifetime";
            patch.membership_expires_at = LIFETIME_EXPIRY;
        } else {
            // 首充判定：该用户除本订单外无已支付记录 → 双倍(基础×2)；否则 基础+赠送
            const paidFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(order.user_id)}'&&status='paid'&&id!='${order.id}'`);
            const pq = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${paidFilter}`);
            const pd = await pq.json().catch(() => ({}));
            const isFirst = !(pd.items || []).length;
            patch.coin = Number(user.coin || 0) + (isFirst ? plan.base * 2 : plan.base + plan.bonus);
        }
        const patchRes = await pbAdminFetch(env, `/api/collections/users/records/${order.user_id}`, {
            method: "PATCH",
            body: JSON.stringify(patch)
        });
        if (!patchRes.ok) return "fail";

        await pbAdminFetch(env, `/api/collections/pay_orders/records/${order.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "paid", trade_no: params.trade_no || "", paid_at: now })
        });
        return "success";
    } catch (e) {
        console.error("handlePayNotify error:", e.message);
        return "fail";
    }
}

// ==================== 6. 核心逻辑控制 ====================

async function authenticate(env, request) {
    const userAuthToken = request.headers.get("X-Auth-Token");
    if (!userAuthToken) return { error: errorResponse("请先登录", 401, null, "NOT_LOGGED_IN") };
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const authRes = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
        method: "POST",
        headers: { "Authorization": userAuthToken.startsWith("Bearer ") ? userAuthToken : `Bearer ${userAuthToken}` }
    });
    if (!authRes.ok) return { error: errorResponse("会话已过期", 401, null, "SESSION_EXPIRED") };
    const authData = await authRes.json();
    return { record: authData.record };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

        const url = new URL(request.url);

        try {
            // ---- 路由：AI 对话（模型池自动路由 + 每日限额/会员校验）----
            if (url.pathname === "/chat/completions") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const record = auth.record;
                const userId = record.id;

                // 会员判定
                if (isMemberExpired(record)) {
                    return errorResponse("会员已到期，请续费", 402, { expiresAt: record.membership_expires_at }, "MEMBERSHIP_EXPIRED");
                }
                const isMemberUser = isMember(record);
                if (!isMemberUser && Number(record.usage_count || 0) >= DAILY_FREE_QUOTA
                    && record.usage_date === getTodayStr()) {
                    return errorResponse("今日免费次数已用完（20/20），开通会员后不限量", 402,
                        { used: Number(record.usage_count || 0), limit: DAILY_FREE_QUOTA }, "QUOTA_EXCEEDED");
                }

                // 解析请求
                const bodyText = await request.text();
                let requestJson = safeJsonParse(bodyText);
                const isStream = requestJson.stream === true;

                // 模型池路由
                const today = getTodayStr();
                const usageMap = await readModelUsageMap(env, today);
                const picked = pickModel(usageMap, today, isMemberUser);
                if (!picked) {
                    return errorResponse("今日全部模型配额已用尽，请明天再试", 429, null, "QUOTA_EXCEEDED");
                }
                const candidates = [
                    picked,
                    ...MODEL_POOL.filter(m => m.enabled && m.id !== picked.id && (usageMap[m.id] || 0) < m.dailyCap)
                        .sort((a, b) => a.tier - b.tier)
                ];

                // 逐候选转发：非 2xx / 网络异常 → 换下一个
                let aiResponse = null;
                let usedModel = null;
                const attempts = []; // 诊断:记录每个候选的尝试结果(模型:状态:耗时ms)
                for (const target of candidates) {
                    const attemptStart = Date.now();
                    if (await isModelInCooldown(target.id)) { attempts.push(`${target.id}:cooldown`); continue; } // 熔断期内跳过,不重走失败链
                    const apiKey = env[target.apiKeyEnv];
                    if (!apiKey) { attempts.push(`${target.id}:nokey`); continue; }
                    const base = target.url.replace(/\/$/, "");
                    // 上游限流门控:并发/速率超限拿不到令牌 → 换候选(避免自触发 1302/1305)
                    if (!(await gateAcquire(target.apiKeyEnv))) { attempts.push(`${target.id}:busy`); continue; }
                    let resp = null;
                    let respStatus = 0;
                    try {
                        // 429(账户/模型限流)可恢复:尊重 Retry-After 短等待后同模型重试 1 次,不触发熔断
                        // 网络抖动也重试 1 次;超时/其他错误直接换候选
                        for (let retry = 0; retry <= 1; retry++) {
                            const controller = new AbortController();
                            const timeoutMs = isStream ? 15000 : 120000; // 流式仅等响应头(15s),body 透传由前端控制;慢模型快速 fallback
                            const timeout = setTimeout(() => controller.abort(), timeoutMs);
                            try {
                                const payload = { ...requestJson, model: target.model };
                                // Qwen3-8B 默认开启思考模式(reasoning 占 87% token,耗时 28-37s),强制关闭提速 ~20 倍
                                if (target.id === "sf-qwen3-8b") payload.enable_thinking = false;
                                const r = await fetch(`${base}/chat/completions`, {
                                    method: "POST",
                                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                                    body: JSON.stringify(payload),
                                    signal: controller.signal
                                });
                                clearTimeout(timeout);
                                resp = r;
                                respStatus = r.status;
                                if (r.status === 429) {
                                    const bodyPreview = (await r.text()).slice(0, 60).replace(/\s+/g, " ");
                                    if (retry === 0) {
                                        const ra = parseRetryAfterMs(r);
                                        if (ra !== null && ra <= 2000) {
                                            attempts.push(`${target.id}:429:${Date.now() - attemptStart}ms [${bodyPreview}] → 等 ${ra}ms 重试`);
                                            await sleep(ra + Math.floor(Math.random() * 100)); // Retry-After + 抖动防惊群
                                            continue;
                                        }
                                    }
                                    attempts.push(`${target.id}:429:${Date.now() - attemptStart}ms [${bodyPreview}]`); // 限流可恢复,不熔断,换候选
                                    resp = null;
                                    break;
                                }
                                break;
                            } catch (e) {
                                clearTimeout(timeout);
                                if (retry === 0 && !controller.signal.aborted) continue; // 网络抖动重试 1 次,超时不重试
                                attempts.push(`${target.id}:err:${Date.now() - attemptStart}ms`);
                                resp = null;
                                break;
                            }
                        }
                    } finally {
                        gateRelease(target.apiKeyEnv);
                    }
                    if (!resp) continue;
                    attempts.push(`${target.id}:${respStatus}:${Date.now() - attemptStart}ms`);
                    if (respStatus >= 400) {
                        const bodyPreview = (await resp.text()).slice(0, 80).replace(/\s+/g, " ");
                        attempts[attempts.length - 1] += ` [${bodyPreview}]`;
                    }
                    if (resp.ok) {
                        await clearModelCooldown(target.id); // 成功即解除熔断
                        aiResponse = resp;
                        usedModel = target;
                        break;
                    }
                    await setModelCooldown(target.id);
                    console.warn(`model ${target.id} failed (${respStatus}), fallback next`);
                }
                if (!aiResponse) {
                    return errorResponse("AI 服务暂时不可用，请稍后重试", 503, null, "POOL_UNAVAILABLE");
                }

                // 成功后才计数（失败不扣次数）；会员不扣用户次数也不占模型级配额（绕过 dailyCap 的同时不挤压免费用户）
                ctx.waitUntil((async () => {
                    try {
                        if (!isMemberUser) {
                            await bumpModelUsage(env, usedModel.id, today);
                            await bumpUserUsage(env, userId, record.usage_date, record.usage_count);
                        }
                    } catch (e) {
                        console.error("usage bump failed:", e.message);
                    }
                })());

                const diagHeaders = {
                    "X-Model-Used": usedModel.id,
                    "X-Model-Attempts": attempts.join("|")
                };
                if (isStream) {
                    return new Response(aiResponse.body, {
                        headers: { ...corsHeaders(), ...diagHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
                    });
                }
                // 非流式：校验 choices[0].message.content 为合法 JSON，失败则同模型重试 ≤2 次（前端有降级兜底）
                let resJson = null;
                try { resJson = await aiResponse.json(); } catch (e) { resJson = null; }
                const isGoodJson = () => {
                    const c = resJson?.choices?.[0]?.message?.content;
                    if (typeof c !== "string") return false;
                    try { JSON.parse(c); return true; } catch (e) { return false; }
                };
                for (let i = 0; i < 2 && !isGoodJson(); i++) {
                    const retryPayload = { ...requestJson, model: usedModel.model };
                    retryPayload.messages = [
                        ...(requestJson.messages || []),
                        { role: "user", content: "你上一次的回复内容不是合法 JSON。请仅输出一个合法 JSON 对象，不要任何解释、围栏或多余字符。" }
                    ];
                    const ctrl = new AbortController();
                    const to = setTimeout(() => ctrl.abort(), 120000);
                    try {
                        const resp = await fetch(`${usedModel.url.replace(/\/$/, "")}/chat/completions`, {
                            method: "POST",
                            headers: { "Authorization": `Bearer ${env[usedModel.apiKeyEnv]}`, "Content-Type": "application/json" },
                            body: JSON.stringify(retryPayload),
                            signal: ctrl.signal
                        });
                        if (resp.ok) resJson = await resp.json();
                    } catch (e) {
                        console.warn(`non-stream JSON retry error: ${e.message}`);
                    }
                    clearTimeout(to);
                }
                return new Response(JSON.stringify(resJson ?? { error: "AI 响应解析失败" }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：今日使用状态 ----
            if (url.pathname === "/api/usage" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                const today = getTodayStr();
                const used = r.usage_date === today ? Number(r.usage_count || 0) : 0;
                return new Response(JSON.stringify({
                    isMember: isMember(r),
                    membershipType: r.membership_type || "",
                    membershipExpiresAt: r.membership_expires_at || "",
                    usageDate: today,
                    used,
                    limit: DAILY_FREE_QUOTA,
                    // 会员不限量用 -1 表示（避免 Infinity 序列化为 null）
                    remaining: isMember(r) ? -1 : Math.max(0, DAILY_FREE_QUOTA - used)
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 诊断路由:回显 Secrets key 指纹(sha256 前 12 位),核对 CF Secrets 是否真的生效 ----
            if (url.pathname === "/api/diag/key" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const fp = async (s) => {
                    if (!s) return null;
                    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
                    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
                };
                return new Response(JSON.stringify({
                    CHATANYWHERE_KEY: await fp(env.CHATANYWHERE_KEY),
                    CHATANYWHERE_KEY_LEN: env.CHATANYWHERE_KEY ? env.CHATANYWHERE_KEY.length : 0,
                    ZHIPU_KEY: await fp(env.ZHIPU_KEY),
                    SILICONFLOW_KEY: await fp(env.SILICONFLOW_KEY)
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：创建支付订单 ----
            if (url.pathname === "/api/pay/create" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const planId = String(body.planId || "");
                const payType = ["alipay", "wxpay"].includes(body.payType) ? body.payType : "alipay";
                if (!CHARGE_PLANS[planId] && planId !== "lifetime") return errorResponse("无效的充值档位", 400, null, "INVALID_PLAN");
                try {
                    const { orderNo, jumpUrl } = await createPayOrder(env, auth.record.id, planId, payType);
                    return new Response(JSON.stringify({ orderNo, jumpUrl }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                } catch (e) {
                    return errorResponse("创建订单失败：" + e.message, 502, null, "PAY_CREATE_FAILED");
                }
            }

            // ---- 路由：支付回调（易支付异步通知，GET/POST 均可）----
            if (url.pathname === "/api/pay/notify") {
                let params;
                if (request.method === "POST") {
                    const text = await request.text();
                    try { params = Object.fromEntries(new URLSearchParams(text)); }
                    catch (e) { params = {}; }
                } else {
                    params = Object.fromEntries(url.searchParams);
                }
                const result = await handlePayNotify(env, params);
                return new Response(result, { headers: corsHeaders() }); // "success"/"fail" 纯文本
            }

            // ---- 路由：查询订单状态（前端轮询兜底）----
            if (url.pathname === "/api/pay/status" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const orderNo = url.searchParams.get("out_trade_no") || "";
                if (!orderNo) return errorResponse("缺少订单号", 400, null, "INVALID_ORDER");
                const filter = encodeURIComponent(`order_no='${escapePocketBaseFilterValue(orderNo)}'`);
                const q = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${filter}`);
                if (!q.ok) return errorResponse("查询订单失败", 500, null, "ORDER_QUERY_FAILED");
                const data = await q.json();
                const order = (data.items || [])[0];
                if (!order || order.user_id !== auth.record.id) return errorResponse("订单不存在", 404, null, "INVALID_ORDER");
                let status = Array.isArray(order.status) ? order.status[0] : order.status; // PocketBase JSON 字段可能返回数组
                // 只查本地订单状态（H5 网关查询接口严禁轮询，500 次/天黑名单）
                return new Response(JSON.stringify({ status, outTradeNo: orderNo }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            return errorResponse("Not Found", 404);

        } catch (e) {
            return errorResponse("Worker Error", 500, e.message);
        }
    }
};
