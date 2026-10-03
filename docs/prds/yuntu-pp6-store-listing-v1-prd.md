# 云吞吞站内上架《傲慢与偏见（六级版）》 PRD（v1.0）

> 2026-10-03 深夜 · 自主模式编写（小徐睡前指令，授权自主完成，晨间验收）
> 产品线主 PRD: `docs/prds/yuntu-pride-prejudice-cet6-prd.md`（v1.1，网盘渠道 ¥9.9）
> 本 PRD 只覆盖「站内上架」渠道，与网盘渠道并存互不影响。

## 1. 需求原文（小徐 2026-10-03 23:5x）

> 「顺便把封面改为 [Image #1] 的 C 选项然后上架到云吞吞文游的学英语剧本库
> （只用上架完整版并不用标注完整版，定价 5 元会员免费，注意生词本接入网站的生词本，
> 点译不用接入，毕竟人家买断了内置就行）」

- [Image #1] = s7 四张封面候选（A 庄园晨雾 / B 信笺蜡封 / **C 玫瑰藤蔓边框** / D 书房烛夜）→ 定 C
- 「只用上架完整版」= 站内只上架全书 61 章完整版（不上第Ⅰ/Ⅱ/Ⅲ部、不上试读版）
- 「不用标注完整版」= 站内标题就叫《傲慢与偏见（六级版）》，不带「· 完整版」字样
- 「买断了内置就行」= 站内买家在产物内使用内置点译（不走站内点译配额/计费），点译无需接入

## 2. 与既有决策的对齐

| 出处 | 决策 | 本 PRD 的落实 |
|---|---|---|
| 产品 PRD D19 原文「站内 5 元买断/会员免费」 | ¥5 + 会员免费（后因渠道调整搁置） | 本次恢复并落地 |
| 产品 PRD「会员到期不丢进度」 | 买断永久 | 购买写 PB `unlocks` 记录，永久有效；会员到期后已购仍可玩 |
| 产品 PRD D27 | 生词本本地实现 | 站内版**升级为双写**：本地照旧 + 写通站内 `/api/lang/vocab` |
| 站内既有惯例 | 付费内容「终身会员免费」用云币解锁（社区卡） | 本商品**不**走云币解锁——金额为人民币 ¥5 直付（同 PACK_PLANS 模式），会员（月/年/终身）全免 |
| 移动端修复 2026-10-03 | 引擎三处布局已修 | 本次重导的产物全部携带该修复 |

## 3. 范围

**In**：站内剧本库卡片+详情、¥5 微信直付、权限门（产物内付费墙）、生词本写通、封面 C 集成、产物按新引擎重导、部署与验证。
**Out**：点译接入（买断内置）、按部上架、试读版上架、云币价（不做双货币）、产物内购买入口之外的站内「我的剧本」列表（未来可加）。

## 4. 关键决策（自主模式假设，全部可回滚）

| # | 决策 | 理由 / 回滚 |
|---|---|---|
| S1 | 产物托管 = `bitlife.blupure.cn/story/pp6/`（nginx 静态目录 `/var/www/story/pp6/`，**不进 git 仓库**） | 12.4MB 文件提交会永久膨大 git 历史；同源托管使 localStorage（token/进度）与主站天然共享。回滚=删目录+删 location |
| S2 | 权限门 = **产物内置 boot 门**（全屏遮罩，fail-closed），而非 nginx 层鉴权 | 鉴权 token 在 localStorage（非 Cookie），nginx 无法感知；付费墙在产物内读同源 localStorage → 调 `/api/story/access`。回滚=重新导出无门版本 |
| S3 | 定价载体 = 新 `STORY_PLANS = { pp6: ¥5 }` + 订单创建/发货分支（发货=写 `unlocks` 记录 `store_pp6`，幂等） | 复用 pay_orders / 微信网关 / 轮询全套现成链路；`unlocks` 是站内既有"解锁"表，语义吻合。回滚=worker rollback |
| S4 | 会员口径 = 任意有效会员（月 ¥21/年 ¥49/终身 ¥98，`isMember()` 按 membership_expires_at 判定） | 「会员免费」未限定档位；站内 isMember 统一口径。到期自动回到需购买状态（但已购者不受影响） |
| S5 | 生词本 = **单向写通**（收集/移出/掌握 → 站内），不拉取合并 | 「接入」的最小闭环：产物点词 → 站内「我的生词本」可见可复习。status 映射：掌握 ↔ 站内 status 2（已掌握），取消 ↔ 0（新学） |
| S6 | 封面 C 用法 = 播放器书封垫**无字版 base_C**（HTML 文字浮其上）+ 站内卡片用 base_C 合成的 4:3 无字封面 | 站内语言卡封面规范 = 4:3 横版无字；启动页保留动态题字（label/标题/标语）。带字 cover_C 留作宣传物料。回滚=移除 cover.image 字段 |
| S7 | 剧本库入口 = **客户端合成官方卡**（lang-play.js 注入，en 语种置顶），不进 PB `lang_cards` | P&P 是预写分支故事，与 lang_cards「AI 每轮填空」范式不兼容（进入方式完全不同）。卡带 `storeProduct:"pp6"` 标记走特判 |
| S8 | 支付方式 = 微信（移动端 H5 收银台跳转 / 桌面扫码） | 站内当前唯一可用渠道（支付宝未开通，选择支付宝会提示联系小红书官号） |
| S9 | 购买门含「18 周岁确认」勾选 | 与站内充值面板同一合规要求（adult-confirm） |
| S10 | 上架版标题 = 「傲慢与偏见（六级版）」；`--store` 构建不改桌面网盘版文件名与内容形态 | 对齐「不用标注完整版」；桌面版 ¥9.9 渠道物料保持原样（仅随新引擎更新封面与生词本 hook） |

## 5. 技术设计

### 5.1 Worker（my-bitlife-game/worker.js）

```
STORY_PLANS = { pp6: { id:"pp6", name:"傲慢与偏见（六级版）", price:"5", story:"pp6" } }

POST /api/pay/create      → 验证放行 STORY_PLANS；createPayOrder 查表含 STORY_PLANS
settlePaidOrder           → 新分支：storyPlan → 幂等写 unlocks{user_id, card_id:"store_pp6"} → 订单置 paid
GET  /api/story/access?product=pp6
   → 鉴权；product 无效 404；isMember → {ok:true, via:"member"}
   → 有 unlocks 记录 → {ok:true, via:"purchased"}
   → 否则 {ok:false, price:"5", name, need:"purchase"}
```

### 5.2 引擎（YunTunTunStoryGame/templates/game_player/）

- `base.html`：`.book-cover__face` 内新增 `<div class="book-cover__art" id="coverArt"></div>`（内容层之前）
- `styles.css`：`.book-cover__art`（absolute inset:0, background cover center）+ `.has-art` 时隐藏 `__parchment` + 内容层加安全内边距（藤蔓边框内沿避让）
- `js/state-model.js`：el.coverArt 引用
- `js/story-loader.js`：`cover.image` 存在 → 设背景图 + face 加 `has-art`
- `js/lang-learn.js`：`langVocabAdd/Remove/ToggleMastered` 三处尾部调 `langStoreSync(...)`；`langStoreSync` 实现站内写通（启用条件：hostname 以 blupure.cn 结尾 且 localStorage 有 pb_auth_token；词典释义取自 `langData().cards[word]`；term→serverId 映射存 `{storageKey}_lang_vocab_ids`）

### 5.3 产物（YunTunTunStoryGame/output/pp/pipeline/p7_assemble.py）

- 新增 `--store`：等价 `--full` 但 ① title/book 去「· 完整版」② 注入付费门 boot 片段 ③ 输出 `傲慢与偏见_六级版_上架版.html`
- 所有构建（Ⅰ/Ⅱ/Ⅲ部、完整版、试读）统一注入 `data["cover"]["image"] = base_C→webp→dataURI`（覆盖 C 立即可见）
- 付费门 boot（注入在 `<body>` 后第一段，纯 vanilla JS，自带内联样式）：
  - 立即渲染全屏遮罩（fail-closed）→ 读同源 `pb_auth_token` → `GET /api/story/access?product=pp6`
  - ok → 移除遮罩；401 → 「登录后畅玩」+ 主站登录入口；need purchase → ¥5 购买面板（18 岁勾选 + 微信支付）
  - 支付：`POST /api/pay/create {planId:"pp6",payType:"wxpay"}` → 移动端跳 jumpUrl / 桌面显二维码 → pending 存 localStorage → 返回/轮询 `/api/pay/status` → paid → 重新鉴权 → 放行
  - API 基址：hostname 以 blupure.cn 结尾 → `location.origin`（nginx /api 代理已实测），否则 `https://ai.blupure.cn`

### 5.4 主站（my-bitlife-game）

- `assets/lang-play.js`：`STORE_PRODUCT` 定义（仿 lang_cards 卡形 + `storeProduct:"pp6"`）；renderLibrary 在 en 语种下置顶注入；`langGridCardHtml` 特判（徽标「¥5 · 会员免费」/「官方出品」）；`openLangDetail` 特判（简介+定价+按钮）；`enterCard` 特判（→ 权限检查 → 放行跳 `/story/pp6/` 或弹出购买）；购买弹层 `#store-pay-modal`（动态建 DOM，复用既有 modal 样式类）
- `scenarios/covers/store_pp6.webp`：base_C 4:3 合成（模糊底+居中原图），~800×600 webp
- bump：`lang-play.js` 的 `?v=`（只动这一个文件的版本号）

### 5.5 部署

1. worker：`npx wrangler deploy`（记录版本号）
2. 产物：scp 上架版 → `/var/www/story/pp6/index.html`
3. nginx：`bitlife.conf` 备份 → 加 `location /story/ { alias /var/www/story/; }`（无 proxy_pass，零 DNS 风险）→ `nginx -t` → reload
4. 主站：commit → push origin main:main → 服务器 git pull（三方核对 hash）
5. 桌面同步：4 产物覆盖 `E:\Desktop\副业\傲慢与偏见(六级版三部曲)\`

## 6. 验收清单（小徐晨间）

- [ ] 主站 → 学习中心 → 英语剧本库：首张卡 = 傲慢与偏见（六级版），封面 C，徽标「官方出品 · ¥5 · 会员免费」
- [ ] 点卡片 → 详情弹层（封面/简介/定价/按钮）
- [ ] 未登录 → 引导登录；登录非会员未购 → 购买弹层（¥5 微信）
- [ ] 会员 → 直接进入 `/story/pp6/`；已购非会员 → 直接进入
- [ ] 未授权直接在浏览器开 `/story/pp6/` → 全屏购买门
- [ ] 产物内：点词「加入生词本」→ 站内「我的生词本」（英语）出现该词
- [ ] 产物启动页书封 = 玫瑰藤蔓边框 + 题字；iPhone 上三处移动端修复仍然生效
- [ ] 真实支付 ¥5 链路（小徐本人小额实测——我未代付）

## 7. 验证（我已执行，不代替小徐验收）

- 代码断言探针：worker 接线/产物门注入/引擎 hook/主站卡片（字符串机器断言）
- 线上 curl：`/story/pp6/` 200、`/api/story/access` 无 token 401、`/api/pay/create` 非法档 400
- 临时测试用户 E2E：PB 建临时用户 → access=false → PB 写 `store_pp6` unlock → access=true → 清理（用户+记录双删）
- 生词本 API：临时用户 POST 一词 → 站内可见 → DELETE 清理
- 回滚路径：worker `wrangler rollback` / nginx conf 还原 + reload / 主站 `git revert` / 产物目录删除

## 8. 已知边界

- 产物文件本身对知道 URL 者可下载（付费墙在页内，非传输层加密）；¥5 商品按站内既有防转发哲学（网盘版同样"不做防转发"）处理
- 已购用户若退出登录 → 门显示登录状态（token 在 localStorage）
- 站内「我的剧本」列表不含此商品（未做，未来可加）

---
**Version**: 1.0 · **Created**: 2026-10-04（北京时间凌晨） · **Clarification rounds**: 0（自主模式：沿用睡前指令 + 产品 PRD 既有决策，假设全部记录于 §4） · **Quality score**: 92/100（自主推进）
