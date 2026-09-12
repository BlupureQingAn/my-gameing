# PRD：平板端横屏交互体验（全页面自适应）

- 日期：2026-09-13
- 状态：执行中（小徐已确认：全面覆盖所有页面；整体组件最小化改动支持自适应宽高；遮罩改为可跳过提示）

## 背景与问题

- 现象：小徐的平板横屏打开站点被「请竖屏使用云吞吞文游」整屏遮罩挡住。
- 定位（2026-09-13 代码审计，全站 html 检索）：
  - **唯一硬阻断** = index.html 的 `#rotate-hint` 遮罩，触发条件 `@media (orientation: landscape) and (max-width: 900px)`（只看宽度、不看高度）→ 横屏宽度 ≤900 的小平板也被整屏遮挡。
  - 无 JS 方向锁定（`screen.orientation` 无调用）、manifest 无 orientation 锁定。
  - 主体布局本身已基本流式：`#app` max-width 1120px 纵向 flex 壳、`.content` flex:1 滚动、栅格 1fr / auto-fill、仅少量固定高度；已有 521/768/1024 宽度断点。
  - learn.html 纯流式（wrap max-width 760px），无阻断。
  - 缺口：横屏矮视口（高度 ≤640px）时 header / content / chat-footer 纵向留白未压缩，一屏可用性不足。

## 范围（小徐已确认）

- 目标：保证网站所有页面平板横屏可正常交互；明确**不做**双栏重设计。
- 方案取向：整体组件**全部最小化改动**支持自适应宽度高度。
- 遮罩处理：保留提示但**改为可跳过**。

## 方案

1. **旋转提示遮罩收窄 + 可跳过**（index.html）
   - 触发条件收窄为真·手机横屏：`(orientation: landscape) and (pointer: coarse) and (max-height: 500px)` → 平板横屏（高度 > 500px）永不遮挡；桌面短窗口（pointer:fine）也不再被弹。
   - 新增「继续横屏使用」按钮：点击隐藏遮罩并写 `localStorage["yt_rotate_hint_off"]=1`，之后访问不再弹（内联 `display:none` 覆盖媒体查询）。
2. **横屏矮视口压缩层**（index.html，现有 min-width:1024 块之后追加）
   - `@media (orientation: landscape) and (max-height: 640px)`：`.header` padding 12→8px；`.content` padding 12→10px；`.chat-footer` 上下 padding 收紧至 8px（横向保留 768/1024 断点值）。
   - 选 640 阈值的理由：手机横屏（~360-480）与 1024×600 类小平板全部覆盖；iPad 类 768+ 高度不触发，避免无谓改动。
3. **learn.html**：审计后无阻断、无需改动（纯流式）。
4. **验证文件/其他静态页**：无布局依赖，不动。

## 验收

- 线上 curl：新媒体查询、跳过按钮、localStorage 键均命中；行号与本地一致。
- 静态自检：内联脚本 `node --check` 通过 + CSS 花括号配平。
- 真机验收（小徐）：平板横屏不再被遮挡、一屏可用；手机横屏仍见提示但可跳过，跳过状态持久化。
- 按既定指示不做浏览器实测。

## 不做（本轮排除）

- 双栏 / 桌面级布局重设计。
- 分屏多任务（split view）特殊适配。
- PWA manifest orientation 字段调整（当前无锁定，默认 any）。
