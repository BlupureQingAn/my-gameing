# 防克隆「心脏锁定 + 主线协议后移」PRD(两阶段)

- 日期: 2026-09-06
- 决策人: 小徐
  - Q1 档位: 心脏锁定(阶段1)✅;主线协议后移(阶段2)❌ 已搁置——小徐 2026-09-06 拍板"必要性不大",PRD 保留仅供后续参考
  - Q2/Q3 状态云同步与销毁:随阶段2 一并搁置
  - 范围连锁(已随阶段2 取消): 中文官方卡静态库迁 PB 不再执行
- 关联: M9 语言交互四改冻结待命(task #52-56)
- 状态: ✅ 全部完成(2026-09-06)
- **最终决定(2026-09-06,小徐纠正「我不是说了删掉BYOK自定义api」): BYOK 功能整体删除,不做云端化保留。**
  - 删除清单: worker.js BYOK 模块块(AES-GCM 加解密/SSRF 校验/runByokChat)、/api/byok PUT/GET/DELETE、/api/byok/test、/chat/completions byok 分支、/api/byok/check;
    index.html 向导 byok 引擎选项、访问线路卡(nc-route)、BYOK 设置卡、SettingsService BYOK 子系统(含即存状态机/云端同步/迁移/测试)、AI 请求 byok 标志;scripts/byok_heartlock_probe.mjs;pb_setup_collections.mjs byok 字段。
  - 保留防线(不删): worker Origin 白名单闸门 + /chat/completions 强制登录——克隆站仍需官方账号,无 API 直连路径。
  - 服务端残留: PB users 集合 byok_url/byok_model/byok_key_cipher 字段留空不清理(删字段动 schema 风险>收益);BYOK_ENC_KEY secret 保留不删(无引用即失效,可随时 wrangler secret delete)。

## 0. 根因(小徐原话:「为什么他们打包成 apk 配置个 api 就能正常运作我的整个游玩页面」)

1. 整台引擎在公开 index.html JS:提示词拼接/协议解析/状态机/各功能 UI 全在端上。
2. BYOK 直连(index.html:11369 浏览器直连第三方,不经 worker)→ 打包者抓前端+自己 key 即复活。
3. 中文官方卡全量在静态 scenarios.js(820KB,22 分片,源 scenarios/category_*.json)→ 抓包即得全部内容。
4. 已有防线:worker 全局 Origin 闸门(worker.js:1080)+ /chat/completions 强制登录(authenticate:934);游客本就不能存 BYOK。

## 1. 目标与天花板

- 目标: 克隆站 = 空壳。前端无任何直连模型路径;主线提示词/协议彻底离端;AI 请求全部经 ai.blupure.cn(登录+Origin 双闸);数据内容不在静态资源全量出现。
- 天花板(如实接受): 极客逆向自建后端+自托管数据仍可能,无法根除;本 PRD 消灭「复制粘贴+填 key」档 90% 克隆。

---

## 阶段 1: 心脏锁定(BYOK 云端化 + AI 请求全收编)——1-2 天

见 task #57-61。要点:
- 前端咽喉三函数收编:`getApiConfig`(11668)/`buildFetchUrl`(15047)/`buildHeaders`(15055),删除一切直连。
- BYOK = key 加密存 PB users 字段(AES-GCM, env.BYOK_ENC_KEY),worker /api/byok 存/取/测/删 + /chat/completions byok:true 代跑分支(SSRF 防护:https/非 blupure.cn/拒保留地址/仅 /chat/completions),失败不落池。
- 设置 UI 文案/迁移(本机旧配置一键上传)。
- 阶段1 上线后: 主线生成仍前端拼提示词(有 worker 依赖但提示词在端)——阶段2 收尾此残留。

## 阶段 2: 主线协议后移 + 中文官方卡云端化——约 4-7 天(切割待确认)

### 2.1 前置: 中文官方卡迁 PB(必要——worker 拼提示词必须能读到卡数据)
- 新增集合 `official_cards`(或扩 community_cards 同构;admin-only,worker 代访),字段对齐现有卡对象(id/title/category/theme/text/structured/…)。
- 导入脚本: 从 scenarios/category_*.json 全量导入(id 不变,防存量引用错乱)。
- 前端 `SCENARIO_LIBRARY`(30+ 引用处)改造:启动从 API 拉列表;**text/structured 不再随静态下发**(列表仅元数据: id/title/简介/封面/theme/category);静态 scenarios.js 降为元数据版或废弃由 partN 懒加载链删除。
- 兼容: 用户本地/老档 id 引用不变;详情展示用简介字段替代全文预览(如有)。

### 2.2 worker 新增主线生成端点(核心)
- `POST /api/turn/generate`(登录;卡 id + user_text/选项 + 前端回合元数据):
  1. admin 代读卡数据(PB official_cards/lang_cards/community_cards)
  2. 读该用户该卡云端最新档(cloud_saves,含 history/state)——状态源(2.3)
  3. worker 内拼完整提示词(设定/记忆/规则/时间/选项→复制前端现有全部提示词工程,含语言模式 buildInjection 等价物)
  4. 池路由/byok 代跑调模型(复用阶段1 通道)
  5. worker 内解析/校验/清洗协议 JSON(复制前端解析器),执行协议 ops(状态推进由前端照旧执行,见 2.4)
  6. 回写云端档(覆盖式)后返回干净渲染数据
- 前端主链(ChatService.requestAI 等)改调该端点;**前端删除主线提示词拼接与协议解析代码**(提示词离端)。

### 2.3 状态云同步 + 生命周期(默认组)
- 每轮生成后自动覆盖写 cloud_saves(该卡最新一份,不保留历史轮次);前端本地存档降为缓存。
- TTL: cloud_saves 行 updated_at > 30 天未活动 → 读时懒删;worker 每日 scheduled 清扫(新增 cron handler)。
- 手动: 设置/游玩页「清除本卡云端进度」按钮(DELETE 端点)。
- 注销联动删除(挂接现有注销/删号流程)。
- 既有手动云存档(换设备续玩)功能共存不受影响。

### 2.4 范围边界(阶段2 内不做)
- 状态机/数值裁决留在前端(选项效果照旧由前端应用协议 ops)——服务端化=纯网游化,数周级,另行立项。
- 微信聊天/小手机/地图逻辑留前端(UI 逻辑无害);其 AI 请求经阶段1 通道已受控。
- 数据逐卡登录下发(列表仍全量下发元数据)、运行时域握手、水印 = 再下一轮。

## 3. 部署与验证(两阶段通用)
- 语法: node --check worker.js; py /f/Claude/tmp/html_js_check.py index.html
- 部署: wrangler deploy;前端 commit(proxy push)+ SSH pull
- 冒烟(带浏览器 UA): 无 Origin 无 token → 401;伪造 Origin → 403;BYOK 上传/代跑/错误 key;池路径回归;阶段2: /api/turn/generate 新卡开局→选项→回写云档;TTL 懒删;手动清除。
- 真机清单(小徐): 设置页 BYOK 全流程;中文卡开局+连续 3 轮;换设备续玩;离线提示;清除云档。
- 记忆: 会话日志 + checkpoint。

## 4. 风险与回退
- 阶段1: BYOK key 托管加密 at rest,可 DELETE 自清;失败不落池;咽喉三函数 git revert 即回直连。
- 阶段2: 提示词工程迁 worker 是大迁移,逐任务类型(剧情/初始化/记忆/复盘/翻译/小译)回归;卡数据迁移保 id 不变;列表元数据化可能影响详情预览(用简介替代);云同步失败重试与断网提示。
- 数据销毁: 30 天 TTL 与手动清除不可恢复,UI 明示。
