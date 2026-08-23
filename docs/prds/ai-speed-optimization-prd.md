# PRD：AI 调用速度极致优化 + 卡片模板化重构（云吞吞文游模拟器）

- 日期: 2026-08-23
- 状态: 待方案确认（第二阶段完成前不写代码）

## 1. 背景与目标

现有主线剧情每轮由 AI 生成**完整 HTML 卡片**（含世界观/身份/NPC/时间/选项全部内容），prompt 携带完整卡片设定+档案+历史 → payload 大、输出 tokens 多、固定内容每轮重复生成 → 慢。

**目标**: 每轮生成 3-5 秒（流式），开局初始化 5-10 秒；卡片视觉更精美且消除多层嵌套。

## 2. 现状诊断（生成链路）

| 环节 | 现状 | 问题 |
|---|---|---|
| 主线每轮 | AI 输出完整 HTML（normalizeHtmlCard 清洗），prompt 含完整 scenarioText+档案+历史 | 输出 tokens 大、重复生成固定内容 |
| 开局初始化 | AI 生成首卡 HTML + state-patch 补全 | 一次性大请求 |
| 状态同步 | 双路：主聊天禁 state-patch（StateAuditor 后台提取）+ NPC 对话可带 | 复杂 |
| 卡片样式 | AI 自由生成 HTML 内联样式 | 不可控、嵌套深、美化受限 |

## 3. 已确认决策（三轮澄清）

1. **生成策略**: 单请求串行 + 纯 JSON 填空 + 流式渲染（不做并行拆分——瓶颈是输出 tokens 总量，并行增限速与一致性风险）
2. **世界档案**: **剧本内置**（结构化剧本字段），非 AI 开局生成；旧自由文本剧本由 AI 一键解析补全
3. **样式库**: 内置纯 CSS **10+ 套主题**（复古纸张/赛博霓虹/水墨/玻璃拟态等），卡片数据存 `theme` 字段，前端套模板渲染，零外部依赖保持单文件架构
4. **旧数据**: 旧存档/历史消息用旧渲染器兼容保留；新开局走新模板；**旧剧本全部删除**（2026-08-23 变更：不做兼容解析，重建原创剧本库）
5. **性能指标**: 每轮 3-5 秒，开局 5-10 秒

## 4. 开源调研对比（2026-08-23）

### 4.1 AI 文字冒险引擎（结构化 JSON 协议）
| 项目 | 核心 | 可借鉴 |
|---|---|---|
| TaleSpindle（npm） | 剧本=纯 JSON 数据（nodes/items/flags/条件选项），AI 经 MCP 创建剧情，导出单文件 HTML | 单文件架构 + JSON 剧本 |
| TaleWeaver（FastAPI+Vue） | **2-Pass**: Pass1 逻辑模型评估行动→严格 JSON GameEvent 突变状态；Pass2 创意模型把 JSON 转叙事 | 状态突变确定性化，叙事只负责"填空" |
| NarraWorks（TS SDK） | 确定性护栏校验模型输出（必填字段/未知 key 拒绝/物品上限） | 填空 JSON 的 schema 校验层 |
| cryptd（Go） | Go 引擎=确定性规则机，LLM 只当 DM，规则不交给概率输出 | 状态机与 AI 分离 |
| naderu-loom-7b | 每轮单 JSON：scene narration + choices + **state_delta**，valid-JSON 率 1.000 | 填空协议范本（narration+choices+state_delta） |

**行业共识**: 2026 年标准模式 = **narration + choices + state_delta** 三段 JSON；护栏/校验层防幻觉状态变更。

### 4.2 结构化角色卡规范（SillyTavern）
- **Character Card V2/V3**: `{spec, spec_version, data{name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, alternate_greetings, character_book(lorebook), extensions}}`
- `character_book` = 嵌入式 lorebook（关键词触发条目 + token 预算）→ 世界档案存储范式
- `extensions` = 自定义扩展字段（世界档案可放 `extensions.my_bitlife.world_archive`）
- 剧本卡片新格式直接借鉴此规范（去繁就简）

### 4.3 玻璃拟态/卡片样式（纯 CSS 可选）
| 项目 | 可提炼模式 |
|---|---|
| glinui | 5 档玻璃深度（--glass-1..5）+ 顶部折射高光 |
| glasscn | 5 种玻璃面变体：clear/frosted(16px blur)/subtle/liquid/liquid-refract |
| velore | iOS 26 liquid glass，CSS-only 模式（tint/radius 变体） |
| sleyt（纯 CSS 零 JS） | .glass/.frosted 工具类 + 20 组件 + dark mode |

**结论**: 样式库不引入框架，手工提炼模式（玻璃分档/折射高光/liquid 多层斜面/纸张纹理/水墨晕染等）内置 10+ 主题。

## 5. 总体架构

```
剧本卡片(结构化 JSON) ──┬── 世界档案(固定) → 前端直接渲染(环境/身份/NPC/时间基线)
                        ├── theme 字段 → 套用样式主题
                        └── 每轮填空 → AI 仅返回变化字段 JSON → 模板渲染
```

**数据流**:
1. 剧本创建/导入: 自由文本 → AI 一键解析 → 结构化剧本（档案字段 + 模板字段）
2. 开局: 读卡片数据直接渲染首卡（无需 AI 请求，或仅一次首剧情请求）
3. 每轮: 前端组装最小 prompt（速查表 + 最近历史）→ 单请求 → 流式 JSON 填空 → 前端套模板渲染

## 6. 填空协议草案（每轮 AI 返回）

```json
{
  "story": "剧情正文（纯文本，可多段，含对话行）",
  "time": { "year": 2026, "month": 8, "day": 15 },
  "stats": [ { "key": "金钱", "value": "120/200" } ],
  "items": [ "新增物品" ],
  "options": [ "选项一", "选项二", "选项三" ],
  "scene": "环境状态标签（如：夜晚/雨中/酒馆）"
}
```

- 输出约束: worker 强制 JSON（system 指令 + 解析失败重试 ≤2 次）
- 校验层: 前端 SchemaValidator（必填字段 story/options；非法 key 丢弃；stats/items 白名单格式）
- 对话写法: 剧情正文内直接写对话（`xxx 对你说：“...”`），不单独拆 dialogue 字段（减少输出 tokens、保持一致性）

## 7. 剧本 Schema 草案（借鉴 Character Card V2）

```json
{
  "spec": "bitlife_card_v1",
  "data": {
    "title": "八十年代港星养成",
    "theme": "retro-film",
    "world": { "era": "1980s HK", "genre": "娱乐圈", "summary": "...", "rules": ["..."], "atmosphere": "..." },
    "identity": { "name": "", "gender": "", "age": "", "background": "" },
    "npcs": [ { "name": "", "role": "", "personality": "", "relationship": "" } ],
    "timeline": { "start": { "year": 1985, "month": 3, "day": 1 }, "note": "" },
    "scene_style": { "env_templates": ["..."], "option_style": "" },
    "first_scene": { "story": "...", "options": ["..."] }
  }
}
```

- 新剧本编辑器: 分区表单（标题/主题选择/世界档案各区块/NPC 列表/首场景）
- 旧剧本: 「一键解析」按钮 → AI 提取填充分区 → 用户确认修改

## 8. 渲染管线

```
fillCardTemplate(theme, fields)
  → 主题样式(纯CSS类) + 卡片骨架(2-3层语义结构) + 填空字段注入
  → 渲染历史消息也走同一模板（旧消息标记 legacy 用旧渲染器）
```

**消除多层嵌套**: 卡片骨架固定为 `article.card > (header.meta + section.body + footer.options)` 三层；装饰（渐变/纹理/高光/描边）全部用 CSS 伪元素 + background 实现，不新增 DOM 层。

## 9. 样式库（10+ 主题规划）

| # | 主题 key | 风格 |
|---|---|---|
| 1 | retro-paper | 复古纸张（牛皮纸纹理/手写体/邮票角） |
| 2 | cyber-neon | 赛博霓虹（黑底霓虹描边/故障字） |
| 3 | ink-wash | 水墨（晕染/宣纸/书法标题） |
| 4 | glass | 玻璃拟态（frosted blur/折射高光） |
| 5 | liquid | Liquid Glass（多层斜面/环境光漂移） |
| 6 | gothic | 哥特暗黑（暗金/荆棘纹饰） |
| 7 | minimal | 极简排版（大留白/衬线字/细线分隔） |
| 8 | fantasy | 奇幻羊皮纸（羊皮卷/烫金/符文） |
| 9 | sci-fi-hud | 科幻 HUD（等宽字体/扫描线/边框角标） |
| 10 | cottage | 田园暖色（奶油/碎花/圆角） |
| 11+ | ... | 按需追加 |

每个主题 = CSS 变量集（色板/字体/纹理/装饰）+ 卡片骨架类。

## 10. 兼容策略

- 旧存档（进行中）: 渲染旧 HTML 卡片的逻辑保留（legacy 分支），新开局才用新协议
- 旧剧本: **全部删除**（2026-08-23 变更），由原创剧本库替代
- worker.js: 无需大改（协议变化在前端；可加 JSON 强制与重试）

## 13. 剧本库建设（2026-08-23 新增，M6）

- **目标**: 各类偏好用户 ≥5 个选择；品类覆盖：宫斗/穿越/修仙/娱乐圈/都市/悬疑/科幻/历史/校园/奇幻等（按调研定）
- **格式**: 全部使用新结构化 schema（M2 产出），世界档案剧本内置
- **来源**: 原创编写 + 网络题材调研（避免侵权，原创世界观与人物）

## 11. 验收标准

1. 新开局: 创建/解析剧本 → 首卡渲染 ≤10 秒（不含 AI 解析旧剧本）
2. 每轮生成: 3-5 秒（流式可见）; 无 QUOTA 误触
3. 卡片视觉: 10+ 主题可选，任意主题下无多层嵌套感，美化元素不减反增
4. 旧存档可继续游玩（旧消息正常显示）
5. 填空协议容错: AI 返回坏 JSON → 前端校验层降级（保留 story 文本渲染）

## 12. 风险

- JSON 解析失败率: 靠 worker 强制 JSON + 前端降级兜底
- 剧情一致性: 填空字段少了"上下文"，靠每轮 prompt 带精简速查表（世界档案压缩版）+ 最近 5 轮历史
- 旧剧本解析质量: AI 提取可能缺字段 → 解析后用户可编辑确认
- 状态 sync 复杂度: 从"HTML+审计"迁到"JSON state_delta 直读"（简化）
