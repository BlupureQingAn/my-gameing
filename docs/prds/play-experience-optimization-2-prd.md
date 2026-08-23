# PRD:游玩体验二轮优化——卡片列表分组 / 主题差异化 / 剧情卡生成提速(云吞吞文游模拟器)

- 日期: 2026-08-23
- 状态: 待小徐确认
- 前置: ai-speed-optimization-prd.md(M1-M5 已落地并提交 30f59a8→04c2bf8)

## 1. 背景与目标

小徐反馈三个问题:

- **A. 卡片列表分组**:删除"自定义"分组,改为"最近游玩的卡片列表置顶"(澄清确认:自定义卡并入官方分类,最近游玩显示 5 张,新建按钮保留顶部)
- **B. 所有剧本卡片样式一样**:70/70 张官方卡 theme 全是 retro-paper(已定位根因:build-scenarios.mjs 丢 item.theme)
- **C. 剧情卡生成慢**:点发送后转圈很久才出第一个字(首 token 慢)

## 2. 现状诊断(探针实测数据)

### C 慢的根因链(perf_probe.mjs + prompt_size_probe.mjs 实测)

| 环节 | 实测数据 | 结论 |
|---|---|---|
| 前端同步 prompt 构建 | 10~17ms | **排除**(不慢) |
| 每轮请求次数 | 主请求 + **HTML 强制重试** + auditor = 3 个请求 | **主因:请求翻倍** |
| 主请求 system prompt | 首轮 3265 字符(83 行)/ 后续轮 2959 字符(quickRef) | 体积合理 |
| 主请求 user prompt | 749~1565 字符 | 可控 |
| HTML 重试 prompt | 主 prompt + rawText(~300字符) | 略大,非主因 |
| latestHtmlCard | 上一张完整 HTML 卡**全文**塞入每轮 user prompt | 次因:TTFT 输入增长 |

**矛盾指令(根因)**:L9202 主请求 system prompt 同时包含两套互相矛盾的输出指令——

- builtinRules(L4368-4394,getResponseRules)第 3 条:"**必须直接输出 HTML 卡片,严禁输出 Markdown 文本**";第 10 条:"严禁输出 ```state-patch``` 或任何 JSON 数据块"
- beautyRules(L7681-7698,buildBeautyRules):"**本次回复必须输出且仅输出一个 JSON 对象,严禁输出任何 HTML 标签**"(填空协议)

→ 模型无法同时满足 → 输出行为不稳定 → `containsHtmlCard` 检测失败 → L9237-9260 强制发起第二次完整请求(HTML 重试)→ **每轮 2 次完整 LLM 生成,用户感知延迟翻倍**。

### B 根因(已定位)

- scenarios/category_*.json 的 item.theme 各异(sci-fi-hud/cyber-neon/ink-wash/...)
- scripts/build-scenarios.mjs makeCard 调用只传 {id,title,category,data},**丢弃 item.theme**
- scenario-schema.mjs 从 data.theme 读(不存在)→ 默认 retro-paper → scenarios.js 70/70 全 retro-paper
- 前端 readStructuredForm(L6379)已写 structured.theme;需确认 syncFormFromCard 读回(内嵌闭环)

### A 现状

- renderScenarioCards(L5867-5953):按 sourceType 分组(official→category,非官方→"自定义"),normalizeCards 强制自定义卡第一位
- ScenarioPlayMetaService(L7090)已有 per-card 元信息存储(playMetaMap,字段 hasInitialized)→ 直接扩展 lastPlayedAt
- 新建按钮 L2505(顶部,保留不动)

## 3. 方案设计

### A. 卡片分组改造(renderScenarioCards + playMeta)

1. **删除"自定义"分组**:所有非 official 卡按 `card.category` 并入对应分类组(与官方卡混排)
2. **新增"最近游玩"置顶组**:取 playMetaMap 中 lastPlayedAt 存在的前 **5** 张(倒序),在全部分类组之前渲染,标题"最近游玩"
3. **记录游玩时间**:playScenarioCard 入口写 `playMetaMap[cardId].lastPlayedAt = Date.now()`(复用 ScenarioPlayMetaService,getMeta 默认补字段)
4. 新建按钮不变(顶部常驻)

### B. 主题差异化(build-scenarios.mjs)

1. build-scenarios.mjs:makeCard 传 `data: { theme: item.theme, ...item.data }`
2. 重新生成 scenarios/scenarios.js → 验证 70 张卡主题差异化(≥8 种)
3. 确认前端闭环:syncFormFromCard 从 structured.theme 读回主题选择器;getBeautyCardSetting(L6049)已读 selected.theme → 生成时按卡主题套样式(已通,确认即可)

### C. 剧情卡提速(核心)

**C1. 统一输出指令(消矛盾,主因修复)**

buildBeautyRules(L7681-7698)重写为与 builtinRules 一致:

- 主指令:"必须直接输出 HTML 卡片(class=\"ai-beauty-card\" 的 article/section/div),严禁输出 Markdown 纯文本;严禁输出 ```state-patch``` 或 JSON 数据块"
- 兼容兜底:"若你更习惯结构化输出,可输出 JSON 填空协议 {story,time,stats,items,options,scene},前端自动渲染成同款卡片"(前端 parse 已兼容)
- 保留:stats 白名单/数值格式/主题名/暗夜提示

效果:AI 主输出 HTML → containsHtmlCard 通过 → 不触发重试 → **每轮 1 次生成**。JSON 填空走 fillCardTemplate 渲染同样不算重试(parse 后 turnFill 非空,跳过重试分支 L9232 `!turnFill`)。

**C2. latestHtmlCard 瘦身(次因)**

buildMainUserPrompt 的 latestCardBlock 由"完整 HTML 卡全文"改为**骨架摘要**:

- 保留:rootTag/rootClass/rootStyle/主题 + block 顺序(复用 buildSkeletonHintFromLocked 逻辑或 extractSkeleton)
- 丢弃:正文长文本(事件/剧情内容)
- 目标:latestCardBlock ≤600 字符(现可能 2-5KB)

**C3. auditor 触发条件收紧(顺带核查)**

重试成功输出 HTML 卡(含 data-block="status")后不应再触发 auditor;实测若每轮仍触发,核查 `!rawPatchChanged && !panelChanged` 判定(injectStatsIntoCard 是否覆盖 panelChanged)。此项以实测为准,不强行改动。

### 4. 验证

- **A**:Puppeteer——自定义卡并入分类组;最近游玩组 5 张按 lastPlayedAt 倒序;新建按钮在顶部;playScenarioCard 后 lastPlayedAt 更新
- **B**:重新生成后 scenarios.js 主题计数 ≥8 种;官方卡 getBeautyCardSetting 返回各自主题
- **C**:改造后 prompt_size_probe——主请求含 HTML 指令、每轮**无重试**(除 AI 故意输出纯文本的兜底测试);latestCardBlock ≤600 字符;m3/m4 全量回归绿
- 全量回归:f3/f4/f5/f6/sf/m3/m4/m5 + sim-worker

## 5. 风险

- C1 后 AI 偶尔仍输出纯文本 → 重试兜底保留(htmlRetryCount=1),成本=1 次额外请求,概率从"几乎必发"降到"偶发"
- JSON 填空兼容保留 → M3 协议(m3_smoke)不受影响
- 自定义卡 category 为空 → 归入"其他"兜底组,不丢卡

## 6. 执行顺序

C(体验最痛)→ B(一行修复+重建)→ A(分组 UI)→ 全量回归 → 提交
