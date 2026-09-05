// 防克隆「心脏锁定」冒烟探针:BYOK 云端化全链(PB users 三字段 + AES-GCM 加密 at rest + worker 代跑)
// 断言:无 token 401 / 伪造 Origin 403 / 内网 URL 拒绝 / 存-读(无 key 明文)-测 / 真实代跑 / 错误 key 401 / 清除 / 池回归 / 未配置代跑拒绝
// 用法: node scripts/byok_heartlock_probe.mjs
import fs from "node:fs";

const BASE = "https://ai.blupure.cn";
const PB = "https://db.blupure.cn";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const USER = "seed_u01@seed.yuntuntun.local";
const PASS = "SeedTest123!";
const ZHIPU_KEY = fs.readFileSync("F:/Claude/zhipu-apikey", "utf8").trim();
const ZHIPU_URL = "https://open.bigmodel.cn/api/paas/v4";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${extra}`); }
}
async function req(path, { method = "GET", body, token, origin, code } = {}) {
    const headers = { "User-Agent": UA };
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers["X-Auth-Token"] = "Bearer " + token;
    if (origin) headers["Origin"] = origin;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (code) check(`${method} ${path} → ${res.status}(期望 ${code})`, res.status === code, JSON.stringify(data).slice(0, 160));
    return { status: res.status, data };
}
async function main() {
    // 1. 防线:伪造 Origin → 403;无 token → 401
    await req("/api/byok", { method: "GET", origin: "https://evil.com", code: 403 });
    await req("/api/byok", { method: "GET", code: 401 });
    // 2. 登录(worker 的 token 来自 PocketBase auth-refresh,故在 db.blupure.cn 登录)
    const loginRes = await fetch(PB + "/api/collections/users/auth-with-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ identity: USER, password: PASS })
    });
    const loginData = await loginRes.json().catch(() => ({}));
    check("种子用户登录", loginRes.status === 200 && !!loginData.token, JSON.stringify(loginData).slice(0, 200));
    const token = loginData.token;
    if (!token) { console.log(`结果: PASS ${pass} / FAIL ${fail}`); process.exit(fail ? 1 : 0); }
    // 3. 初始未配置
    let r = await req("/api/byok", { method: "GET", token });
    check("GET 初始未配置", r.data.configured === false, JSON.stringify(r.data).slice(0, 120));
    // 4. SSRF:内网地址拒绝
    r = await req("/api/byok", { method: "PUT", token, body: { url: "http://127.0.0.1:9999/v1", model: "x", key: "k" } });
    check("PUT 内网 URL 拒绝", r.status === 400 && r.data.code === "BYOK_URL_INVALID", JSON.stringify(r.data).slice(0, 120));
    // 5. 保存合法配置(智谱)
    r = await req("/api/byok", { method: "PUT", token, body: { url: ZHIPU_URL, model: "glm-4-flash", key: ZHIPU_KEY } });
    check("PUT 保存成功", r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
    // 6. 读取:不回显 key
    r = await req("/api/byok", { method: "GET", token });
    const noKeyLeak = r.data.configured === true && !("key" in r.data) && !("byok_key_cipher" in r.data);
    check("GET configured + 无 key 明文泄露", noKeyLeak && r.data.url === ZHIPU_URL && r.data.model === "glm-4-flash", JSON.stringify(r.data).slice(0, 160));
    // 7. 云端代测
    r = await req("/api/byok/test", { method: "POST", token, body: {} });
    check("POST /test 云端代测成功", r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 160));
    // 8. 真实代跑(非流式,byok:true)
    r = await req("/chat/completions", {
        method: "POST", token,
        body: { model: "glm-4-flash", messages: [{ role: "user", content: "只回复两个字:你好" }], stream: false, max_tokens: 32, byok: true }
    });
    const content = r.data?.choices?.[0]?.message?.content || "";
    check("代跑真实对话成功", r.status === 200 && content.length > 0, `status=${r.status} content=${content.slice(0, 40)}`);
    // 9. 错误 key 代跑 → BYOK_KEY_INVALID
    r = await req("/api/byok", { method: "PUT", token, body: { url: ZHIPU_URL, model: "glm-4-flash", key: "sk-wrong-key-0000" } });
    check("PUT 错误 key 保存", r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
    r = await req("/api/byok/test", { method: "POST", token, body: {} });
    check("错误 key 云端代测拒绝", r.status === 401 && r.data.code === "BYOK_KEY_INVALID", JSON.stringify(r.data).slice(0, 160));
    // 10. 恢复正确 key(留空 key=沿用?此处显式恢复)后清除
    r = await req("/api/byok", { method: "PUT", token, body: { url: ZHIPU_URL, model: "glm-4-flash", key: ZHIPU_KEY } });
    r = await req("/api/byok", { method: "DELETE", token });
    check("DELETE 清除成功", r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
    r = await req("/api/byok", { method: "GET", token });
    check("GET 清除后未配置", r.data.configured === false, JSON.stringify(r.data).slice(0, 120));
    // 11. 云端无配置时代跑拒绝(不落池)
    r = await req("/chat/completions", {
        method: "POST", token,
        body: { model: "glm-4-flash", messages: [{ role: "user", content: "hi" }], stream: false, byok: true }
    });
    check("未配置 byok:true 拒绝(BYOK_NOT_CONFIGURED)", r.status === 400 && r.data.code === "BYOK_NOT_CONFIGURED", JSON.stringify(r.data).slice(0, 160));
    // 12. 池回归:byok 不携带 → 模型池(登录+限额)
    r = await req("/chat/completions", {
        method: "POST", token,
        body: { model: "pool", messages: [{ role: "user", content: "只回复:ok" }], stream: false, max_tokens: 16 }
    });
    check("池回归(非 byok)成功", r.status === 200 && !!(r.data?.choices?.[0]?.message?.content), `status=${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);

    console.log(`\n==== 结果: PASS ${pass} / FAIL ${fail} ====`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("✗ 脚本异常:", e.message); process.exit(1); });
