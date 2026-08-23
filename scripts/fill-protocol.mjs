// 填空协议：主线剧情每轮 AI 只输出变化字段 JSON（纯逻辑模块，无 DOM 依赖，可 node 单测）
// 协议设计参考 2026 行业共识：narration + choices + state_delta
// 字段说明：
//   story   剧情正文（纯文本多段；对话直接写在正文，如：王老板 对你说：“...”）
//   time    时间推进（可选，未推进省略）{year, month, day}
//   stats   状态变更（可选，给出变更后的完整值）[{key, value}]
//   items   新增道具（可选）[string]
//   options 选项 1-3 条（必填，主角可执行的行动）
//   scene   环境标签（可选，如：夜晚/酒馆/雨天）

export const ROUND_FILL_DOC = `你每轮只输出一个 JSON 对象，不输出 HTML、markdown 围栏或任何解释文字。字段如下：
{"story":"本轮剧情正文 2-4 段；人物对话直接写在正文里，格式：角色名 对 主角说：“...”","time":{"year":1985,"month":3,"day":2},"stats":[{"key":"金钱","value":"120/200"}],"items":["新增道具"],"options":["选项1","选项2","选项3"],"scene":"夜晚/酒馆"}
约束：
1) story 必填且最优先，其他字段只在变化时给出；
2) options 1-3 条，必须是主角可以直接选择的行动；
3) stats/items 给出变更后的完整值（供直接覆盖）；
4) time 未推进时省略；
5) 只输出 JSON 本身，前后不要任何其他字符。`;

export function buildRoundFillPrompt({ scenarioText, timeText, statsSummary, historySummary, userText }) {
    const system = [
        "你是云吞吞文游模拟器的主线剧情引擎，负责剧情推进与状态填空。",
        "【世界设定】必须严格遵守，不可脱离世界观与年代。",
        "【输出格式】\n" + ROUND_FILL_DOC,
    ].join("\n");
    const user = [
        `【世界设定】\n${scenarioText}`,
        `【当前时间】${timeText}`,
        `【当前状态】${statsSummary}`,
        `【最近剧情】\n${historySummary}`,
        `【主角本轮行动】${userText}`,
        "只输出 JSON。",
    ].join("\n\n");
    return { system, user };
}

export function parseRoundFill(text) {
    if (!text || !String(text).trim()) return { ok: false, reason: "empty", raw: text };
    let t = String(text).trim();
    // 剥 markdown 围栏
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/m, "");
    // 整体是 JSON 数组 → 拒绝（协议要求对象）
    if (/^\[[\s\S]*\]$/.test(t)) {
        try {
            if (Array.isArray(JSON.parse(t))) return { ok: false, reason: "array-not-object", raw: text };
        } catch { /* 不是合法数组，落入对象提取 */ }
    }
    const start = t.indexOf("{");
    if (start < 0) return { ok: false, reason: "no-json-object", raw: text };
    const end = t.lastIndexOf("}");
    if (end <= start) return { ok: false, reason: "invalid-json", raw: text };
    try {
        const obj = JSON.parse(t.slice(start, end + 1));
        return normalizeRoundFill(obj, text);
    } catch (e) {
        return { ok: false, reason: "invalid-json", raw: text };
    }
}

// 校验 + 规范化（丢弃未知字段，防御坏数据）
export function normalizeRoundFill(obj, raw) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "not-object", raw };
    if (typeof obj.story !== "string" || !obj.story.trim()) return { ok: false, reason: "story-missing", raw };
    if (obj.options !== undefined && !Array.isArray(obj.options)) return { ok: false, reason: "options-not-array", raw };
    const out = { story: obj.story.trim() };
    const opts = Array.isArray(obj.options)
        ? obj.options.filter(o => typeof o === "string" && o.trim()).map(o => o.trim())
        : [];
    if (opts.length) out.options = opts.slice(0, 3);
    if (obj.time && typeof obj.time === "object" && !Array.isArray(obj.time)) {
        const y = Number(obj.time.year), m = Number(obj.time.month), d = Number(obj.time.day);
        if (isFinite(y) && isFinite(m) && isFinite(d)) out.time = { year: y, month: m, day: d };
    }
    if (Array.isArray(obj.stats)) {
        out.stats = obj.stats
            .filter(s => s && typeof s === "object" && typeof s.key === "string" && s.key.trim() && s.value !== undefined && s.value !== null && s.value !== "")
            .map(s => ({ key: s.key.trim(), value: String(s.value) }));
        if (!out.stats.length) delete out.stats;
    }
    if (Array.isArray(obj.items)) {
        out.items = obj.items.filter(i => typeof i === "string" && i.trim()).map(i => i.trim());
        if (!out.items.length) delete out.items;
    }
    if (typeof obj.scene === "string" && obj.scene.trim()) out.scene = obj.scene.trim();
    return { ok: true, data: out };
}
