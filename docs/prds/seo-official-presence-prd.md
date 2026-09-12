# PRD：官网化搜索存在感（百度 / Bing / Google）

- 日期：2026-09-13
- 状态：执行中（小徐已选定范围：百度 + Bing/Google；搜索结果层面优先；只做全自动动作）

## 背景与问题（2026-09-13 实测）

- Bing 搜「云吞吞文游」：本站在列，但展示 URL 是 `www.blupure.cn`（非 bitlife 主域），标题/描述均无"官网"字样；同页混有大量第三方「云吞吞文游模拟器 / 安卓版下载」山寨页（gamelongs.com、tvmao.com、dnkb.com.cn、niucoo.cn、syzs.qq.com 等），部分自称"官方版"——普通用户难以分辨谁是真官网。
- 首页缺 `<link rel="canonical">`、缺 og:image；JSON-LD 只有 WebSite/VideoGame，无 Organization（无 logo / 无 publisher 关联）。
- 百度：baiduspider 历史仅 15 次抓取（对比 googlebot 11951 / bingbot 107），收录弱；三家站长验证文件均在线上。
- 必应图标：站点侧已修（c587764）且复验健康，属 Bing 图标缓存等待期（详见部署清单"七轮"）。

## 范围（小徐已确认）

- 平台：百度（已认证）+ Bing/Google（品牌展示层）。
- 标准：搜索结果层面——标题/图标/描述呈现为官方站。
- 执行：仅全自动动作（站内代码 + 公开 API 推送）；站长工具后台人工操作暂不做。

## 方案（全部自动）

1. 首页 head：title 改「云吞吞文游官网 - …」；description 改「官方网站…无需下载任何 App，认准 bitlife.blupure.cn」；补 canonical→bitlife；补 og:image（`/lang/banner-entry.jpg` 1600×560）；keywords 加官网词。
2. JSON-LD：新增 `Organization`（name/url/logo/description，@id=#org）；WebSite/VideoGame 挂 `publisher`；WebSite.alternateName 增「云吞吞文游官网」（Google 站点名信号）。
3. learn.html 同步官网化：title/description/og:title/og:description/og:image 与首页统一口径。
4. sitemap.xml：两 URL lastmod 刷新至 2026-09-13。
5. 部署后推送：IndexNow 推首页 + learn.html（Bing/Yandex）；百度普通收录 API 推同两 URL（内容已更新，配额约 10/天，仅此一次）。
6. 域名收敛：www/apex 已 301→bitlife；canonical 补齐后等待 Bing 把结果 URL 从 www.blupure.cn 收敛到 bitlife.blupure.cn。

## 验收

- 线上 curl：title / canonical / og:image / Organization JSON-LD 全部命中新值。
- 两个推送接口返回成功。
- 不能自动验收（需时间观察）：Bing 图标/URL 收敛、百度收录生效；山寨页处置需平台举报（要登录，后续人工）。

## 不做（本轮排除）

- 百度「官网认证」（需企业资质 + 付费，个人站不可行）。
- 站长工具后台操作（小徐暂不做）。
- 站内防伪层（页脚"唯一官网"声明 / 官方账号互链）——小徐选"搜索结果层面优先"，留作后续。
- 山寨下载站举报 / 下架。
