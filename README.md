# my-bitlife-game

云吞吞 AI 文游（线上：bitlife.blupure.cn）——互动叙事人生游戏 + AI 语言学习：英语原生剧本五档难度（高中/CET4/CET6/考研/TOEFL），点句即译、生词标色、章末复盘、测档定级。

- 功能与决策文档：`docs/prds/`（语言文游 v2 站点 PRD、五档词库 PRD、卡设计提案、防克隆 PRD 等）
- 英语卡成稿（editor 协议 JSON）：`docs/english-cards/card-0X.card.json`
- 部署与全量轮次记录：`docs/部署清单-20260826.md`
- 前端单文件应用：`index.html`；后端：`worker.js`（Cloudflare Workers，ai.blupure.cn）+ PocketBase（db.blupure.cn）

## 构建与部署（2026-10-20 起）

**index.html 引用的是压缩产物（`assets/*.min.js|css`），不是源文件。**

改了 `assets/app.js` / `app.css` / `lang-*.js` / `love-engine.js` 之后，必须：

```bash
node scripts/minify.mjs        # esbuild 压缩，产物为同名 .min.*
```

然后按惯例 bump `index.html` 里的 `?v=` 版本号，再 `git commit && push`，
服务器 `ssh root@47.238.246.167 "cd /var/www/bitlife && git pull"`。
**漏跑 minify = 改动静默不上线**（页面引用的是旧 .min 文件）。

压缩率参考：app.js -43% / app.css -45% / lang-aux -57% / lang-play -45% / love-engine -47%。

esbuild 平台二进制（`@esbuild/win32-x64`）装在 WorkBuddy node workspace 里，
报 "The package @esbuild/win32-x64 could not be found" 就是它没了。

