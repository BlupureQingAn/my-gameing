// 剧本结构化 schema（借鉴 Character Card V2 规范，去繁就简）
// 官方剧本 = 纯 JSON 数据；世界档案剧本内置，前端开局直接渲染，AI 每轮只填空（M1 协议）
// 纯逻辑模块，无 DOM 依赖，可 node 单测

export const CARD_SPEC = "bitlife_card_v1";

// 卡片样式主题（M4 内置 CSS 主题库的 key 枚举）
export const THEME_KEYS = [
    "retro-paper", "cyber-neon", "ink-wash", "glass", "liquid",
    "gothic", "minimal", "fantasy", "sci-fi-hud", "cottage",
];

export function emptyData() {
    return {
        theme: "retro-paper",
        world: { era: "", genre: "", summary: "", rules: [], atmosphere: "" },
        identity: { name: "", gender: "", age: "", background: "" },
        npcs: [],
        timeline: { start: { year: 2026, month: 1, day: 1 }, note: "" },
        scene_style: { env_templates: [], option_style: "" },
        first_scene: { story: "", options: [] },
    };
}

function str(v, max) {
    const s = typeof v === "string" ? v.trim() : "";
    return max ? s.slice(0, max) : s;
}

// 校验 + 规范化：返回 { ok, data | errors }
export function validateStructured(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["data-not-object"] };
    const errors = [];
    const out = emptyData();

    out.theme = THEME_KEYS.includes(data.theme) ? data.theme : "retro-paper";

    const w = data.world && typeof data.world === "object" ? data.world : {};
    out.world.era = str(w.era, 60);
    out.world.genre = str(w.genre, 60);
    out.world.summary = str(w.summary, 2000);
    out.world.rules = Array.isArray(w.rules) ? w.rules.filter(r => typeof r === "string" && r.trim()).map(r => r.trim().slice(0, 500)).slice(0, 12) : [];
    out.world.atmosphere = str(w.atmosphere, 300);
    if (!out.world.summary) errors.push("world.summary 必填");

    const idn = data.identity && typeof data.identity === "object" ? data.identity : {};
    out.identity.name = str(idn.name, 40);
    out.identity.gender = str(idn.gender, 20);
    out.identity.age = str(idn.age, 20);
    out.identity.background = str(idn.background, 1000);
    if (!out.identity.name) errors.push("identity.name 必填");

    if (Array.isArray(data.npcs)) {
        out.npcs = data.npcs
            .filter(n => n && typeof n === "object" && typeof n.name === "string" && n.name.trim())
            .slice(0, 20)
            .map(n => {
                const fav = Number(n.favor);
                const aff = Number(n.affection);
                const npc = {
                    name: str(n.name, 40),
                    gender: str(n.gender, 8),
                    role: str(n.role, 60),
                    personality: str(n.personality, 300),
                    relationship: str(n.relationship, 300),
                };
                if (Number.isFinite(fav)) npc.favor = Math.max(-100, Math.min(100, fav));
                if (Number.isFinite(aff)) npc.affection = Math.max(-100, Math.min(100, aff));
                return npc;
            });
    }

    const tl = data.timeline && typeof data.timeline === "object" ? data.timeline : {};
    const st = tl.start && typeof tl.start === "object" ? tl.start : {};
    const y = Number(st.year), m = Number(st.month), d = Number(st.day);
    out.timeline.start = (isFinite(y) && isFinite(m) && isFinite(d) && y >= 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
        ? { year: y, month: m, day: d }
        : { year: 2026, month: 1, day: 1 };
    out.timeline.note = str(tl.note, 300);

    const ss = data.scene_style && typeof data.scene_style === "object" ? data.scene_style : {};
    out.scene_style.env_templates = Array.isArray(ss.env_templates) ? ss.env_templates.filter(e => typeof e === "string" && e.trim()).map(e => e.trim().slice(0, 200)).slice(0, 8) : [];
    out.scene_style.option_style = str(ss.option_style, 300);

    const fs = data.first_scene && typeof data.first_scene === "object" ? data.first_scene : {};
    out.first_scene.story = str(fs.story, 3000);
    out.first_scene.options = Array.isArray(fs.options) ? fs.options.filter(o => typeof o === "string" && o.trim()).map(o => o.trim().slice(0, 200)).slice(0, 3) : [];

    if (errors.length) return { ok: false, errors };
    return { ok: true, data: out };
}

// 结构化数据 → 模型用设定文本（每轮 prompt 的世界设定段）
export function renderScenarioText(data) {
    const d = (validateStructured(data).ok ? validateStructured(data).data : emptyData());
    const lines = [];
    lines.push("【世界设定】");
    if (d.world.era) lines.push(`时代：${d.world.era}`);
    if (d.world.genre) lines.push(`题材：${d.world.genre}`);
    lines.push(`简介：${d.world.summary}`);
    if (d.world.rules.length) {
        lines.push("规则：");
        d.world.rules.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
    }
    if (d.world.atmosphere) lines.push(`氛围：${d.world.atmosphere}`);

    lines.push("");
    lines.push("【主角身份】");
    lines.push(`姓名：${d.identity.name}`);
    if (d.identity.gender) lines.push(`性别：${d.identity.gender}`);
    if (d.identity.age) lines.push(`年龄：${d.identity.age}`);
    lines.push(`背景：${d.identity.background || "（由故事发展决定）"}`);

    if (d.npcs.length) {
        lines.push("");
        lines.push("【重要人物】");
        d.npcs.forEach(n => {
            lines.push(`- ${n.name}（${n.role || "?"}）：${n.personality || ""}${n.relationship ? `；与主角：${n.relationship}` : ""}`);
        });
    }

    lines.push("");
    lines.push("【时间线】");
    lines.push(`起始：${d.timeline.start.year}年${d.timeline.start.month}月${d.timeline.start.day}日`);
    if (d.timeline.note) lines.push(`备注：${d.timeline.note}`);

    if (d.scene_style.option_style) {
        lines.push("");
        lines.push(`【选项风格】${d.scene_style.option_style}`);
    }
    return lines.join("\n");
}

// 剧本 → 卡片记录（id/标题等元信息 + structured）
export function makeCard({ id, title, category, data }) {
    const v = validateStructured(data);
    if (!v.ok) throw new Error(`剧本校验失败 ${id}: ${v.errors.join(",")}`);
    return {
        id, title: str(title, 80), category: str(category, 40),
        theme: v.data.theme, structured: v.data, text: renderScenarioText(v.data),
    };
}
