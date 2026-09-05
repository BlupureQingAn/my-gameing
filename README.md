# my-bitlife-game

云吞吞 AI 文游（线上：bitlife.blupure.cn）——互动叙事人生游戏 + AI 语言学习：英语原生剧本五档难度（高中/CET4/CET6/考研/TOEFL），点句即译、生词标色、章末复盘、测档定级。

- 功能与决策文档：`docs/prds/`（语言文游 v2 站点 PRD、五档词库 PRD、卡设计提案、防克隆 PRD 等）
- 英语卡成稿（editor 协议 JSON）：`docs/english-cards/card-0X.card.json`
- 部署与全量轮次记录：`docs/部署清单-20260826.md`
- 前端单文件应用：`index.html`；后端：`worker.js`（Cloudflare Workers，ai.blupure.cn）+ PocketBase（db.blupure.cn）
