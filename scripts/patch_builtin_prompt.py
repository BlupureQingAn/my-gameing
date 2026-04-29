"""
精确替换 index.html 中的三处代码：
1. BuiltinPromptService — 扩展 state-patch 格式说明，buildStateFactLock 委托给 StateContextBuilder
2. PromptComposerService.buildRuntimeContext — 委托给 StateContextBuilder
3. 在 ChoiceService 之前插入 StateContextBuilder
从 index.html 直接操作（已是干净原始文件）。
"""
import pathlib, sys

src = pathlib.Path("index.html").read_text(encoding="utf-8")

# ─── 验证原始文件完整性 ───────────────────────────────────────────────────────
assert "const BuiltinPromptService" in src, "BuiltinPromptService not found"
assert "const ChoiceService" in src, "ChoiceService not found"
assert "function buildRuntimeContext(state)" in src, "buildRuntimeContext not found"
print("✓ Source file verified")

# ─── 1. 替换 BuiltinPromptService ────────────────────────────────────────────
# 找到精确的旧内容（从文件中读取的原始字节）
OLD_BUILTIN_START = '    const BuiltinPromptService = (() => {'
OLD_BUILTIN_END = '        return { getResponseRules, buildStateFactLock };\n    })();'

start_idx = src.index(OLD_BUILTIN_START)
end_idx = src.index(OLD_BUILTIN_END, start_idx) + len(OLD_BUILTIN_END)
old_builtin = src[start_idx:end_idx]
print(f"  BuiltinPromptService: chars {start_idx}-{end_idx}")

NEW_BUILTIN = '''    const BuiltinPromptService = (() => {
        function getResponseRules() {
            const endMarker = EndMarkerService.getMarker();
            const patchExample = JSON.stringify({
                protagonist: { name: "(可选)", ageYears: 18, location: "(可选)", nationality: "(可选)" },
                time: { year: 1990, month: 3, day: 5 },
                stats: [{ key: "health", label: "健康", icon: "❤️", value: 80 }],
                npcs: [{
                    id: "npc_id", name: "NPC名", relation: "关系", favor: 70,
                    status: "在线", mood: "开心", traits: "特质", gender: "女",
                    profile: { age: "25", identity: "身份", residence: "住所",
                        appearance: "外貌", personality: "性格", goal: "目标",
                        secret: "秘密", firstImpression: "初印象" }
                }],
                inventory: [
                    { op: "upsert", id: "item_id", name: "物品名", type: "道具", desc: "描述", effect: "效果", count: 1 },
                    { op: "remove", id: "item_id" }
                ]
            }, null, 2);
            return [
                "【内置返回规则】",
                "1) 必须优先遵循角色事实锁定块；若剧情中发生状态变更，必须通过 state-patch 结构化块同步改动。",
                "2) 必须只基于玩家最新输入和上下文推进剧情，不可脱离输入自说自话，不可重置世界观。",
                "3) 当前已启用美化卡片模式：必须直接输出 HTML 卡片，严禁输出 Markdown 文本。",
                "4) 每次回复都应包含：时间信息、状态变化、剧情对话、（AI想法：...）。",
                "5) 回复末尾必须提供 1-3 条可执行选项，使用编号格式：1. xxx",
                "6) 若剧情不适合选项，也要提供继续观察/继续推进等中性选项。",
                "7) 事件保持现实、日常、年龄逻辑正确。",
                "8) 不得强制使用你出生了/婴儿开局叙事，除非角色年龄明确 <= 1 岁。",
                "9) 若本轮涉及可变数据（主角属性/NPC属性/背包/时间/状态值），必须在 HTML 卡片之后追加 state-patch 代码块。",
                `10) 回复末尾必须追加且只追加一次结束符：${endMarker}（仅放在整条回复最末尾）。`,
                "11) 若当前设定存在待玩家选择的开局模式/路线/阵营，不得替玩家拍板，只能给出候选选项。",
                "",
                "【state-patch 格式】在 HTML 卡片之后追加（只写本轮变化的字段）：",
                "```state-patch",
                patchExample,
                "```",
                "说明：stats 若有变化需写全部属性。inventory op=upsert 为新增/更新，op=remove 为移除。NPC 用 id 定位，不存在则新建。"
            ].join("\\n");
        }
        function buildStateFactLock(state) {
            return StateContextBuilder.buildFactLock(state);
        }
        return { getResponseRules, buildStateFactLock };
    })();'''

src = src[:start_idx] + NEW_BUILTIN + src[end_idx:]
print("✓ BuiltinPromptService replaced")

# ─── 2. 在 ChoiceService 之前插入 StateContextBuilder ────────────────────────
CHOICE_ANCHOR = "    const ChoiceService = (() => {"
assert CHOICE_ANCHOR in src

STATE_CONTEXT_BUILDER = '''    // ── StateContextBuilder ──────────────────────────────────────────────────
    // 专门负责把 state 序列化成 AI 可读格式，与 prompt 构建完全解耦
    const StateContextBuilder = (() => {
        function serializeProtagonist(state) {
            return [
                `姓名:${state.name}`,
                state.englishName ? `英文名:${state.englishName}` : "",
                `性别:${state.gender}`,
                state.nationality ? `国籍:${state.nationality}` : "",
                state.location ? `地点:${state.location}` : "",
                `年龄:${Math.floor((state.age || 0) / 12)}岁`
            ].filter(Boolean).join("，");
        }
        function serializeTime(state) {
            return [
                state.currentYear ? `${state.currentYear}年` : "",
                state.currentMonth ? `${state.currentMonth}月` : "",
                state.currentDay ? `${state.currentDay}日` : "",
                state.timeEra || ""
            ].filter(Boolean).join("") || "未设定";
        }
        function serializeStats(state) {
            return (Array.isArray(state.stats) && state.stats.length)
                ? state.stats.map((s) => `${s.icon || ""}${s.label}:${s.value}`).join("，")
                : "无";
        }
        function serializeInventory(state) {
            const items = Array.isArray(state.inventory) ? state.inventory : [];
            if (!items.length) return "空";
            return items.map((it) => {
                const count = it.count > 1 ? `×${it.count}` : "";
                const effect = it.effect && it.effect !== "none" ? `[${it.effect}]` : "";
                return `${it.name}${count}${effect}(id:${it.id})`;
            }).join("；");
        }
        function serializeNpcs(state, full = false) {
            const npcs = (Array.isArray(state.npcs) ? state.npcs : [])
                .filter((n) => !StatePatchService.isProtagonistLikeNpc(state, n));
            if (!npcs.length) return "无";
            if (!full) {
                return npcs.map((n) =>
                    `${n.name}(id:${n.id},${n.relation},好感${n.favor},${n.status || "在线"},${n.mood || "平静"}${n.traits ? "," + n.traits : ""})`
                ).join("；");
            }
            return npcs.map((n) => {
                const p = (n.profile && typeof n.profile === "object") ? n.profile : {};
                const profileStr = [
                    p.age ? `年龄:${p.age}` : "",
                    p.identity ? `身份:${p.identity}` : "",
                    p.residence ? `住所:${p.residence}` : "",
                    p.personality ? `性格:${p.personality}` : "",
                    p.goal ? `目标:${p.goal}` : "",
                    p.secret ? `秘密:${p.secret}` : ""
                ].filter(Boolean).join("，");
                return `[${n.name}] id:${n.id} 关系:${n.relation} 性别:${n.gender || "未知"} 好感:${n.favor} 状态:${n.status || "在线"} 心情:${n.mood || "平静"} 特质:${n.traits || "无"}${profileStr ? " | " + profileStr : ""}`;
            }).join("\\n");
        }
        function buildFactLock(state) {
            return [
                "【事实锁定（高优先级，修改须附 state-patch）】",
                `主角：${serializeProtagonist(state)}`,
                `时间：${serializeTime(state)}`,
                `属性：${serializeStats(state)}`,
                `背包：${serializeInventory(state)}`,
                `NPC列表：\\n${serializeNpcs(state, true)}`
            ].join("\\n");
        }
        function buildRuntimeSummary(state) {
            return [
                "【运行时上下文】",
                `主角基础：姓名${state.name}，性别${state.gender}，年龄${Math.floor((state.age || 0) / 12)}岁，时间${Utils.nowDateStr(state) || "未设定"}。`,
                `主角状态栏：${serializeStats(state)}。`,
                `背包：${serializeInventory(state)}。`,
                `关键NPC：${serializeNpcs(state, false)}。`,
                "若用户输入与已确认事实冲突，先以礼貌方式说明冲突，再基于事实继续剧情。"
            ].join("\\n");
        }
        return { buildFactLock, buildRuntimeSummary, serializeInventory, serializeNpcs, serializeStats };
    })();

'''

src = src.replace(CHOICE_ANCHOR, STATE_CONTEXT_BUILDER + CHOICE_ANCHOR, 1)
print("✓ StateContextBuilder inserted before ChoiceService")

# ─── 3. 替换 PromptComposerService.buildRuntimeContext ───────────────────────
# 找到 PromptComposerService 内的 buildRuntimeContext
# 精确定位：找到 "function buildRuntimeContext(state) {" 后的完整函数体
RC_START = "        function buildRuntimeContext(state) {"
assert RC_START in src, "buildRuntimeContext not found after previous edits"

rc_start_idx = src.index(RC_START)
# 找到这个函数的结束：下一个 "        }" (8空格+})
rc_body_start = rc_start_idx + len(RC_START)
# 找到函数结束的 "        }"
rc_end_idx = src.index("\n        }", rc_body_start) + len("\n        }")
old_rc = src[rc_start_idx:rc_end_idx]
print(f"  buildRuntimeContext: chars {rc_start_idx}-{rc_end_idx}")
print(f"  old content preview: {repr(old_rc[:80])}")

NEW_RC = """        function buildRuntimeContext(state) {
            return StateContextBuilder.buildRuntimeSummary(state);
        }"""

src = src[:rc_start_idx] + NEW_RC + src[rc_end_idx:]
print("✓ buildRuntimeContext replaced")

# ─── 写出 ────────────────────────────────────────────────────────────────────
pathlib.Path("index.html").write_text(src, encoding="utf-8")
print(f"Done. Total chars: {len(src)}")
