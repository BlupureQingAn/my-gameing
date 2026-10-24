/* 身份截断修复探针（2026-10-24）
   验证目标：
   A. 存档层 sanitizeNpcs 不再截断身份/关系/性格等字段（真实源码提取执行）
   B. 排队条插入点在 .composer 之前（真实源码提取 + 假 DOM 执行）
   C. 数据入口与显示层不再有 12/40/60 字身份硬截断（源码断言）
   D. CSS 不再用 nowrap/ellipsis/line-clamp 裁身份介绍
   E. index.html 初始化预览输入框上限已放宽
   跑法：node scripts/identity_truncation_probe.mjs */
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const appSrc = fs.readFileSync(ROOT + "/assets/app.js", "utf8");
const cssSrc = fs.readFileSync(ROOT + "/assets/app.css", "utf8");
const htmlSrc = fs.readFileSync(ROOT + "/index.html", "utf8");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fail++; fails.push(name + (extra ? "  [" + extra + "]" : ""));
}
function region(src, a, b, label) {
    const i = src.indexOf(a), j = src.indexOf(b, i + 1);
    if (i < 0 || j < 0) { ok("提取失败: " + label, false); return ""; }
    return src.slice(i, j);
}
function cssBlock(sel) {
    const i = cssSrc.indexOf(sel + " {");
    if (i < 0) return "";
    const j = cssSrc.indexOf("}", i);
    return cssSrc.slice(i, j + 1);
}

/* ---------- A. sanitizeNpcs 字段不再截断 ---------- */
{
    const src = region(appSrc, "function sanitizeNpcs(", "function buildFallbackStatsFromScenario(", "sanitizeNpcs");
    const sanitizeNpcs = new Function(src + "\nreturn sanitizeNpcs;")();
    const long = {
        name: "测试角色",
        relation: "与主角自幼相识的邻家姐姐兼秘密结社联络人兼城主府首席医师",
        status: "在线（闭关中，暂不见客，只接受紧急传讯）",
        mood: "表面平静，内心正在盘算如何应对即将到来的审判",
        traits: "外冷内热、记账极细、遇事先查证据、对承诺近乎偏执、夜里会偷偷哼小调",
        profile: {
            age: "二十七岁零三个月",
            identity: "大梁国长公主府首席医官，兼江湖第一大情报组织听雨阁北境分阁主，同时隐姓埋名担任城中孤儿的资助人",
            residence: "长公主府西侧独立医馆，后院与听雨阁暗道相连",
            appearance: "身量高挑，常着月白窄袖长衫，左耳有一枚极小的银色耳钉，指节因常年捣药略有薄茧",
            personality: "对外人疏离有礼，对亲近之人极护短；习惯先观察再开口，但一旦认定便会不计代价",
            goal: "查清十年前瘟疫背后的真相，并把当年被掩埋的证词完整带到御前",
            secret: "她其实是先帝流落在外的第三女，右手腕内侧有一枚被药膏覆盖的凤凰印",
            firstImpression: "看起来冷淡难近，开口第一句却先问受害者有没有吃饭"
        }
    };
    const out = sanitizeNpcs([long])[0];
    ok("A1 relation 60 字内不截断", out.relation === long.relation.slice(0, 60), out.relation);
    ok("A2 status 40 字内不截断", out.status === long.status.slice(0, 40));
    ok("A3 mood 40 字内不截断", out.mood === long.mood.slice(0, 40));
    ok("A4 traits 160 字内不截断", out.traits === long.traits.slice(0, 160));
    ok("A5 profile.identity 200 字内不截断", out.profile.identity === long.profile.identity.slice(0, 200), String(out.profile.identity.length));
    ok("A6 profile.appearance 400 字内不截断", out.profile.appearance === long.profile.appearance.slice(0, 400));
    ok("A7 profile.personality 600 字内不截断", out.profile.personality === long.profile.personality.slice(0, 600));
    ok("A8 profile.goal/secret/firstImpression 各 300 字内不截断",
        out.profile.goal === long.profile.goal.slice(0, 300)
        && out.profile.secret === long.profile.secret.slice(0, 300)
        && out.profile.firstImpression === long.profile.firstImpression.slice(0, 300));
}

/* ---------- B. 排队条插到 .composer 之前 ---------- */
{
    const src = region(appSrc, "function ensureQueueBar()", "const QUEUE_TIP =", "ensureQueueBar");
    const inserted = [];
    const composer = {
        parentNode: {
            insertBefore(el, ref) { inserted.push({ el, ref }); }
        }
    };
    const input = {
        parentNode: composer,
        closest(sel) { return sel === ".composer" ? composer : null; }
    };
    const fakeEl = () => ({
        style: { cssText: "" }, id: "", innerHTML: "",
        isConnected: true,
        querySelector() { return { onclick: null }; }
    });
    const document = {
        getElementById(id) { return id === "chat-input" ? input : null; },
        createElement() { return fakeEl(); }
    };
    const fn = new Function("document", "MembershipService", "queueBarHide",
        "let queueBarEl = null, queueBarCancelled = false;\n" + src + "\nreturn ensureQueueBar;")(document, { openPanel() {} }, () => {});
    fn();
    ok("B1 排队条只插入一次", inserted.length === 1);
    ok("B2 排队条插在 .composer 之前，而不是 composer 内部", inserted[0] && inserted[0].ref === composer);
    ok("B3 排队条不是输入框的父节点内联行", !(inserted[0] && inserted[0].ref === input));
}

/* ---------- C. 数据入口与显示层 ---------- */
ok("C1 buildInitialState 主角身份上限 120", /next\.role = String\(preset\.role \|\| ""\)\.trim\(\)\.slice\(0, 120\)/.test(appSrc));
ok("C2 buildInitialState 外貌/性格/家庭上限 300", /next\.appearance = .*slice\(0, 300\)[\s\S]{0,120}next\.personality = .*slice\(0, 300\)[\s\S]{0,120}next\.family = .*slice\(0, 300\)/.test(appSrc));
ok("C3 upsertNpc relation 放宽到 60", /f === "relation" \? 60 : 12/.test(appSrc));
ok("C4 upsertNpc profile.identity 放宽到 200", /identity: String\(nextProfile\.identity[\s\S]{0,80}slice\(0, 200\)/.test(appSrc));
ok("C5 本地计划同时兼容 AI 的 relation 字段", /n\.relationship \|\| n\.relation \|\| n\.role/.test(appSrc));
ok("C6 本地计划读取 AI 的 profile.identity", /n\?\.profile\?\.identity/.test(appSrc));
ok("C7 新建 NPC 关系上限 60 / 性格 300", /new-npc-relation"\)\?\.value[\s\S]{0,80}slice\(0, 60\)/.test(appSrc) && /new-npc-personality"\)\?\.value[\s\S]{0,80}slice\(0, 300\)/.test(appSrc));
ok("C8 作品详情角色简介上限 400", /const desc = .*slice\(0, 400\)/.test(appSrc));
ok("C9 世界页人物简介全量显示", /const intro = introRaw;/.test(appSrc) && !/introRaw\.length > 60/.test(appSrc));
ok("C10 初始化预览外貌/性格/家庭输入上限 300", (htmlSrc.match(/id="init-preview-(appearance|personality|family)"[^>]*maxlength="300"/g) || []).length === 3);

/* ---------- D. CSS ---------- */
{
    const wx = cssBlock(".wx-list-desc");
    ok("D1 微信通讯录简介允许换行且不省略", /white-space:\s*normal/.test(wx) && !/nowrap/.test(wx) && !/text-overflow/.test(wx), wx);
    const gd = cssBlock(".gd-role-sub");
    ok("D2 作品详情角色简介不再两行截断", !/line-clamp/.test(gd) && /white-space:\s*normal/.test(gd), gd);
    const psb = cssBlock(".psb-role");
    ok("D3 状态栏主角身份允许换行", /white-space:\s*normal/.test(psb) && !/nowrap/.test(psb), psb);
    const tag = cssBlock(".status-tag");
    ok("D4 档案身份标签允许长文本换行", /max-width:\s*100%/.test(tag) && /overflow-wrap:\s*anywhere/.test(tag), tag);
}

console.log(fail === 0 ? `PASS ${pass}/${pass}` : `FAIL ${fail}/${pass + fail}\n` + fails.map((f) => " - " + f).join("\n"));
process.exit(fail === 0 ? 0 : 1);
