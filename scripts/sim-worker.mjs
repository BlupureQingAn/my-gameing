// 本地模拟测试：mock fetch 拦截 PocketBase / AI 上游 / 易支付，断言计费与会员体系
// 运行：node scripts/sim-worker.mjs
import crypto from "node:crypto";
import worker from "../worker.js";

const TIMEZONE_OFFSET_MS = 8 * 3600 * 1000;
const TODAY = new Date(Date.now() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);

const env = {
    PB_URL: "http://pb.test",
    PB_ADMIN_EMAIL: "admin@test", PB_ADMIN_PASSWORD: "pw",
    CHATANYWHERE_KEY: "ca-key", SILICONFLOW_KEY: "sf-key",
    NVIDIA_KEY: "nv-key", DEEPSEEK_KEY: "ds-key",
    PAY_APP_ID: "5435", PAY_APP_SECRET: "test-secret",
    PAY_MAPI_URL: "https://ezfp.cn/mapi.php",
    PAY_QUERY_URL: "https://ezfp.cn/api.php",
    PAY_NOTIFY_URL: "https://ai.blupure.cn/api/pay/notify",
};
const ctx = { waitUntil(p) { state.pending.push(p); } };

// ---------- 模拟状态 ----------
const state = {
    users: {}, modelUsageById: {}, payOrders: [],
    userPatches: [],
    pending: [],
    upstreamMode: "ok",        // ok | all-500
    lastUpstream: null,
    upstreamModels: [],
    lastMapiBody: null,
};

async function flush() {
    const ps = state.pending;
    state.pending = [];
    await Promise.all(ps);
}

function md5(s) { return crypto.createHash("md5").update(s, "utf8").digest("hex"); }
function buildSign(params, secret) {
    const keys = Object.keys(params)
        .filter(k => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] != null)
        .sort();
    return md5(keys.map(k => `${k}=${params[k]}`).join("&") + secret);
}
function newUser(id, over = {}) {
    const u = { id, usage_date: TODAY, usage_count: 0, membership_type: "", membership_expires_at: "", ...over };
    state.users[id] = u;
    return u;
}
function reset() {
    state.users = {}; state.modelUsageById = {}; state.payOrders = [];
    state.userPatches = []; state.upstreamMode = "ok";
    state.lastUpstream = null; state.upstreamModels = []; state.lastMapiBody = null; state.pending = [];
    state.upstreamRequests = 0;
}
function setModelCount(modelId, count) {
    const rec = { id: "mu" + Object.keys(state.modelUsageById).length + 1, usage_date: TODAY, model_id: modelId, count };
    state.modelUsageById[rec.id] = rec;
}
function modelCount(modelId) {
    return Object.values(state.modelUsageById).filter(r => r.model_id === modelId)[0]?.count ?? 0;
}

// ---------- fetch mock ----------
globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const method = (options.method || "GET").toUpperCase();
    if (u.origin === "http://pb.test") return pbMock(u, method, options);

    if (u.origin === "https://ezfp.cn") {
        if (u.pathname === "/mapi.php") {
            state.lastMapiBody = (options.body || "").toString();
            return new Response(JSON.stringify({ code: 1, msg: "ok", trade_no: "T123", payurl: "https://pay.example/o/1" }));
        }
        return new Response(JSON.stringify({ code: 1, status: 1, trade_no: "T123" }));
    }

    // AI 上游
    const body = JSON.parse(options.body || "{}");
    state.upstreamRequests = (state.upstreamRequests || 0) + 1;
    state.lastUpstream = { model: body.model, url: u.href, body };
    state.upstreamModels.push(body.model);
    if (state.upstreamMode === "all-500") return new Response("boom", { status: 500 });
    if (state.upstreamMode === "bad-json-once") {
        state.upstreamMode = "ok";
        const bad = { id: "x", model: body.model, choices: [{ message: { role: "assistant", content: "抱歉,这不是JSON" } }] };
        return new Response(JSON.stringify(bad), { status: 200 });
    }
    if (state.upstreamMode === "bad-json-always") {
        const bad = { id: "x", model: body.model, choices: [{ message: { role: "assistant", content: "坏内容" } }] };
        return new Response(JSON.stringify(bad), { status: 200 });
    }
    // 带强制 JSON 指令的重试请求 → 返回合法 JSON
    const retryForced = (body.messages || []).some(m => /合法 JSON/.test(String(m.content || "")));
    if (retryForced) {
        const good = { id: "x", model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify({ story: "重试成功", options: ["a"] }) } }] };
        return new Response(JSON.stringify(good), { status: 200 });
    }
    const payload = { id: "x", model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify({ story: "ok", options: [] }) } }] };
    return new Response(JSON.stringify(payload), { status: 200 });
};

function pbMock(u, method, options) {
    const path = u.pathname;
    const json = obj => new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });

    if (method === "POST" && path.endsWith("/auth-with-password")) return json({ token: "admintok" });
    if (method === "POST" && path.endsWith("/auth-refresh")) {
        const tok = (options.headers?.Authorization || "").replace(/^Bearer\s+/, "");
        const rec = state.users[tok];
        return rec ? json({ record: rec }) : new Response("no", { status: 401 });
    }
    if (path.includes("/model_usage/records")) {
        if (method === "GET") {
            const filter = u.searchParams.get("filter") || "";
            const fDate = filter.match(/usage_date='([^']*)'/)?.[1] ?? TODAY;
            const fModel = filter.match(/model_id='([^']*)'/)?.[1] ?? null;
            const items = Object.values(state.modelUsageById)
                .filter(r => r.usage_date === fDate && (!fModel || r.model_id === fModel));
            return json({ items });
        }
        if (method === "POST") {
            const rec = { id: "mu" + (Object.keys(state.modelUsageById).length + 1), ...JSON.parse(options.body || "{}") };
            state.modelUsageById[rec.id] = rec;
            return json({ ...rec });
        }
        const rec = state.modelUsageById[path.split("/").pop()];
        if (rec) Object.assign(rec, JSON.parse(options.body || "{}"));
        return json({ ...rec });
    }
    if (path.includes("/pay_orders/records")) {
        if (method === "GET") {
            const filter = u.searchParams.get("filter") || "";
            const items = state.payOrders.filter(o => !filter.includes("order_no") || filter.includes(o.order_no));
            return json({ items });
        }
        if (method === "POST") {
            const o = { id: "po" + (state.payOrders.length + 1), ...JSON.parse(options.body || "{}") };
            state.payOrders.push(o);
            return json({ ...o });
        }
        const o = state.payOrders.find(x => x.id === path.split("/").pop());
        if (o) Object.assign(o, JSON.parse(options.body || "{}"));
        return json({ ...o });
    }
    const m = path.match(/\/users\/records\/([^/]+)$/);
    if (m && method === "PATCH") {
        const patch = JSON.parse(options.body || "{}");
        state.userPatches.push({ userId: m[1], ...patch });
        const rec = state.users[m[1]] || { id: m[1] };
        Object.assign(rec, patch);
        return json({ ...rec });
    }
    return new Response("{}", { status: 404 });
}

// ---------- 调用辅助 ----------
async function chat(token = "user1", over = {}) {
    const req = new Request("http://worker.test/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": token },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: false, ...over }),
    });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    return res;
}
async function getUsage(token = "user1") {
    const res = await worker.fetch(new Request("http://worker.test/api/usage", {
        headers: { "X-Auth-Token": token },
    }), env, ctx);
    await flush();
    return res;
}
async function notify(params, get = false) {
    const url = get
        ? "http://worker.test/api/pay/notify?" + new URLSearchParams(params)
        : "http://worker.test/api/pay/notify";
    const init = get ? {} : {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
    };
    const res = await worker.fetch(new Request(url, init), env, ctx);
    await flush();
    return res;
}

const results = [];
async function t(name, fn) {
    try { await fn(); results.push([name, true]); }
    catch (e) { results.push([name, false, e.message]); }
}

// ---------- 测试用例 ----------
// T1 未登录 → 401 NOT_LOGGED_IN
await t("T1 未登录401", async () => {
    const res = await chat("", {});
    const body = await res.json();
    if (res.status !== 401 || body.code !== "NOT_LOGGED_IN") throw new Error(`got ${res.status} ${body.code}`);
});

// T2 非会员正常调用 → 200，用户计数+1，模型计数+1
await t("T2 非会员计数", async () => {
    reset(); newUser("user1", { usage_count: 5 });
    const res = await chat();
    const body = await res.json();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    const t2c = body.choices?.[0]?.message?.content;
    try { if (JSON.parse(t2c).story !== "ok") throw new Error("story 异常"); }
    catch (e) { throw new Error("content 非合法 JSON: " + t2c); }
    if (state.users.user1.usage_count !== 6) throw new Error(`usage_count=${state.users.user1.usage_count}`);
    if (modelCount("ca-gpt-4o-mini") !== 1) throw new Error(`modelUsage=${modelCount("ca-gpt-4o-mini")}`);
    if (state.lastUpstream.model !== "gpt-4o-mini") throw new Error(`upstream model=${state.lastUpstream.model}`);
});

// T3 20 次上限 → 402 QUOTA_EXCEEDED，不触达上游
await t("T3 20上限拦截", async () => {
    reset(); newUser("user1", { usage_count: 20 });
    const res = await chat();
    const body = await res.json();
    if (res.status !== 402 || body.code !== "QUOTA_EXCEEDED") throw new Error(`got ${res.status} ${body.code}`);
    if (state.upstreamModels.length !== 0) throw new Error("不应调用上游");
});

// T4 会员跳过次数（已满20仍放行，用户计数不增，模型计数照记）
await t("T4 会员不限量", async () => {
    reset();
    newUser("user1", {
        usage_count: 20,
        membership_type: "monthly",
        membership_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    const res = await chat();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (state.users.user1.usage_count !== 20) throw new Error(`usage_count 不应增加: ${state.users.user1.usage_count}`);
    if (modelCount("ca-gpt-4o-mini") !== 1) throw new Error("模型计数应+1");
});

// T5 会员过期 → 402 MEMBERSHIP_EXPIRED
await t("T5 会员过期", async () => {
    reset();
    newUser("user1", {
        membership_type: "monthly",
        membership_expires_at: new Date(Date.now() - 86400000).toISOString(),
    });
    const res = await chat();
    const body = await res.json();
    if (res.status !== 402 || body.code !== "MEMBERSHIP_EXPIRED") throw new Error(`got ${res.status} ${body.code}`);
});

// T6 跨天重置：昨天已满 20 → 今天重新计数
await t("T6 跨天重置", async () => {
    reset(); newUser("user1", { usage_date: "2020-01-01", usage_count: 20 });
    const res = await chat();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (state.users.user1.usage_date !== TODAY || state.users.user1.usage_count !== 1)
        throw new Error(`跨天未重置: ${state.users.user1.usage_date}/${state.users.user1.usage_count}`);
});

// T7 模型配额用尽 → fallback 下一 tier（tier10 全满 → deepseek-v3.2 tier20）
await t("T7 模型配额fallback", async () => {
    reset(); newUser("user1");
    ["ca-gpt-4o-mini", "ca-gpt-3.5-turbo", "ca-gpt-4.1-mini", "ca-gpt-4.1-nano",
     "ca-gpt-5-mini", "ca-gpt-5-nano", "ca-gpt-5.4-mini", "ca-gpt-5.4-nano"]
        .forEach(id => setModelCount(id, 100));
    const res = await chat();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (state.lastUpstream.model !== "deepseek-v3.2") throw new Error(`应选 deepseek-v3.2，实际 ${state.lastUpstream.model}`);
    if (modelCount("ca-deepseek-v3.2") !== 1) throw new Error("v3.2 应计数+1");
});

// T8 全池上游失败 → 503 POOL_UNAVAILABLE，不计数
await t("T8 全池503", async () => {
    reset(); newUser("user1");
    state.upstreamMode = "all-500";
    const res = await chat();
    const body = await res.json();
    if (res.status !== 503 || body.code !== "POOL_UNAVAILABLE") throw new Error(`got ${res.status} ${body.code}`);
    if (Object.keys(state.modelUsageById).length !== 0) throw new Error("失败不应计数");
});

// T9 回调正确签名 → 自动开通会员
await t("T9 回调开通会员", async () => {
    reset(); newUser("user2");
    state.payOrders.push({ id: "po1", order_no: "MPTEST1", user_id: "user2", plan_id: "monthly", amount: "9.9", status: "pending", trade_no: "" });
    const params = { pid: "5435", out_trade_no: "MPTEST1", trade_status: "TRADE_SUCCESS", money: "9.9", trade_no: "TN123" };
    params.sign = buildSign(params, env.PAY_APP_SECRET);
    params.sign_type = "MD5";
    const res = await notify(params);
    const text = await res.text();
    if (text !== "success") throw new Error(`got "${text}"`);
    const u = state.users.user2;
    if (u.membership_type !== "monthly" || !u.membership_expires_at) throw new Error("会员未开通");
    if (state.payOrders[0].status !== "paid") throw new Error("订单未置 paid");
});

// T10 错误签名 → fail，不操作
await t("T10 错签拒绝", async () => {
    reset(); newUser("user2");
    state.payOrders.push({ id: "po1", order_no: "MPTEST1", user_id: "user2", plan_id: "monthly", amount: "9.9", status: "pending", trade_no: "" });
    const params = { pid: "5435", out_trade_no: "MPTEST1", trade_status: "TRADE_SUCCESS", money: "9.9", sign: "0".repeat(32) };
    const res = await notify(params);
    if (await res.text() !== "fail") throw new Error("应 fail");
    if (state.users.user2.membership_type) throw new Error("不应开通");
});

// T11 金额不符 → fail
await t("T11 金额校验", async () => {
    reset(); newUser("user2");
    state.payOrders.push({ id: "po1", order_no: "MPTEST1", user_id: "user2", plan_id: "monthly", amount: "9.9", status: "pending", trade_no: "" });
    const params = { pid: "5435", out_trade_no: "MPTEST1", trade_status: "TRADE_SUCCESS", money: "0.01" };
    params.sign = buildSign(params, env.PAY_APP_SECRET);
    const res = await notify(params);
    if (await res.text() !== "fail") throw new Error("应 fail");
    if (state.users.user2.membership_type) throw new Error("不应开通");
});

// T12 幂等：已 paid 订单重复回调 → success 且不再 PATCH 用户
await t("T12 回调幂等", async () => {
    reset(); newUser("user2");
    state.payOrders.push({ id: "po1", order_no: "MPTEST1", user_id: "user2", plan_id: "monthly", amount: "9.9", status: "paid", trade_no: "TN1" });
    const params = { pid: "5435", out_trade_no: "MPTEST1", trade_status: "TRADE_SUCCESS", money: "9.9" };
    params.sign = buildSign(params, env.PAY_APP_SECRET);
    const res = await notify(params);
    if (await res.text() !== "success") throw new Error("幂等应 success");
    if (state.userPatches.filter(p => p.userId === "user2").length !== 0) throw new Error("不应再 PATCH 用户");
});

// T13 pay/create → 返回支付链接 + 订单落库（金额/套餐正确）
await t("T13 创建订单", async () => {
    reset(); newUser("user1");
    const req = new Request("http://worker.test/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": "user1", "CF-Connecting-IP": "1.2.3.4" },
        body: JSON.stringify({ planId: "yearly", payType: "alipay" }),
    });
    const res = await worker.fetch(req, env, ctx);
    const body = await res.json();
    if (res.status !== 200 || !body.payUrl) throw new Error(`got ${res.status} ${JSON.stringify(body)}`);
    const order = state.payOrders.find(o => o.order_no === body.orderNo);
    if (!order || order.amount !== "52" || order.plan_id !== "yearly" || order.status !== "pending")
        throw new Error("订单落库不正确");
    if (!state.lastMapiBody.includes("out_trade_no=" + body.orderNo) || !state.lastMapiBody.includes("pid=5435")
        || !state.lastMapiBody.includes("clientip=1.2.3.4") || !state.lastMapiBody.includes("sign="))
        throw new Error("mapi 请求参数不完整: " + state.lastMapiBody);
});

// T14 /api/usage：非会员显示剩余，会员显示不限
await t("T14 usage端点", async () => {
    reset(); newUser("user1", { usage_count: 5 });
    let res = await getUsage();
    let body = await res.json();
    if (body.used !== 5 || body.remaining !== 15 || body.limit !== 20 || body.isMember !== false)
        throw new Error(`非会员错误: ${JSON.stringify(body)}`);
    Object.assign(state.users.user1, { membership_type: "lifetime" });
    res = await getUsage();
    body = await res.json();
    if (!body.isMember || body.remaining !== -1) throw new Error(`会员错误: ${JSON.stringify(body)}`);
});

// T15 跨天 usage 显示重置
await t("T15 usage跨天", async () => {
    reset(); newUser("user1", { usage_date: "2020-01-01", usage_count: 20 });
    const res = await getUsage();
    const body = await res.json();
    if (body.used !== 0 || body.remaining !== 20) throw new Error(`got ${JSON.stringify(body)}`);
});

// T16 流式透传
await t("T16 流式透传", async () => {
    reset(); newUser("user1");
    const res = await chat("user1", { stream: true });
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (!res.headers.get("Content-Type").includes("text/event-stream")) throw new Error("缺 SSE 头");
    const text = await res.text();
    if (!text.includes('"model"')) throw new Error("body 未透传");
});

// T17 GET 回调变体
await t("T17 回调GET变体", async () => {
    reset(); newUser("user2");
    state.payOrders.push({ id: "po1", order_no: "MPTEST1", user_id: "user2", plan_id: "monthly", amount: "9.9", status: "pending", trade_no: "" });
    const params = { pid: "5435", out_trade_no: "MPTEST1", trade_status: "TRADE_SUCCESS", money: "9.9" };
    params.sign = buildSign(params, env.PAY_APP_SECRET);
    const res = await notify(params, true);
    if (await res.text() !== "success") throw new Error("GET 回调应 success");
});

// T18 非流式坏 JSON 一次 → 同模型重试 → 返回合法 JSON
await t("T18 非流式JSON重试", async () => {
    reset(); newUser("user1");
    state.upstreamMode = "bad-json-once";
    const res = await chat("user1", { stream: false });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    const content = body.choices?.[0]?.message?.content;
    try { JSON.parse(content); } catch (e) { throw new Error("重试后 content 仍非 JSON: " + content); }
    if (state.upstreamRequests !== 2) throw new Error(`应上游请求 2 次(1 坏+1 重试),实际 ${state.upstreamRequests}`);
    const retryMsgs = state.lastUpstream.body.messages || [];
    const forced = retryMsgs.some(m => /合法 JSON/.test(String(m.content || "")));
    if (!forced) throw new Error("重试请求未带强制 JSON 指令");
});

// T19 非流式永远坏 JSON → 重试 2 次后返回原始坏内容（前端降级兜底）
await t("T19 JSON重试上限", async () => {
    reset(); newUser("user1");
    state.upstreamMode = "bad-json-always";
    const res = await chat("user1", { stream: false });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (state.upstreamRequests !== 3) throw new Error(`应 3 次(1+2 重试),实际 ${state.upstreamRequests}`);
    const content = body.choices?.[0]?.message?.content;
    let parsed = false;
    try { JSON.parse(content); parsed = true; } catch (e) {}
    if (parsed) throw new Error("全败场景不应得到合法 JSON");
});

// T20 流式不触发 JSON 重试
await t("T20 流式不重试", async () => {
    reset(); newUser("user1");
    state.upstreamMode = "bad-json-always";
    const res = await chat("user1", { stream: true });
    if (res.status !== 200) throw new Error(`got ${res.status}`);
    if (state.upstreamRequests !== 1) throw new Error(`流式应只 1 次请求,实际 ${state.upstreamRequests}`);
});

// ---------- 汇总 ----------
let ok = 0;
for (const [name, passed, err] of results) {
    console.log(passed ? "PASS" : "FAIL", "-", name, err ? `(${err})` : "");
    if (passed) ok++;
}
console.log(`---- ${ok}/${results.length} PASS ----`);
process.exit(ok === results.length ? 0 : 1);
