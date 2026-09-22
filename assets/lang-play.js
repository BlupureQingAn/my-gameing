
/* ===== 语言文游 LangPlay · 大厅 M1-M3:语种/手选档/沉浸模式(M8.5 起档位纯手动,测定流程已删) + 档案云端同步(M2) + 语言剧本库入口(M3,经 window.LangEngine 旁挂 play 引擎) ===== */
(function () {
    var PROFILE_KEY = "lang_profile_v1";
    var BAND_ORDER = ["hs", "cet4", "cet6", "ky", "toefl"];
    var BAND_INFO = {
        hs: ["HS", "高中水平", "band-hs", "对应高中新课标 3500 词（词库 3395 词）——校园、日常生活题材的卡从这档打底"],
        cet4: ["CET4", "四级水平", "band-cet4", "对应大学英语四级大纲（词库 4536 词）——校园日常、生活话题的卡正合适"],
        cet6: ["CET6", "六级水平", "band-cet6", "对应六级词汇大纲（词库 5713 词，含四级词汇）——都市生活、情感向的卡可挑战"],
        ky: ["考研", "考研水平", "band-ky", "对应考研英语大纲 5530（词库 6277 词，含六级及以下）——思辨、叙事厚重的卡挂这档"],
        toefl: ["TOEFL", "托福水平", "band-toefl", "对应托福词汇（词库 8128 词，含考研及以下）——科研、异域题材的高难卡在此"],
        /* 日语 JLPT N5-N1 / 韩语 TOPIK 初中高（2026-09-19 多语种化；css 类复用英语五档，不新增样式） */
        "ja-n5": ["N5", "N5 入门", "band-hs", "JLPT N5 词表 —— 假名与最基础汉字，寒暄、购物、问路等日常场景"],
        "ja-n4": ["N4", "N4 初级", "band-cet4", "JLPT N4 词表 —— 基础日常会话，校园与家庭题材"],
        "ja-n3": ["N3", "N3 中级", "band-cet6", "JLPT N3 词表 —— 日常与职场过渡，可读简短文章"],
        "ja-n2": ["N2", "N2 中高级", "band-ky", "JLPT N2 词表 —— 接近报刊语体，评论与小说可读"],
        "ja-n1": ["N1", "N1 高级", "band-toefl", "JLPT N1 词表 —— 抽象议题与文学性表达"],
        "ko-1": ["初", "初级水平", "band-cet4", "TOPIK 初级词表 —— 基础词汇与短句，问候、点餐、购物"],
        "ko-2": ["中", "中级水平", "band-cet6", "TOPIK 中级词表 —— 日常会话流畅，校园 / 公司 / 约会题材"],
        "ko-3": ["高", "高级水平", "band-ky", "TOPIK 高级词表 —— 抽象议题、新闻语体与惯用语"]
    };
    /* 档位顺序按语种分组（英语五档 / 日语 N5-N1 / 韩语初中高三级）；BAND_INFO/BAND_NAMES 用平表，
       新档位键唯一不冲突，故只把"顺序"和"默认档"按语种分开 */
    var BAND_ORDER_BY_LANG = {
        en: BAND_ORDER,
        ja: ["ja-n5", "ja-n4", "ja-n3", "ja-n2", "ja-n1"],
        ko: ["ko-1", "ko-2", "ko-3"]
    };
    var BAND_DEF_BY_LANG = { en: "cet6", ja: "ja-n3", ko: "ko-2" };
    function bandOrderOf(lang) { return BAND_ORDER_BY_LANG[lang] || BAND_ORDER; }
    function bandDefOf(lang) { return BAND_DEF_BY_LANG[lang] || "cet6"; }
    function curLang() { return LANG_TAG_INFO[String(profile.lang || "en")] ? String(profile.lang || "en") : "en"; }
    window.LangBandMeta = { orderOf: bandOrderOf, defOf: bandDefOf, curLang: curLang, info: BAND_INFO };
    /* 学习工具(榜单/统计)取哪个语种:在语言会话里随会话,不在会话里随语言页所选语种。
       白名单兜底不能省——targetLang() 对没打 lang 标签的卡可能给出非 en/ja/ko 的值,
       直接拿去索引 LANG_TAG_INFO 会取到 undefined,下游 [1]/[0] 就抛 */
    function curLearnLang() {
        var l = "";
        try {
            if (window.LangEngine && window.LangEngine.isLangSession && window.LangEngine.isLangSession()
                && window.LangEngine.targetLang) l = window.LangEngine.targetLang();
        } catch (e) { }
        if (!LANG_TAG_INFO[l]) l = curLang();
        return LANG_TAG_INFO[l] ? l : "en";
    }
    var profile = { lang: "en" };
    try { var _p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); if (_p && typeof _p === "object") profile = _p; } catch (e) { }
    /* 档位按语种各记一份(2026-09-22):profile.band 是单字段,切到日语会被日语档覆盖,切回英语就得重调。
       bands 记住每个语种最后选的那档,切语种时先存回旧语种、再取新语种那份。
       云端档案只有一个 band 字段(worker/PB 侧有值域校验),所以只有当前语种的档位跨设备同步,其余只在本机记住 */
    function rememberBand(lang, band) {
        if (!lang || !band) return;
        if (!profile.bands || typeof profile.bands !== "object") profile.bands = {};
        if (bandOrderOf(lang).indexOf(band) >= 0) profile.bands[lang] = band;
    }
    function bandForLang(lang) {
        var b = profile.bands && profile.bands[lang];
        return bandOrderOf(lang).indexOf(b) >= 0 ? b : "";
    }
    /* M6b:在线英语专属卡(lang_cards 官方库)缓存,供列表渲染/选中卡 overlay/播放进入用 */
    window.LANG_CARDS_ONLINE = window.LANG_CARDS_ONLINE || [];
    window.__LANG_CARDS_READY = window.__LANG_CARDS_READY || false;
    window.__LANG_CARDS_LOADING = window.__LANG_CARDS_LOADING || false;
    /* M6d2 旧值迁移:本地 a/b/c → a→cet4/b→cet6/c→ky(云端读侧由 worker 迁移) */
    (function () {
        var legacy = { a: "cet4", b: "cet6", c: "ky" };
        if (profile.band && legacy[profile.band]) profile.band = legacy[profile.band];
        // 别在这里补记 bands:本行上面的 IIFE 跑在 LANG_TAG_INFO 定义之前,curLang() 会取到 undefined 并掀翻整个初始化;
        // 老档案(只有单 band)的兜底交给 selectLang——切走前会先 rememberBand(旧语种, 当前档)
        save();
    })();
    function $(id) { return document.getElementById(id); }
    function save() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) { } }
    function hint(t, boxId) { var h = $(boxId || "lang-hint"); if (h) h.textContent = t || ""; }
    /* M6a:剧本库筛选状态与语言页渲染(库=英语原生卡;首页=推荐行+继续行) */
    var libFilter = { cat: "", gender: "" };
    var THEME_ICON = { cottage: "🏡", "retro-paper": "🥛", glass: "🚇", fantasy: "🏰", "sci-fi-hud": "🌊", liquid: "💧", gothic: "🕯️", ink: "🖋️", cyber: "🌆", minimal: "▦" };
    /* R1 恋爱攻略卡:love 标签/向别偏好(存 localStorage lang_gender_pref_v1,O2 服务端零改动);loveMatch 供推荐排序 */
    function loveTagOf(c) {
        var st = (c && c.structured) || {};
        if (st.love_mode !== true) return "";
        return "💗 恋爱" + (st.gender_target === "male" ? " · 男向" : st.gender_target === "female" ? " · 女向" : "");
    }
    function genderPref() { try { return localStorage.getItem("lang_gender_pref_v1") || ""; } catch (e) { return ""; } }
    function saveGenderPref(g) { try { if (g) localStorage.setItem("lang_gender_pref_v1", g); else localStorage.removeItem("lang_gender_pref_v1"); } catch (e) {} }
    function loveMatch(c, pref) {
        var s = (c && c.structured) || {};
        return !!pref && s.love_mode === true && String(s.gender_target || "") === String(pref);
    }
    function loveFilterOk(c, g) {
        var st = (c && c.structured) || {};
        var lm = st.love_mode === true, gt = String(st.gender_target || "");
        if (g === "love-f") return lm && gt === "female";
        if (g === "love-m") return lm && gt === "male";
        if (g === "plain") return !lm;
        return true;
    }
    function bandShort(k) { return (BAND_INFO[k] && BAND_INFO[k][0]) ? BAND_INFO[k][0] : String(k || "").toUpperCase(); }
    /* 语言Tag(2026-09-13):卡的语言决定生成语种;难度Tag 已从卡面下线,词汇难度改由用户学习档动态决定 */
    var LANG_TAG_INFO = { en: ["EN", "英语"], ja: ["JA", "日语"], ko: ["KO", "韩语"] };
    function langKeyOf(c) {
        var k = String((c && (c.lang || (c.structured && c.structured.lang))) || "en").trim().toLowerCase();
        return LANG_TAG_INFO[k] ? k : "en";
    }
    function langNameOf(c) { return LANG_TAG_INFO[langKeyOf(c)][1]; }
    function langBadgeOf(c) { return '<span class="scenario-badge lang">' + langNameOf(c) + "</span>"; }
    function bandCls(k) { return (BAND_INFO[k] && BAND_INFO[k][2]) ? BAND_INFO[k][2] : ""; }
    function cardCid(c) { return String(c.id || "").replace(/"/g, "&quot;"); }
    function cardSaveOf(c) {
        try { return !!(window.LangEngine && window.LangEngine.hasLangSave && window.LangEngine.hasLangSave(c.id)); } catch (e) { return false; }
    }
    function cardRoundOf(c) {
        try {
            var eng = window.LangEngine;
            if (!eng || !eng.langSaveKey) return 0;
            var raw = localStorage.getItem(eng.langSaveKey(c.id));
            var s = raw ? JSON.parse(raw) : null;
            if (!s || !Array.isArray(s.history)) return 0;
            var n = 0, i;
            for (i = 0; i < s.history.length; i++) if (s.history[i] && s.history[i].role === "user") n++;
            return n;
        } catch (e) { return 0; }
    }
    function viewVisible(vid) { var el = $(vid); return !!(el && el.classList && el.classList.contains("active")); }
    function bindCardClicks(root) {
        if (!root) return;
        var els = root.querySelectorAll("[data-cid]"), i;
        for (i = 0; i < els.length; i++) {
            els[i].addEventListener("click", (function (cid) { return function () { api.enterCard(cid); }; })(els[i].getAttribute("data-cid")));
        }
    }
    /* M8b:语言首页推荐区 = 文游首页同款 hb-card 大图轮播(4:3 封面 + 档/题材 tag + 轮次 + 播放按钮);点击卡任意处进入播放 */
    var langBanner = { idx: 0, timer: null };
    var lbSpan = "day", lbBoard = "time", lbCache = {}, lbReq = 0;
    /* 今日一句当前展示的语种与原文:点译请求要用它当 lang(不在会话里,curSessionLang 只会给 en),
       写缓存也要带上,免得切语种后沿用上一语种那句的译文(2026-09-21) */
    var todayShownLang = "en", todayShownText = "";
    // 排行榜:当前 span/榜别(time 时长|immersive 无阻畅读)/结果缓存(键=board|lang|span,30s)/请求序号(过期响应靠它作废)
    function langBannerHtml(c) {
        var icon = THEME_ICON[String(c.theme || "")] || "📖";
        var has = cardSaveOf(c), r = cardRoundOf(c);
        var loveTag = loveTagOf(c);
        var tagTxt = (loveTag ? '<span class="hb-love">' + loveTag + "</span> " : "") + '<span class="hb-lang">' + langNameOf(c) + "</span>" + (String(c.category_zh || "") ? " · " + api.esc(String(c.category_zh)) : "");
        var playTxt = has ? "▶ 继续 · 第 " + (r || 1) + " 轮" : "立即游玩";
        return '<div data-cid="' + cardCid(c) + '" class="hb-card">' +
            '<div class="hb-cover" id="lb-cover-' + window.CoverService.safeId(c.id) + '"><img class="scc-img" alt="' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + ' 封面" loading="lazy"><span class="scc-emoji">' + icon + "</span></div>" +
            '<div class="hb-tag">' + tagTxt + "</div>" +
            '<div class="hb-title">' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + "</div>" +
            '<div class="hb-sub">' + api.esc(String(c.title || "")) + (has ? " · " + api.langName() + "进度已到第 " + (r || 1) + " 轮" : "") + "</div>" +
            '<div class="hb-foot"><span class="hb-plays">' + LANG_TAG_INFO[langKeyOf(c)][0] + ' 原生 · 词库随你的学习档</span>' +
            '<span class="hb-play-btn mini-btn primary">' + playTxt + "</span></div></div>";
    }
    /* M8c:剧本库网格卡(文游首页同款 scenario-card:4:3 封面 + 徽标 + 详情/播放按钮);卡主体点击=播放,详情按钮单独弹层 */
    function langGridCardHtml(c) {
        var icon = THEME_ICON[String(c.theme || "")] || "📖";
        var has = cardSaveOf(c), r = cardRoundOf(c);
        var themeKey = String(c.theme || "").replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
        var playTxt = has ? "▶ 继续 · 第 " + (r || 1) + " 轮" : "立即游玩";
        return '<div data-cid="' + cardCid(c) + '" class="scenario-card"><div class="scenario-card-main">' +
            '<div class="scenario-card-cover theme-' + themeKey + '" id="llc-cover-' + window.CoverService.safeId(c.id) + '">' +
            '<img class="scc-img" alt="' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + ' 封面" loading="lazy"><span class="scc-emoji">' + icon + "</span></div>" +
            '<div class="list-title">' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + "</div>" +
            '<div class="scenario-badges">' +
            (loveTagOf(c) ? '<span class="scenario-badge love">' + loveTagOf(c) + "</span>" : "") +
            langBadgeOf(c) +
            '<span class="scenario-badge">' + api.esc(String(c.category_zh || c.category || "")) + "</span>" +
            "</div>" +
            '<div class="list-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + api.esc(String(c.title || "")) + "</div>" +
            '<div class="scenario-card-btns">' +
            '<button class="tiny-btn" onclick="event.stopPropagation();LangController.openLangDetail(\'' + cardCid(c) + '\')">详情</button>' +
            '<button class="tiny-btn primary">' + playTxt + "</button>" +
            "</div></div></div>";
    }
    function contRowHtml(c) {
        var r = cardRoundOf(c);
        return '<div data-cid="' + cardCid(c) + '" class="l6-row"><div class="l6-row-band lang-' + langKeyOf(c) + '">' + LANG_TAG_INFO[langKeyOf(c)][0] + "</div>" +
            '<div class="l6-row-main"><div class="l6-row-t">' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + "</div>" +
            '<div class="l6-row-sub">' + api.esc(String(c.title || "")) + " · " + api.langName() + "进度已到第 " + (r || 1) + " 轮</div></div>" +
            '<span class="lang-badge ' + langKeyOf(c) + '" style="width:auto;height:auto;border-radius:8px;padding:2px 8px;font-size:.6rem;">继续</span><span class="l6-row-go">›</span></div>';
    }
    /* ---- 云端档案同步(M2):已登录用户手选档/沉浸模式存 PB lang_profiles,换设备不丢 ---- */
    var API_BASE = /blupure\.cn$/i.test(location.hostname) ? location.origin : "https://ai.blupure.cn";
    function token() { try { return localStorage.getItem("pb_auth_token") || ""; } catch (e) { return ""; } }
    function saveRemote() {
        if (!token()) return;
        fetch(API_BASE + "/api/lang/profile", {
            method: "PUT", headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ lang: profile.lang || "en", band: profile.band || "", immersion: profile.immersion || "" })
        }).catch(function () { });
    }
    var myStatsCache = null;   // P2:learn-stats 30s 缓存
    var api = {
        init: function () {
            if (!$("view-lang")) return;
            api.renderLangPicker();
            api.renderPicker();
            api.applyLangCopy(); /* 按已存语种改写语言区文案(首页入口横幅固定三语种,不受影响) */
            api.showBand();
            api.loadRemote();
            api.loadLangCards();
            api.renderHome();
        },
        refresh: function () {
            api.renderLangPicker();
            api.renderPicker();
            api.showBand();
            api.renderHome();
        },
        /* 切语种后重拉生词本/学习中心:词表按语种分开装,不重拉就一直显示旧语种的词(2026-09-21) */
        reloadVocabForLang: function () {
            try { if (window.LangAssist && window.LangAssist.reloadVocab) window.LangAssist.reloadVocab(); } catch (e) {}
        },
        /* Bug3(2026-09-13):登录/登出/会话校验变化后重绘语言侧统计。
           语言页统计在脚本解析期就渲染过一次(早于 AuthService.init),不重绘会一直停留在"登录后查看" */
        onAuthChanged: function () {
            myStatsCache = null;
            try { api.renderMyStats(); } catch (e) {}
            try { api.renderLearnStats(true); } catch (e) {}
            api.refreshVocab();   // 重新登录后生词本要重拉:失败态的解药就在这里
        },
        /* M6a/M8d:语言页组视图进入钩子(switchView 调用);生词本独立子页进入即加载词表 */
        onShow: function (viewId) {
            api.syncSubNav(viewId);
            if (viewId === "view-lang") { api.applyLangCopy(); api.renderHome(); return; }
            if (viewId === "view-lang-learn") { api.refresh(); api.renderLearnMeta(); api.renderToday(); api.renderLearnStats(false); return; }
            if (viewId === "view-lang-vocab") { api.renderLearnMeta(); api.refreshVocab(); return; }
            if (viewId === "view-lang-leaderboard") { api.renderLeaderboard(); }
        },
        /* M8d:进入生词本子页并立即重绘词表(直接调绕开 1.5s MutationObserver 节流) */
        refreshVocab: function () {
            try { if (window.LangAssist && window.LangAssist.refreshVocab) window.LangAssist.refreshVocab(); } catch (e) {}
        },
        syncSubNav: function (viewId) {
            document.querySelectorAll(".lang-sub-nav .top-nav-btn").forEach(function (btn) {
                btn.classList.toggle("active", btn.dataset.view === viewId);
            });
        },
        loadRemote: function () {
            if (!token()) return;
            fetch(API_BASE + "/api/lang/profile", { headers: { "X-Auth-Token": "Bearer " + token() } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (!d) return;
                    var p = d.profile;
                    // 语种随云档回来(换设备/清缓存后仍停在你的语种);语种变了要重拉该语种卡库
                    if (p && p.lang && LANG_TAG_INFO[p.lang] && p.lang !== curLang()) {
                        rememberBand(curLang(), profile.band);   // 换语种前先把本机这份存回原语种名下
                        profile.lang = p.lang;
                        var od = bandOrderOf(p.lang);
                        if (od.indexOf(profile.band) < 0) profile.band = bandForLang(p.lang) || bandDefOf(p.lang);
                        window.__LANG_CARDS_READY = false;
                        window.__LANG_CARDS_LOADING = false;
                        window.LANG_CARDS_ONLINE = [];
                        save();
                        api.loadLangCards(p.lang);
                    }
                    if (p && p.band) {
                        if (p.immersion) profile.immersion = p.immersion;
                        // 云档 band 只在属于当前语种时才采纳(否则切语种后会被旧语种档位覆盖)
                        if (bandOrderOf(curLang()).indexOf(p.band) >= 0) { profile.band = p.band; rememberBand(curLang(), p.band); }
                        else if (bandOrderOf(curLang()).indexOf(profile.band) < 0) profile.band = bandForLang(curLang()) || bandDefOf(curLang());
                        save();
                    } else if (profile.band || profile.immersion) {
                        saveRemote();
                    }
                    api.refresh();
                }).catch(function () { });
        },
        renderPicker: function () {
            var box = $("lang-immersion-picker"); if (!box) return;
            var btns = box.querySelectorAll(".lang-lang-card");
            for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-m") === (profile.immersion || "progressive"));
        },
        /* 2026-09-19 三语切换:写档 → 档位若不属于新语种则回落到该语种默认档 → 丢弃旧语种卡库并重拉 → 全量重渲染 */
        selectLang: function (code) {
            if (!LANG_TAG_INFO[code]) return;
            if (code === curLang()) { api.renderLangPicker(); return; }
            rememberBand(curLang(), profile.band);          // 先把当前档存回旧语种名下
            profile.lang = code;
            profile.band = bandForLang(code) || bandDefOf(code);   // 新语种有记录就用记录,没有才落默认档
            save(); saveRemote();
            window.__LANG_CARDS_READY = false;
            window.__LANG_CARDS_LOADING = false;
            window.LANG_CARDS_ONLINE = [];
            api.renderLangPicker();
            api.showBand();
            api.loadLangCards(code);
            api.renderHome();
            api.refreshLeaderboardIfVisible();   // 榜单按语种取数,不跟着切会一直停在旧语种那批
            api.reloadVocabForLang(code);        // 生词本/学习中心同理:不重拉就一直显示旧语种的词
            api.renderLearnMeta();
            api.renderToday();                   // 今日一句换语种池
            // 统计也要重取:光靠 renderLearnStats 内部的缓存判定不够 —— 人已经停在学习中心页时没人再调它
            try { if ($("lang-learn-stats-box")) api.renderLearnStats(true); } catch (e) {}
            hint("已切换到" + LANG_TAG_INFO[code][1] + "——学习档与剧本库都换成" + LANG_TAG_INFO[code][1] + "的了。");
        },
        /* 语言首页三张语种卡:高亮当前语种(HTML 侧只写死英语卡 active,这里统一接管) */
        renderLangPicker: function () {
            var box = $("lang-picker"); if (!box) return;
            var btns = box.querySelectorAll(".lang-lang-card");
            for (var i = 0; i < btns.length; i++) {
                btns[i].classList.toggle("active", btns[i].getAttribute("data-lang") === curLang());
            }
        },
        /* M8.5:档位纯手动,系统不做任何测定/建议;M10(2026-09-13):chips 改滑动条——拖动预览、松手生效 */
        showBand: function () {
            var box = $("lang-band-result"); if (!box) return;
            box.style.display = "block";
            var lg = curLang(), order = bandOrderOf(lg), lname = LANG_TAG_INFO[lg][1];
            var has = order.indexOf(profile.band) >= 0;
            var idx = has ? order.indexOf(profile.band) : Math.min(order.indexOf(bandDefOf(lg)), order.length - 1);
            if (idx < 0) idx = 0;
            var b = has ? BAND_INFO[profile.band] : BAND_INFO[bandDefOf(lg)];
            var ticks = order.map(function (k) { return "<span>" + BAND_INFO[k][0] + "</span>"; }).join("");
            var emptyD = lg === "ja"
                ? "五档按 JLPT 递进：N5 从假名短句起步，N3 撑起日常剧情，N2/N1 适合报刊体与抽象议题——松手即生效，随时可换。"
                : (lg === "ko"
                    ? "三档按 TOPIK 递进：初级从基础短句起步，中级可读日常会话，高级适合新闻与抽象表达——松手即生效，随时可换。"
                    : "五档按难度递进：校园日常从 HS / CET4 起步，都市情感试试 CET6，思辨叙事往考研 / 托福挑——松手即生效，随时可换。");
            box.innerHTML = '<div class="lang-band-hero"><div class="lang-band-chip ' + (has ? (b[2] || "") : "") + '" id="lang-band-chip">' + (has ? b[0] : "?") + "</div>" +
                '<div style="flex:1;min-width:0;">' +
                '<div class="lang-band-t" id="lang-band-t">' + (has ? ("你的学习档：" + lname + " " + b[0] + " · " + b[1]) : "还没选学习档——拖动滑块挑一档") + "</div>" +
                '<div class="lang-band-d" id="lang-band-d">' + (has ? b[3] : emptyD) + "</div>" +
                '<input type="range" class="band-slider" id="lang-band-slider" min="0" max="' + (order.length - 1) + '" step="1" value="' + idx + '" aria-label="学习档" oninput="LangController.previewBand(this.value)" onchange="LangController.setBandByIndex(this.value)">' +
                '<div class="band-scale">' + ticks + "</div></div></div>";
            hint("");
        },
        /* 拖动过程只预览文案,不落库(避免拖一次写五遍) */
        previewBand: function (i) {
            var lg = curLang(), order = bandOrderOf(lg);
            var k = order[Number(i)]; if (!k) return;
            var b = BAND_INFO[k];
            var t = $("lang-band-t"), d = $("lang-band-d"), c = $("lang-band-chip");
            if (t) t.textContent = "学习档：" + LANG_TAG_INFO[lg][1] + " " + b[0] + " · " + b[1] + (k === profile.band ? "（当前）" : "");
            if (d) d.textContent = b[3];
            if (c) { c.className = "lang-band-chip " + (b[2] || ""); c.textContent = b[0]; }
        },
        setBandByIndex: function (i) {
            var k = bandOrderOf(curLang())[Number(i)]; if (!k) return;
            api.setBand(k);
        },
        setBand: function (k) {
            if (!BAND_INFO[k]) return;
            profile.band = k; rememberBand(curLang(), k); save(); saveRemote(); api.showBand();
            hint("学习档已改为 " + BAND_INFO[k][0] + "（" + BAND_INFO[k][1] + "）——接下来玩的卡与词库按此档来。");
        },
        setImmersion: function (m) { profile.immersion = m; save(); saveRemote(); api.renderPicker(); hint(""); },
        goCards: function () { api.goLibrary(); },
        /* M8b:语言首页推荐轮播控制(5s 自动 + dots 手动,点击 dot 后重新计时) */
        startLangBanner: function (n) {
            api.stopLangBanner();
            if (!n || n < 2) return;
            langBanner.timer = setInterval(function () {
                api.goLangBanner((langBanner.idx + 1) % n, true);
            }, 5000);
        },
        stopLangBanner: function () {
            if (langBanner.timer) { clearInterval(langBanner.timer); langBanner.timer = null; }
        },
        goLangBanner: function (i, silent) {
            var box = $("lang-home-reco");
            if (!box || !box.children.length) return;
            langBanner.idx = (i + box.children.length) % box.children.length;
            box.style.transform = "translateX(-" + (langBanner.idx * 100) + "%)";
            var dotsBox = $("lang-reco-dots");
            if (dotsBox) {
                var ds = dotsBox.querySelectorAll(".dot"), k;
                for (k = 0; k < ds.length; k++) ds[k].classList.toggle("active", k === langBanner.idx);
            }
            if (!silent) api.startLangBanner(box.children.length);
        },
        /* M10(2026-09-13):语言首页推荐轮播支持左右滑动(触摸/鼠标),与主站首页同款交互;
           水平拖动超 50px 切上一张/下一张,垂直拖动放行给页面滚动,滑动后 350ms 内拦截点击防误开卡 */
        bindLangBannerSwipe: function () {
            var box = $("lang-home-reco");
            if (!box || box.dataset.swipeBound) return;
            box.dataset.swipeBound = "1";
            var startX = 0, startY = 0, swiped = false, active = false;
            var begin = function (x, y) { startX = x; startY = y; swiped = false; active = true; };
            var move = function (x, y) {
                if (!active) return;
                var dx = x - startX, dy = y - startY;
                if (Math.abs(dy) > Math.abs(dx)) return;
                if (Math.abs(dx) > 50) {
                    swiped = true;
                    if (dx < 0) api.goLangBanner(langBanner.idx + 1); else api.goLangBanner(langBanner.idx - 1);
                    startX = x; startY = y;
                }
            };
            var end = function () {
                active = false;
                if (!swiped) return;
                var t0 = Date.now();
                var intercept = function (e) {
                    if (Date.now() - t0 < 350) e.stopPropagation();
                    box.removeEventListener("click", intercept, true);
                };
                box.addEventListener("click", intercept, true);
            };
            box.addEventListener("touchstart", function (e) { var t = e.touches && e.touches[0]; if (t) begin(t.clientX, t.clientY); }, { passive: true });
            box.addEventListener("touchmove", function (e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
            box.addEventListener("touchend", end, { passive: true });
            box.addEventListener("mousedown", function (e) { if (e.button !== 0) return; begin(e.clientX, e.clientY); e.preventDefault(); });
            box.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
            box.addEventListener("mouseup", end);
            box.addEventListener("mouseleave", function () { active = false; });
        },
        /* M10(2026-09-13):剧本库不再是独立页面——回语言首页并滚到剧本库区 */
        goLibrary: function () {
            switchView("view-lang");
            api.renderHome();
            api.renderLibrary();
            api.anchor("#lang-home-lib");
        },
        goLearn: function () {
            switchView("view-lang-learn");
            api.refresh();
        },
        goVocab: function () {
            switchView("view-lang-vocab");
            api.refreshVocab();
        },
        anchor: function (sel) {
            setTimeout(function () {
                try { var el = document.querySelector(sel); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
            }, 80);
        },
        goImmAnchor: function () { api.goLearn(); api.anchor("#lang-learn-imm"); },
        goVocabAnchor: function () { api.goVocab(); api.anchor("#lang-learn-vocab"); },
        /* ---- 排行榜(2026-09-06):日/周/月学习时长 Top100;2026-09-21 增"无阻畅读榜"并修语种切换 ---- */
        goLeaderboard: function () {
            switchView("view-lang-leaderboard");
            api.renderLeaderboard();
        },
        setLbSpan: function (sp) {
            if (sp !== "week" && sp !== "month") sp = "day";
            lbSpan = sp;
            api.lbSyncPicker();
            api.renderLeaderboard();
        },
        setLbBoard: function (b) {
            lbBoard = b === "immersive" ? "immersive" : "time";
            api.lbSyncPicker();
            api.renderLeaderboard();
        },
        /* 语种切换后调用:榜单按 lang 取数,不重拉会一直停在旧语种那批数据上 */
        refreshLeaderboardIfVisible: function () {
            var el = $("view-lang-leaderboard");
            if (!el || !el.classList.contains("active")) return;
            lbCache = {};
            lbReq++;
            api.renderLeaderboard();
        },
        lbSyncPicker: function () {
            var box = $("lb-span-picker");
            if (box) {
                var btns = box.querySelectorAll(".lang-lang-card");
                for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-span") === lbSpan);
            }
            var bb = $("lb-board-picker");
            if (bb) {
                var bs = bb.querySelectorAll(".lang-lang-card");
                for (var j = 0; j < bs.length; j++) bs[j].classList.toggle("active", bs[j].getAttribute("data-board") === lbBoard);
            }
        },
        lbUnit: function (lang) { return (lang || "en") === "en" ? "词" : "字"; },
        fmtRead: function (n, lang) {
            n = Math.max(0, Number(n) || 0);
            var u = api.lbUnit(lang);
            return n >= 10000 ? (n / 10000).toFixed(1) + " 万" + u : n + " " + u;
        },
        refreshLeaderboard: function () {
            lbCache = {};
            lbReq++;              // 让在途请求作废——否则它的回调会把旧语种/旧榜别的结果写回缓存
            api.renderLeaderboard();
        },
        renderLeaderboard: function () {
            var box = $("lb-list");
            if (!box) return;
            api.lbSyncTitles();
            /* 请求参数在发车前落成本地量:回调里再读全局会被用户中途切语种/切榜别改掉,
               结果就会按新键写进缓存(旧版 lbCache[lbSpan] 的错值就是这么来的) */
            var board = lbBoard, span = lbSpan, lang = curLearnLang();
            var key = board + "|" + lang + "|" + span;
            var c = lbCache[key];
            if (c && Date.now() - c.at < 30000) { box.innerHTML = c.html; api.lbMeta(c); api.lbMe(c); return; }
            var seq = ++lbReq;
            box.innerHTML = '<div class="list-sub" style="padding:14px 0;">榜单加载中…</div>';
            fetch(API_BASE + "/api/lang/leaderboard?board=" + encodeURIComponent(board) +
                "&span=" + encodeURIComponent(span) + "&lang=" + encodeURIComponent(lang), {
                headers: token() ? { "X-Auth-Token": "Bearer " + token() } : {}
            })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (seq !== lbReq) return;    // 已被更新的请求取代,丢弃这一批
                    if (!d) { box.innerHTML = '<div class="list-sub" style="padding:14px 0;">榜单加载失败，点「↻ 刷新」重试</div>'; return; }
                    var html = api.lbRowsHtml(d, board, lang);
                    var c2 = { at: Date.now(), html: html, meta: d, items: d.items, me: d.me, board: board, lang: lang, span: span };
                    lbCache[key] = c2;
                    box.innerHTML = html;
                    api.lbMeta(c2);
                    api.lbMe(c2);
                })
                .catch(function () {
                    if (seq !== lbReq) return;
                    box.innerHTML = '<div class="list-sub" style="padding:14px 0;">网络开小差了，点「↻ 刷新」重试</div>';
                });
        },
        lbSyncTitles: function () {
            var ln = LANG_TAG_INFO[curLearnLang()][1];
            var t = $("lb-title"), s = $("lb-sub");
            if (t) t.textContent = lbBoard === "immersive" ? "📖 " + ln + "无阻畅读榜" : "🏆 " + ln + "学习时长榜";
            if (s) s.textContent = lbBoard === "immersive"
                ? "不点生词、不看译文、一路顺畅读下去的原文字数才算——挂机刷时长在这里没用。每次进入自动累计，越读越靠前。"
                : "玩" + ln + "剧本 + 生词本翻记都算学习时长——每次进入自动记录，越玩越靠前。";
        },
        lbRowsHtml: function (d, board, lang) {
            var items = d.items || [];
            if (!items.length) return '<div class="list-sub" style="padding:14px 0;">' +
                (board === "immersive"
                    ? "还没有人上榜——去玩" + LANG_TAG_INFO[lang || "en"][1] + "剧本，一路无阻地读下去，第一个留下名字！"
                    : "还没有人上榜——去玩" + LANG_TAG_INFO[lang || "en"][1] + "剧本，第一个留下名字！") + "</div>";
            var html = "", i, it, face;
            for (i = 0; i < items.length; i++) {
                it = items[i];
                face = it.faceimg ? '<img class="lb-face" src="' + api.esc(it.faceimg) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' :
                    '<span class="lb-face lb-face-no">' + api.esc(String(it.nickname || "?").slice(0, 1).toUpperCase()) + "</span>";
                html += '<div class="lb-row' + (d.me && d.me.user_id === it.user_id ? " lb-me" : "") + '">' +
                    '<span class="lb-rank' + (it.rank <= 3 ? " lb-top" : "") + '">' + it.rank + "</span>" + face +
                    '<span class="lb-name">' + api.esc(String(it.nickname || "云吞吞学友")) + "</span>" +
                    '<span class="lb-sec">' + (board === "immersive" ? api.fmtRead(it.chars, lang) : api.fmtDur(it.seconds)) + "</span></div>";
            }
            return html;
        },
        lbMeta: function (c) {
            var el = $("lb-meta"); if (!el) return;
            var names = { day: "今日", week: "本周", month: "本月" };
            var ln = LANG_TAG_INFO[c.lang || "en"][1];
            el.textContent = c.board === "immersive"
                ? "按北京时间的" + (names[c.span] || "今日") + "无阻阅读量排名：只有没点生词、没开译文的句子计入，" + (api.lbUnit(c.lang) === "词" ? "英语按词数" : "按原文字数") + "，前 100 名上榜。"
                : "按北京时间的" + (names[c.span] || "今日") + "学习时长排名：玩" + ln + "剧本 + 学习中心/生词本都计入，前 100 名上榜。";
        },
        lbMe: function (c) {
            var el = $("lb-me"); if (!el) return;
            var me = c.me;
            if (!me) { el.style.display = "none"; el.innerHTML = ""; return; }
            for (var i = 0; i < (c.items || []).length; i++) {
                if (c.items[i].user_id === me.user_id) { el.style.display = "none"; el.innerHTML = ""; return; }
            }
            el.style.display = "block";
            var has = c.board === "immersive";
            var done = has ? "已无阻读完 " + api.fmtRead(me.chars, c.lang) : "已学 " + api.fmtDur(me.seconds);
            var tip = has ? "，再顺畅读一会儿就能挤进前 100" : "，再学一会儿就能挤进前 100";
            el.innerHTML = '<div class="lb-me-card">' + (me.rank ? "你当前第 " + me.rank + " 名" : "你还没上榜") + " · " + done + (me.rank ? "" : tip) + "</div>";
        },
        fmtDur: function (s) {
            s = Number(s) || 0;
            if (s < 60) return "<1 分钟";
            var m = Math.floor(s / 60);
            if (m < 60) return m + " 分钟";
            var h = Math.floor(m / 60);
            if (h < 24) return h + (m % 60 ? " 小时 " + (m % 60) + " 分" : " 小时");
            return Math.floor(h / 24) + " 天 " + (h % 24) + " 小时";
        },
        setLibFilter: function (k, v) {
            if (k === "gender") { if (v === "love-f" || v === "love-m") saveGenderPref(v); else saveGenderPref(""); }
            libFilter[k] = v; api.renderLibrary();
        },
        recommendFor: function (lcs) {
            var arr = lcs.slice();
            /* R1 向别偏好(有档时同样生效):匹配向别的恋爱卡最优先,再按 band 距离/上架序 */
            var pref = genderPref();
            /* 档距按**当前语种**的档序算:英语五档/日语 N5-N1/韩语初中高三张序表混着算会把档距算成胡说 */
            var _order = bandOrderOf(curLang());
            var my = profile.band || "";
            var mi = my ? _order.indexOf(my) : -1;
            arr.sort(function (a, b) {
                var am = loveMatch(a, pref) ? 0 : 1, bm = loveMatch(b, pref) ? 0 : 1;
                if (am !== bm) return am - bm;
                if (mi >= 0) {
                    var ai = _order.indexOf(a.band || ""), bi = _order.indexOf(b.band || "");
                    var da = ai < 0 ? 99 : Math.abs(ai - mi), db = bi < 0 ? 99 : Math.abs(bi - mi);
                    if (da !== db) return da - db;
                }
                return (a.order || 9) - (b.order || 9);
            });
            return arr;
        },
        renderHome: function () {
            var box = $("lang-home-reco"); if (!box) return;
            var lcs = window.LANG_CARDS_ONLINE || [];
            /* 学习档状态条 */
            var hb = $("lang-home-band");
            if (hb) {
                if (profile.band) {
                    var b = BAND_INFO[profile.band] || BAND_INFO.cet4;
                    hb.innerHTML = '<div class="lang-band-hero"><div class="lang-band-chip ' + (b[2] || "") + '">' + api.esc(b[0]) + "</div>" +
                        '<div style="flex:1;min-width:0;"><div class="lang-band-t">你的学习档：英语 ' + api.esc(b[0]) + " · " + api.esc(b[1]) + "</div>" +
                        '<div class="lang-band-d">' + api.esc(b[3]) + "</div></div></div>";
                } else {
                    hb.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 13px;border-radius:14px;border:1px dashed var(--line,#e2ccb0);background:var(--input-bg,#fff8f0);">' +
                        '<span style="font-size:1.35rem;">🎯</span><div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:.85rem;">还没选学习档</div>' +
                        '<div class="list-sub" style="margin-top:1px;">挑一个档，推荐与词库会按它匹配；不选也能直接开玩</div></div>' +
                        '<button type="button" class="mini-btn primary" onclick="LangController.goLearn()">去选档</button></div>';
                }
            }
            var sub = $("lang-home-reco-sub");
            if (sub) sub.textContent = profile.band ? ("已按你的学习档 " + bandShort(profile.band) + " 匹配推荐，点卡即玩") : "按最新上架推荐；在「学习中心」选好档后推荐按档匹配";
            var wrap = $("lang-reco-wrap");
            api.stopLangBanner();
            api.bindLangBannerSwipe();
            if (!window.__LANG_CARDS_READY) {
                if (wrap) wrap.style.display = "none";
                if (!window.__LANG_CARDS_LOADING) api.loadLangCards();
            } else if (!lcs.length) {
                if (wrap) wrap.style.display = "none";
                if (sub) sub.textContent = api.langName() + "官方剧本持续更新中，新卡上线后会出现在这里～";
            } else {
                if (wrap) wrap.style.display = "block";
                var cards = api.recommendFor(lcs).slice(0, 6);
                langBanner.idx = 0;
                box.innerHTML = cards.map(langBannerHtml).join("");
                var bi;
                for (bi = 0; bi < cards.length; bi++) window.CoverService.paint("lb-cover-" + window.CoverService.safeId(cards[bi].id), cards[bi]);
                var dotsBox = $("lang-reco-dots");
                if (dotsBox) dotsBox.innerHTML = cards.map(function (_, di) { return '<span class="dot' + (di === 0 ? " active" : "") + '" onclick="LangController.goLangBanner(' + di + ')"></span>'; }).join("");
                bindCardClicks(box);
                api.startLangBanner(cards.length);
            }
            /* 各区块独立兜底:单块异常不得连带吞掉后面的剧本库渲染(2026-09-13 今日一句 esc 未定义曾致整库空白) */
            try { api.renderContinue(); } catch (e) {}
            try { api.renderLangHub(); } catch (e) {}
            /* 剧本库平铺在推荐轮播下方(原独立子页已合并) */
            api.renderLibrary();
        },
        /* ---- P2 学习首页(2026-09-08):今日一句 / 我的进度 3 格 / 会员卡位 ----
           今日一句:内置双语考场景句池按北京日期轮换;「译一译」直调 gloss(与剧情点句同一配额:免费每日限量→救急包→会员);
           点译成功本地记 lang_today_g:{d,en,zh},当天重进不再重复扣额度 */
        renderLangHub: function () {
            api.renderToday();
            api.renderMyStats();
            api.renderMemberCta();
        },
        renderToday: function () {
            var box = $("lang-today-box");
            if (!box) return;
            var P_EN = [
                { en: "Sleeping in is tempting on weekends, but an early start makes the whole day feel longer.", tag: "四级·生活" },
                { en: "The library stays open until ten at night during exam season, and every seat is usually taken.", tag: "校园" },
                { en: "I practice listening every morning for twenty minutes before breakfast, and it really adds up.", tag: "四级·学习" },
                { en: "Renting an apartment near campus costs more, yet it saves at least an hour of commuting a day.", tag: "四级·租房" },
                { en: "If you prepare the interview questions in advance, you will feel far less nervous in the room.", tag: "四级·求职" },
                { en: "A part-time job teaches you time management just as much as it fills your wallet.", tag: "六级·兼职" },
                { en: "The more familiar you grow with a word, the easier it becomes to recall it under pressure.", tag: "六级·学习" },
                { en: "Campus canteens may lack fancy dishes, but they remain the most affordable choice for students.", tag: "四级·校园" },
                { en: "Students who form study groups often outperform those who prepare alone for the same exam.", tag: "六级·学习" },
                { en: "The registration for the winter internship program closes this Friday at noon, so do not delay.", tag: "四级·实习" },
                { en: "He was about to give up on the problem when a sudden idea crossed his mind.", tag: "四级·心理" },
                { en: "Online courses give you flexibility, but they demand stronger self-discipline than classroom ones.", tag: "六级·教育" },
                { en: "The subway line to the university town was extended last year, making trips to downtown much easier.", tag: "六级·城市" },
                { en: "Keeping a gratitude journal for five minutes a day is a simple habit with surprising benefits.", tag: "六级·心理" },
                { en: "Group presentations count for thirty percent of the final grade, so no one dares to skip rehearsal.", tag: "校园" },
                { en: "Weather forecasts are more reliable now, yet people still check their phones before every outdoor plan.", tag: "四级·科技" },
                { en: "A delayed train is annoying, but it gives you an unplanned chance to finish the chapter you brought.", tag: "四级·出行" },
                { en: "Freshmen often overpack for college; the real necessities usually fit into one suitcase and a backpack.", tag: "四级·校园" },
                { en: "Doctors recommend taking a ten-minute walk after each hour of sitting in front of a screen.", tag: "四级·健康" },
                { en: "What impressed the employer most was not his degree but the way he solved problems calmly.", tag: "六级·求职" },
                { en: "Saving two hundred yuan a month may seem small until you count how many months are left in a year.", tag: "四级·理财" },
                { en: "She turned down the well-paid offer because the night shifts would ruin her sleeping schedule.", tag: "六级·职场" },
                { en: "Renewable energy is no longer a distant dream, as solar panels now appear on dormitory rooftops.", tag: "六级·环保" },
                { en: "You do not need expensive equipment to start running, just a pair of shoes and a clear route.", tag: "四级·健康" },
                { en: "The lecturer paused now and then so that the audience could take notes without falling behind.", tag: "校园" },
                { en: "Instead of scrolling through short videos, try reading one English article aloud to warm up your mouth.", tag: "六级·学习" },
                { en: "Public bicycles scattered across campus have cut short trips that used to require the bus.", tag: "四级·生活" },
                { en: "A clear schedule beats talent when finals week arrives and everyone is short on sleep.", tag: "校园" },
                { en: "Though the film received mixed reviews, its soundtrack alone is worth the ticket price.", tag: "四级·娱乐" },
                { en: "Culture shock usually fades once you build a routine and find people who share your hobbies.", tag: "六级·留学" }
            ];
            /* 日/韩句池(2026-09-21 补):难度对齐 N3-N4 / TOPIK 2-3,题材与英语池同构。
               键一律用 s(原文),英语池沿用 en —— 取值处 `t.s || t.en` 兼容两种写法 */
            var P_JA = [
                { s: "週末は寝坊したくなるけれど、早起きすると一日が長く感じられる。", tag: "N4·生活" },
                { s: "試験の前は図書館が十時まで開いていて、席はいつも埋まっている。", tag: "N4·校园" },
                { s: "朝ごはんの前に二十分だけリスニングを練習する。積み重ねが大事だ。", tag: "N4·学习" },
                { s: "大学の近くの部屋は家賃が高いが、通学時間を一時間節約できる。", tag: "N4·租房" },
                { s: "面接の質問を前もって準備しておけば、当日はあまり緊張しない。", tag: "N4·求职" },
                { s: "アルバイトはお金を稼ぐだけでなく、時間の使い方も教えてくれる。", tag: "N3·兼职" },
                { s: "単語に慣れるほど、本番でも自然に思い出せるようになる。", tag: "N3·学习" },
                { s: "学食はおしゃれな料理は少ないが、学生にとって一番安い選択だ。", tag: "N4·校园" },
                { s: "一緒に勉強する人は、一人で準備する人より良い結果を出しやすい。", tag: "N3·学习" },
                { s: "冬のインターンの申し込みは金曜日の正午で締め切られる。急いだほうがいい。", tag: "N4·实习" },
                { s: "彼はその問題を諦めかけたとき、急に良い考えを思いついた。", tag: "N4·心理" },
                { s: "オンライン授業は自由だが、教室の授業より自制心が必要だ。", tag: "N3·教育" },
                { s: "大学へ行く地下鉄が去年延びて、街への移動がずっと楽になった。", tag: "N3·城市" },
                { s: "毎日五分間の日記をつける習慣は、思った以上に良い効果がある。", tag: "N3·心理" },
                { s: "グループ発表は成績の三割を占めるので、誰も練習を休まない。", tag: "N4·校园" },
                { s: "天気予報は前より正確だが、それでも出かける前に天気を確かめてしまう。", tag: "N4·科技" },
                { s: "電車の遅れは困るが、持ってきた本を読む時間ができたと思うと悪くない。", tag: "N4·出行" },
                { s: "新入生は荷物を詰めすぎる。本当に必要なものはスーツケース一つで足りる。", tag: "N4·校园" },
                { s: "画面の前に座り続けたら、一時間ごとに十分歩くのがいいそうだ。", tag: "N4·健康" },
                { s: "面接官が一番感心したのは学歴ではなく、落ち着いて問題を解く姿だった。", tag: "N3·求职" },
                { s: "月に二百元の貯金は小さく見えるが、一年分を数えると大きい。", tag: "N4·理财" },
                { s: "彼女は給料の良い仕事を断った。夜勤で生活が乱れるのが嫌だったからだ。", tag: "N3·职场" },
                { s: "再生可能なエネルギーはもう夢ではない。寮の屋上にも太陽光パネルがある。", tag: "N3·环保" },
                { s: "走り始めるのに高い道具はいらない。靴と、はっきりした道順だけあればいい。", tag: "N4·健康" },
                { s: "講師は時々話を止めて、学生が置いていかれないようにメモを取らせた。", tag: "N4·校园" },
                { s: "短い動画を見続ける代わりに、英語の記事を一つ音読してみよう。", tag: "N3·学习" },
                { s: "キャンパスの自転車のおかげで、バスが必要だった近距離もすぐ行ける。", tag: "N4·生活" },
                { s: "期末が近づいて誰も寝不足になると、才能より計画表がものを言う。", tag: "N4·校园" },
                { s: "映画の評価は分かれたが、音楽だけでもチケット代の価値はある。", tag: "N4·娱乐" },
                { s: "文化の違いは、生活のリズムを作り、趣味の合う人を見つければ薄れていく。", tag: "N3·留学" }
            ];
            var P_KO = [
                { s: "주말에는 늦잠이 끌리지만, 일찍 일어나면 하루가 더 길게 느껴진다.", tag: "TOPIK 2·生活" },
                { s: "시험 기간에는 도서관이 열 시까지 열려 있고, 자리는 늘 꽉 차 있다.", tag: "TOPIK 2·校园" },
                { s: "아침을 먹기 전에 이십 분씩 듣기를 연습한다. 쌓이면 분명히 도움이 된다.", tag: "TOPIK 2·学习" },
                { s: "학교 근처 집은 월세가 비싸지만, 통학 시간을 한 시간 아낄 수 있다.", tag: "TOPIK 2·租房" },
                { s: "면접 질문을 미리 준비해 두면, 당일에는 훨씬 덜 떨린다.", tag: "TOPIK 2·求职" },
                { s: "아르바이트는 돈을 버는 것뿐만 아니라 시간 관리도 가르쳐 준다.", tag: "TOPIK 3·兼职" },
                { s: "단어에 익숙해질수록 시험장에서도 자연스럽게 떠올릴 수 있다.", tag: "TOPIK 3·学习" },
                { s: "학생 식당은 화려한 요리는 없지만, 학생에게 가장 저렴한 선택이다.", tag: "TOPIK 2·校园" },
                { s: "같이 공부하는 사람이 혼자 준비하는 사람보다 좋은 결과를 내기 쉽다.", tag: "TOPIK 3·学习" },
                { s: "겨울 인턴 지원은 금요일 정오에 마감되니 서두르는 게 좋다.", tag: "TOPIK 2·实习" },
                { s: "그는 문제를 포기하려던 순간, 갑자기 좋은 생각이 떠올랐다.", tag: "TOPIK 2·心理" },
                { s: "온라인 수업은 자유롭지만, 교실 수업보다 더 강한 자기 관리가 필요하다.", tag: "TOPIK 3·教育" },
                { s: "대학으로 가는 지하철이 작년에 연장되어 시내에 가기가 훨씬 편해졌다.", tag: "TOPIK 3·城市" },
                { s: "하루 오 분씩 감사 일기를 쓰는 습관은 생각보다 큰 효과가 있다.", tag: "TOPIK 3·心理" },
                { s: "조별 발표가 성적의 삼십 퍼센트를 차지해서 아무도 연습을 빼먹지 않는다.", tag: "TOPIK 2·校园" },
                { s: "일기예보가 더 정확해졌지만, 나가기 전에 핸드폰을 확인하는 습관은 그대로다.", tag: "TOPIK 2·科技" },
                { s: "지하철이 늦으면 짜증 나지만, 가져온 책을 읽을 시간이 생겼다고 생각하면 낫다.", tag: "TOPIK 2·出行" },
                { s: "신입생은 짐을 너무 많이 싸 온다. 정말 필요한 건 가방 하나면 충분하다.", tag: "TOPIK 2·校园" },
                { s: "화면 앞에 오래 앉아 있으면 한 시간마다 십 분씩 걷는 게 좋다고 한다.", tag: "TOPIK 2·健康" },
                { s: "면접관이 가장 감탄한 것은 학벌이 아니라 침착하게 문제를 푸는 모습이었다.", tag: "TOPIK 3·求职" },
                { s: "한 달에 이십만 원 저축은 작아 보여도, 일 년치를 세어 보면 크다.", tag: "TOPIK 2·理财" },
                { s: "그녀는 월급이 좋은 제안을 거절했다. 야간 근무가 생활을 망칠 것 같았기 때문이다.", tag: "TOPIK 3·职场" },
                { s: "재생 에너지는 더 이상 먼 꿈이 아니다. 기숙사 옥상에도 태양광 패널이 있다.", tag: "TOPIK 3·环保" },
                { s: "달리기를 시작하는 데 비싼 장비는 필요 없다. 신발과 뚜렷한 코스만 있으면 된다.", tag: "TOPIK 2·健康" },
                { s: "강사는 가끔 설명을 멈추고, 학생들이 필기를 따라잡을 시간을 주었다.", tag: "TOPIK 2·校园" },
                { s: "짧은 영상을 계속 보는 대신, 기사를 하나 소리 내어 읽어 보자.", tag: "TOPIK 3·学习" },
                { s: "캠퍼스 곳곳의 공용 자전거 덕분에 버스가 필요했던 짧은 이동이 편해졌다.", tag: "TOPIK 2·生活" },
                { s: "기말이 다가와 모두 잠이 부족해질 때는 재능보다 계획표가 이긴다.", tag: "TOPIK 2·校园" },
                { s: "영화 평가는 갈렸지만, 음악만으로도 표값의 가치는 충분하다.", tag: "TOPIK 2·娱乐" },
                { s: "문화 차이는 생활 리듬이 생기고 취미가 맞는 사람을 만나면 조금씩 옅어진다.", tag: "TOPIK 3·留学" }
            ];
            var TODAY_POOL = { en: P_EN, ja: P_JA, ko: P_KO };
            var nowBJ = new Date(Date.now() + 8 * 3600000);
            var dayStr = nowBJ.toISOString().slice(0, 10);
            var dayNum = Number(dayStr.replace(/-/g, ""));
            var lang = curLearnLang();
            var p = TODAY_POOL[lang] || TODAY_POOL.en;
            var t = p[dayNum % p.length];
            todayShownLang = lang;
            todayShownText = String(t.s || t.en || "");
            var got = null;
            try { got = JSON.parse(localStorage.getItem("lang_today_g") || "null"); } catch (e) {}
            // 缓存键要带语种:同一天切到日语不该沿用英语那句的译文
            var done = !!(got && got.d === dayStr && got.lang === lang && got.s === todayShownText);
            var zhBox = done && got.zh ? '<div class="lang-today-zh" id="lang-today-zh">' + api.esc(String(got.zh)) + "</div>" : "";
            var note = done
                ? '<div class="lang-today-note" id="lang-today-note">本句已译过，明天换新句</div>'
                : '<div class="lang-today-note" id="lang-today-note">' + (token()
                    ? '<button type="button" class="lt-btn" onclick="LangController.todayGloss()">译一译</button> <span style="margin-left:4px;">免费每天限量，会员不限量</span>'
                    : "登录后可点译今日一句（每日免费限量）") + "</div>";
            box.innerHTML = '<div class="lang-today">' +
                '<div class="lang-today-h"><span>📅 今日一句</span><span style="font-weight:600;opacity:.85;">【' + api.esc(t.tag) + "】</span></div>" +
                '<div class="lang-today-en" id="lang-today-en">' + api.esc(todayShownText) + "</div>" + zhBox + note + "</div>";
        },
        todayGloss: function () {
            var enEl = $("lang-today-en"), note = $("lang-today-note");
            if (!enEl || !note) return;
            if (!token()) { note.innerHTML = "登录后可点译今日一句（每日免费限量）"; return; }
            var s = enEl.textContent.replace(/\s+/g, " ").trim().slice(0, 500);
            if (!s) return;
            var btns = function (h) { return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' + h + "</div>"; };
            var bPack = '<button type="button" class="lt-btn ghost" onclick="LangController.openPack()">小额直付 ¥1/¥3</button>';
            var bMember = '<button type="button" class="lt-btn ghost" onclick="MembershipService.openPanel()">开通会员不限量</button>';
            note.innerHTML = '<span class="lg-gload"><i></i><i></i><i></i></span><span style="margin-left:6px;">译文生成中…</span>';
            fetch(API_BASE + "/api/lang/gloss", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
                // 语种跟渲染时的语言页选择走:今日一句不是会话内文本,curSessionLang() 在此只会回落成 en
                body: JSON.stringify({ sentences: [s], lang: todayShownLang || curLearnLang() })
            })
                .then(function (r) { return r.json().catch(function () { return null; }); })
                .then(function (d) {
                    var nowBJ = new Date(Date.now() + 8 * 3600000);
                    var dayStr = nowBJ.toISOString().slice(0, 10);
                    if (d && d.ok && d.items && d.items[0] && d.items[0].zh) {
                        var zh = String(d.items[0].zh);
                        try { localStorage.setItem("lang_today_g", JSON.stringify({ d: dayStr, lang: todayShownLang || curLearnLang(), s: s, zh: zh })); } catch (e) {}
                        var zhEl = $("lang-today-zh");
                        if (!zhEl) { var box = $("lang-today-box"); var enEl2 = $("lang-today-en"); if (box && enEl2) { var d2 = document.createElement("div"); d2.className = "lang-today-zh"; d2.id = "lang-today-zh"; d2.textContent = zh; enEl2.parentNode.insertBefore(d2, enEl2.nextSibling); } }
                        else { zhEl.style.display = ""; zhEl.textContent = zh; }
                        note.innerHTML = '<span style="font-weight:800;color:#2f9e6e;">✓ 已译好</span><span style="margin-left:6px;">点剧情里的句子同样即点即译；点词自动进生词本</span>';
                    } else if (d && d.code === "GLOSS_DAILY_LIMIT") {
                        note.innerHTML = "今天的点译次数用完啦（明天 08:00 刷新）" + btns(bMember);
                    } else if (d && d.code === "INSUFFICIENT_COIN") {
                        note.innerHTML = api.esc(String(d.error || "点译额度已用完，云币也不足")).slice(0, 200) + btns(bPack + bMember);
                    } else {
                        note.innerHTML = '<button type="button" class="lt-btn ghost" onclick="LangController.todayGloss()">译文没取到 · 点此重试</button>';
                    }
                })
                .catch(function () {
                    var note2 = $("lang-today-note");
                    if (note2) note2.innerHTML = '<button type="button" class="lt-btn ghost" onclick="LangController.todayGloss()">译文没取到 · 点此重试</button>';
                });
        },
        openPack: function () {
            try { MembershipService.selectPlan("rescue3"); MembershipService.openPanel(); } catch (e) {}
        },
        renderMyStats: function () {
            var el = $("lang-my-stats");
            if (!el) return;
            if (!token()) { el.style.display = "none"; return; }
            el.style.display = "block";
            var want = curLearnLang();
            if (myStatsCache && myStatsCache.lang === want && Date.now() - myStatsCache.at < 30000) { api.myStatsHtml(myStatsCache.data); return; }
            fetch(API_BASE + "/api/lang/learn-stats?lang=" + encodeURIComponent(want), { headers: { "X-Auth-Token": "Bearer " + token() } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (!d || !d.ok) return;
                    myStatsCache = { at: Date.now(), lang: want, data: d };
                    api.myStatsHtml(d);
                }).catch(function () {});
        },
        myStatsHtml: function (d) {
            var el = $("lang-my-stats");
            if (!el) return;
            var todayM = Math.floor(Number(d.today_seconds || 0) / 60);
            var streak = Number(d.streak || 0);
            var v = d.vocab || {};
            var grid = '<div class="stat-grid">' +
                '<div class="stat-cell"><b>' + api.fmtDur(d.today_seconds || 0) + "</b><s>今日学习</s></div>" +
                '<div class="stat-cell"><b>' + (streak > 0 ? "🔥 " : "") + streak + " 天</b><s>连续学习</s></div>" +
                '<div class="stat-cell"><b>' + (Number(v.mastered || 0) + Number(v.familiar || 0)) + " / " + Number(v.total || 0) + "</b><s>已掌握/生词</s></div>" +
                "</div>";
            var weekNew = Number(d.week_new_vocab || 0);
            var line = "本周已学 " + api.fmtDur(d.week_seconds || 0) + " · 累计 " + Number(d.total_days || 0) + " 天 · 已练词 " + Number(d.bank_words || 0) +
                (weekNew > 0 ? " · 本周新收 " + weekNew + " 词" : "");
            el.innerHTML = grid +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;"><div class="list-sub" style="margin:0;">' + line + "</div>" +
                '<button type="button" class="mini-btn ghost" onclick="LangController.goLearnStats()">统计与周报 ›</button></div>';
        },
        /* P2-4 学习中心统计周报区(2026-09-09):7 日柱状+本周小结+生词掌握条;数据同 learn-stats 单接口
           force=true 绕过 30s 缓存强制刷新(点击「统计与周报」进入时) */
        renderLearnStats: function (force) {
            var box = $("lang-learn-stats-box");
            if (!box) return;
            if (!token()) {
                box.innerHTML = '<div class="list-sub" style="padding:12px 0;">登录后查看学习统计与周报——数据随账号云端同步，换设备不丢。</div>';
                return;
            }
            var want = curLearnLang();
            // 缓存要带语种:只按时间的话,30s 内切语种会把旧语种的统计当新语种显示
            if (!force && myStatsCache && myStatsCache.lang === want && Date.now() - myStatsCache.at < 30000) { api.learnStatsHtml(myStatsCache.data); return; }
            box.innerHTML = '<div class="list-sub" style="padding:12px 0;">统计加载中…</div>';
            fetch(API_BASE + "/api/lang/learn-stats?lang=" + encodeURIComponent(want), { headers: { "X-Auth-Token": "Bearer " + token() } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (!d || !d.ok) {
                        var bx = $("lang-learn-stats-box");
                        if (bx) bx.innerHTML = '<div class="list-sub" style="padding:12px 0;">统计加载失败，点「刷新」重试</div>';
                        return;
                    }
                    myStatsCache = { at: Date.now(), lang: want, data: d };
                    api.learnStatsHtml(d);
                })
                .catch(function () {
                    var bx = $("lang-learn-stats-box");
                    if (bx) bx.innerHTML = '<div class="list-sub" style="padding:12px 0;">网络开小差了，点「刷新」重试</div>';
                });
        },
        learnStatsHtml: function (d) {
            var box = $("lang-learn-stats-box");
            if (!box) return;
            var today = String(d.today || "");
            var d7 = d.days7 || [], maxS = 1, i, it, s;
            for (i = 0; i < d7.length; i++) { s = Number(d7[i].seconds) || 0; if (s > maxS) maxS = s; }
            var wd = ["日", "一", "二", "三", "四", "五", "六"];
            function wkLab(dayStr) {
                try { var dt = new Date(Date.parse(String(dayStr) + "T00:00:00Z") + 8 * 3600000); return "周" + wd[dt.getUTCDay()]; } catch (e) { return ""; }
            }
            var cols = "", mini = "";
            for (i = 0; i < d7.length; i++) {
                it = d7[i];
                s = Number(it.seconds) || 0;
                var pct = Math.max(2, Math.round(s / maxS * 100));
                var m = Math.floor(s / 60);
                cols += '<div class="wks-col"><div class="wks-track"><div class="wks-bar' + (String(it.day) === today ? " today" : "") + '" style="height:' + pct + '%" title="' + api.esc(String(it.day)) + " " + api.fmtDur(s) + '"></div></div>' +
                    '<div class="wks-lab">' + wkLab(it.day) + "</div>" +
                    '<div class="wks-mins">' + (m > 0 ? m + " 分" : "·") + "</div></div>";
                if (s > 0) mini = "近 7 天你学了 " + api.fmtDur(s);
            }
            var v = d.vocab || {};
            var vTotal = Number(v.total || 0);
            var vMas = Number(v.mastered || 0), vFam = Number(v.familiar || 0), vNew = Number(v.new || 0);
            var masPct = vTotal ? Math.round(vMas / vTotal * 100) : 0;
            var famPct = vTotal ? Math.round(vFam / vTotal * 100) : 0;
            var streak = Number(d.streak || 0);
            var weekS = Number(d.week_seconds || 0);
            var rows =
                '<div class="wk-row"><span>本周学习</span><b>' + api.fmtDur(weekS) + "</b></div>" +
                '<div class="wk-row"><span>连续学习</span><b>' + (streak > 0 ? "🔥 " + streak + " 天" : "今天开始第一段连胜") + "</b></div>" +
                '<div class="wk-row"><span>累计学习</span><b>' + api.fmtDur(d.total_seconds || 0) + " · " + Number(d.total_days || 0) + " 天</b></div>" +
                '<div class="wk-row"><span>本周新收生词</span><b>' + Number(d.week_new_vocab || 0) + " 个</b></div>" +
                '<div class="wk-row"><span>词测练词</span><b>' + Number(d.bank_words || 0) + " 个</b></div>";
            var vHtml = vTotal > 0
                ? '<div style="margin-top:10px;"><div class="wks-vt">生词掌握 <span class="list-sub" style="margin-left:2px;">已掌握 ' + vMas + " · 眼熟 " + vFam + " · 新学 " + vNew + "</span></div>" +
                    '<div class="wks-track-line"><div class="wks-vf" style="width:' + famPct + '%" title="眼熟 ' + vFam + '"></div><div class="wks-vm" style="width:' + masPct + '%" title="已掌握 ' + vMas + '"></div></div>' +
                    '<div class="list-sub" style="margin-top:4px;">' + (vMas === vTotal ? "生词全部掌握 🎉 太强了，可以挑战更高档剧本了" : "深色段 = 已掌握进度 · 玩剧本时点词点句，生词本会自动长出来") + "</div></div>"
                : '<div class="list-sub" style="margin-top:10px;">还没收过生词——去玩一个' + learnLangName() + '剧本，点一下不认识的字词就会自动收进生词本，开始积累吧。</div>';
            box.innerHTML =
                '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-top:0;">' +
                '<div class="stat-cell"><b>' + api.fmtDur(d.today_seconds || 0) + "</b><s>今日学习</s></div>" +
                '<div class="stat-cell"><b>' + api.fmtDur(weekS) + "</b><s>本周学习</s></div>" +
                '<div class="stat-cell"><b>' + (streak > 0 ? "🔥 " : "") + streak + "</b><s>连续天数</s></div>" +
                '<div class="stat-cell"><b>' + Number(d.total_days || 0) + "</b><s>累计天数</s></div>" +
                "</div>" +
                '<div style="margin-top:12px;"><div class="wks-t">近 7 日学习</div><div class="wks-cols">' + cols + "</div>" +
                (mini ? '<div class="list-sub" style="margin-top:3px;text-align:center;">' + mini + "，坚持就是胜利 💪</div>" : '<div class="list-sub" style="margin-top:3px;text-align:center;">这 7 天还没开始——从「今日一句」或推荐剧本的第一句开始吧</div>') +
                "</div>" +
                '<div class="wks-t" style="margin-top:12px;">本周小结</div>' + rows +
                vHtml +
                '<div style="margin-top:10px;text-align:center;"><button type="button" class="lt-btn ghost" onclick="LangController.renderLearnStats(true)">↻ 刷新统计</button></div>';
        },
        goLearnStats: function () {
            api.goLearn();
            api.renderLearnStats(true);
            api.anchor("#lang-learn-stats");
        },
        renderMemberCta: function () {
            var el = $("lang-member-cta");
            if (!el) return;
            var m = false;
            try { m = !!(window.AuthService && AuthService.hasMembership && AuthService.hasMembership()); } catch (e) {}
            if (m) { el.style.display = "none"; return; }
            el.style.display = "block";
            el.innerHTML = '<div class="member-band" onclick="MembershipService.openPanel()">' +
                '<span style="font-size:1.55rem;">👑</span>' +
                '<div style="flex:1;min-width:0;"><div style="font-weight:900;font-size:.88rem;">云吞吞会员</div>' +
                '<div style="font-size:.68rem;line-height:1.5;opacity:.85;margin-top:2px;">AI 对话 / 点译 / 复盘不限量（免费每日限量）· 优先用池内最优模型 · 付费社区卡免云币解锁</div></div>' +
                '<span style="font-weight:900;flex-shrink:0;">开通 ›</span></div>';
        },
        renderContinue: function () {
            var wrap = $("lang-home-continue-wrap"); if (!wrap) return;
            var box = $("lang-home-continue"); if (!box) return;
            var lcs = window.LANG_CARDS_ONLINE || [];
            var keeps = [], i;
            for (i = 0; i < lcs.length; i++) if (lcs[i] && cardSaveOf(lcs[i])) keeps.push(lcs[i]);
            if (!window.__LANG_CARDS_READY || !keeps.length) { wrap.style.display = "none"; box.innerHTML = ""; return; }
            keeps.sort(function (a, b) { return cardRoundOf(b) - cardRoundOf(a); });
            wrap.style.display = "block";
            box.innerHTML = keeps.map(contRowHtml).join("");
            bindCardClicks(box);
        },
        /* 当前语种中文名(英语/日语/韩语):散在各处的兜底文案用它拼,避免再写死"英语" */
        langName: function () { return LANG_TAG_INFO[curLang()][1]; },
        /* 语种相关静态文案集中改写(2026-09-22):日韩上线后页面里仍写死"英语"会误导,
           语言首页/学习中心/沉浸模式随当前语种;首页入口横幅固定宣传三语种(见 map 上方说明);新增语种只加一行 */
        applyLangCopy: function () {
            var lg = curLang();
            var C = {
                en: {
                    homeSub: "英语原生文游剧本 · 边玩边学 · 五档词汇难度随你调 · 点句即译，点词进生词本",
                    continueSub: "接着上次的英语进度玩",
                    bandSub: "玩哪档卡就学哪档词库——心里没底就从 HS / CET4 的校园生活卡起步，玩着吃力或太轻松，随时回来换一档。",
                    fullImmDesc: "纯英语体验，辅助全部手动触发"
                },
                ja: {
                    homeSub: "日语原生文游剧本 · 边玩边学 · JLPT N5-N1 词汇难度随你调 · 点句即译，点词进生词本",
                    continueSub: "接着上次的日语进度玩",
                    bandSub: "玩哪档卡就学哪档词库——心里没底就从 N5 / N4 的日常场景卡起步（假名短句也读得下去），玩着吃力或太轻松，随时回来换一档。",
                    fullImmDesc: "纯日语体验，辅助全部手动触发"
                },
                ko: {
                    homeSub: "韩语原生文游剧本 · 边玩边学 · TOPIK 初中高词汇难度随你调 · 点句即译，点词进生词本",
                    continueSub: "接着上次的韩语进度玩",
                    bandSub: "玩哪档卡就学哪档词库——心里没底就从 TOPIK 初级的生活场景卡起步（基础短句为主），玩着吃力或太轻松，随时回来换一档。",
                    fullImmDesc: "纯韩语体验，辅助全部手动触发"
                }
            }[lg] || null;
            if (!C) return;
            /* 首页入口横幅不在改写范围内(2026-09-22):它挂在首页,是语言功能的发现入口,固定宣传三语种;
               按当前语种改成"只学日语/只学韩语"会把另外两语种对首页访客藏起来。单语种文案留给语言页内部 */
            var map = { "lang-home-sub": C.homeSub, "lang-continue-sub": C.continueSub, "lang-band-sub": C.bandSub,
                "lang-imm-full-desc": C.fullImmDesc };
            for (var k in map) { var el = document.getElementById(k); if (el) el.textContent = map[k]; }
        },
        /* 剧本库标题/副标题/空态按当前语种(2026-09-19:日韩入口解锁后,空库仍写"英语剧本库"会误导) */
        renderLibMeta: function () {
            var lg = curLang(), n = LANG_TAG_INFO[lg][1], exam = lg === "ja" ? "JLPT" : "TOPIK";
            var t = $("lang-lib-title"), s = $("lang-lib-sub");
            if (t) t.textContent = lg === "en" ? "英语剧本库" : (n + "剧本库");
            if (s) s.textContent = lg === "en"
                ? "英语原生剧本：词汇难度按你的学习档走（学习中心可调），点卡即玩（第一次玩 = 英语开局）"
                : (n + "原生剧本：词汇难度按你的 " + exam + " 档走（学习中心可调），点卡即玩");
        },
        /* 空库文案(2026-09-22):原写「剧本正在制作中」是写死的进度声明,剧本早已上架时会变成假话;
           改成「持续更新中」,无论库里是 0 张还是 20 张都成立。本函数只在当前语种一张线上卡都没有时才被调用 */
        libEmptyCopy: function () {
            var lg = curLang(), n = LANG_TAG_INFO[lg][1];
            var tail = "官方剧本持续更新中，新卡上线后会出现在这里～";
            if (lg === "en") return "英语剧本库暂时没有可玩的卡——" + tail;
            return n + "剧本库暂时没有可玩的卡——" + (lg === "ja" ? "JLPT" : "TOPIK") + " 词库已就绪，" + tail;
        },
        /* 学习中心/生词本的静态文案同样按语种改写(2026-09-21:日韩上线后仍写"玩英语剧本"会误导) */
        renderLearnMeta: function () {
            // 本块看不到 LangAssist 里的 learnLangName,就地取名(同 24756 处 gLangZh 的写法)
            var n;
            try { n = { en: "英语", ja: "日语", ko: "韩语" }[curLearnLang()] || "英语"; } catch (e) { n = "英语"; }
            var s1 = $("lang-learn-stats-sub");
            if (s1) s1.textContent = "玩" + n + "剧本、复习生词都会累计学习时长";
            var s2 = $("lang-vocab-sub");
            if (s2) s2.textContent = "玩" + n + "剧本时：轻点句子看整句译文，点蓝色虚线的生词看释义——点过的词会收进这里，可在「新学 → 眼熟 → 已掌握」之间手动划。";
            /* 入口横幅/语言首页/学习档/沉浸模式同样随语种(2026-09-22) */
            try { api.applyLangCopy(); } catch (e) {}
        },
        renderLibrary: function () {
            var rows = $("lang-lib-grid"); if (!rows) return;
            var cats = $("lang-lib-cats"); if (!cats) return;
            var lcs = window.LANG_CARDS_ONLINE || [];
            api.renderLibMeta();
            /* 题材 chips(动态取自库) */
            var catSet = [], ci, cc, cat;
            for (ci = 0; ci < lcs.length; ci++) { cat = String(lcs[ci].category_zh || lcs[ci].category || ""); if (cat && catSet.indexOf(cat) < 0) catSet.push(cat); }
            var ch = '<button type="button" class="l6-chip' + (!libFilter.cat ? " active" : "") + '" onclick="LangController.setLibFilter(\'cat\',\'\')">全部题材</button>';
            for (ci = 0; ci < catSet.length; ci++) {
                cat = catSet[ci];
                ch += '<button type="button" class="l6-chip' + (libFilter.cat === cat ? " active" : "") + '" onclick="LangController.setLibFilter(\'cat\',\'' + cat.replace(/'/g, "\\'") + '\')">' + api.esc(cat) + "</button>";
            }
            cats.innerHTML = ch;
            /* 语种筛选 chips 已下线(2026-09-22):库内只有当前语种的卡,语言由「选择语言」卡切换,不在这里筛 */
            /* R1 恋爱向别 chips 高亮 + 激活时提示向别偏好已记住 */
            var gts = document.querySelectorAll("#lang-lib-genders .l6-chip"), gi;
            for (gi = 0; gi < gts.length; gi++) gts[gi].classList.toggle("active", (gts[gi].getAttribute("data-gender") || "") === libFilter.gender);
            /* 列表 */
            if (!window.__LANG_CARDS_READY) {
                rows.innerHTML = '<div class="list-sub" style="grid-column:1/-1;">剧本加载中…</div>';
                if (!window.__LANG_CARDS_LOADING) api.loadLangCards();
                return;
            }
            if (!lcs.length) { rows.innerHTML = '<div class="list-sub" style="grid-column:1/-1;">' + api.esc(api.libEmptyCopy()) + '</div>'; hint("", "lang-lib-hint"); return; }
            var list = [], i, c;
            for (i = 0; i < lcs.length; i++) {
                c = lcs[i]; if (!c || !c.id) continue;
                if (libFilter.cat && String(c.category_zh || c.category || "") !== libFilter.cat) continue;
                if (!loveFilterOk(c, libFilter.gender)) continue;
                list.push(c);
            }
            if (!list.length) {
                rows.innerHTML = '<div class="list-sub" style="grid-column:1/-1;text-align:center;">没有符合筛选的剧本——换个语种或题材看看</div>';
                hint("", "lang-lib-hint");
                return;
            }
            list.sort(function (a, b) { return (a.order || 9) - (b.order || 9); });
            rows.innerHTML = list.map(langGridCardHtml).join("");
            for (i = 0; i < list.length; i++) window.CoverService.paint("llc-cover-" + window.CoverService.safeId(list[i].id), list[i]);
            bindCardClicks(rows);
            hint(profile.band ? "" : "点卡即玩：" + api.langName() + "原生剧本，词库按你在「学习中心」选的学习档走——建议先选好档，推荐与词汇难度更贴你。", "lang-lib-hint");
        },
        /* M8c:语言卡详情弹层(封面大图 + 中英标题 + 档/题材 + 英文简介 + 主角;播放按钮从弹层进入) */
        openLangDetail: function (cid) {
            var lcs = window.LANG_CARDS_ONLINE || [], i, c = null;
            for (i = 0; i < lcs.length; i++) if (lcs[i] && String(lcs[i].id) === String(cid)) { c = lcs[i]; break; }
            if (!c) return;
            window._langDetailCid = String(c.id);
            var modal = $("lang-card-modal");
            if (!modal) return;
            modal.style.display = "flex";
            var st = (c.structured && typeof c.structured === "object") ? c.structured : {};
            var w = st.world || {};
            var idn = st.identity || {};
            var has = cardSaveOf(c), r = cardRoundOf(c);
            var heroTxt = [String(idn.role || ""), String(idn.background || "")].filter(function (x) { return x; }).join("；").slice(0, 160);
            var summary = String(w.summary || "").replace(/\s+/g, " ").trim().slice(0, 340);
            var html =
                '<div class="lgd-cover" id="lgd-cover-' + window.CoverService.safeId(c.id) + '"><img class="scc-img" alt="' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + ' 封面" loading="lazy"><span class="scc-emoji">' + (THEME_ICON[String(c.theme || "")] || "📖") + "</span></div>" +
                '<div class="lgd-title">' + api.esc(String(c.title_zh || c.title || (api.langName() + "剧本"))) + "</div>" +
                '<div class="lgd-en">' + api.esc(String(c.title || "")) + " · " + langNameOf(c) + "原生剧本</div>" +
                '<div class="lgd-badges">' +
                (loveTagOf(c) ? '<span class="scenario-badge love">' + loveTagOf(c) + "</span>" : "") +
                langBadgeOf(c) +
                '<span class="scenario-badge">' + api.esc(String(c.category_zh || c.category || "")) + "</span>" +
                '<span class="scenario-badge">' + api.esc(String(w.genre || "").slice(0, 20)) + "</span>" +
                "</div>" +
                (loveTagOf(c) ? '<div class="lgd-desc"><b>玩法：</b>恋爱攻略——5 个' + (String(c.structured.gender_target || "female") === "male" ? "可攻略女孩" : "可攻略男孩") + '等你相识、心动、走到专属结局；选项带好感影响，爱慕超过 70 会触发锁线，最后走向 HE 或 BE。</div>' : "") +
                (heroTxt ? '<div class="lgd-desc"><b>你扮演：</b>' + api.esc(heroTxt) + "</div>" : "") +
                (summary ? '<div class="lgd-desc"><b>故事预览（English）：</b>' + api.esc(summary) + "</div>" : "") +
                (has ? '<div class="lgd-desc"><b>进度：</b>已到第 ' + (r || 1) + " 轮——接着上次的英语进度玩，词库按你在「学习中心」选的学习档走。</div>" : "");
            $("lang-gd-content").innerHTML = html;
            $("lang-gd-play-btn").textContent = has ? "▶ 继续 · 第 " + (r || 1) + " 轮" : "立即游玩";
            window.CoverService.paint("lgd-cover-" + window.CoverService.safeId(c.id), c);
        },
        closeLangDetail: function () {
            var modal = $("lang-card-modal");
            if (modal) modal.style.display = "none";
            window._langDetailCid = null;
        },
        playLangDetail: function () {
            var cid = window._langDetailCid;
            api.closeLangDetail();
            if (cid) api.enterCard(cid);
        },
        enterCard: function (cid) {
            if (!window.LangEngine) { hint("英语引擎还没就绪，刷新一下再试～", "lang-lib-hint"); return; }
            window.LangEngine.enter(cid).catch(function () { hint("进入失败，请再点一次", "lang-lib-hint"); });
        },
        loadLangCards: function (lang) {
            if (window.__LANG_CARDS_LOADING) return;
            var lg = LANG_TAG_INFO[lang] ? lang : curLang();
            window.__LANG_CARDS_LOADING = true;
            fetch(API_BASE + "/api/lang/cards?lang=" + encodeURIComponent(lg))
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    // 请求期间用户又切了语种 → 丢弃这次结果,别把旧语种的卡盖上去
                    if (lg !== curLang()) { window.__LANG_CARDS_LOADING = false; return; }
                    window.LANG_CARDS_ONLINE = (d && Array.isArray(d.items)) ? d.items : [];
                    window.__LANG_CARDS_LOADING = false;
                    window.__LANG_CARDS_READY = true;
                    if (viewVisible("view-lang")) api.renderHome();
                })
                .catch(function () { window.__LANG_CARDS_LOADING = false; });
        },
        esc: function (s) {
            return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        }
    };
    window.LangController = api;
    api.init();
})();
