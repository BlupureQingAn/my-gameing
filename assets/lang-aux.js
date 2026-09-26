
/* ===== 语言文游 M4 辅助层(旁挂 play 引擎,零侵入主链):点句即译 GlossCard / 生词标色点查 WordPopover / 生词本视图 =====
   机制:①MutationObserver 盯 #play-chat-area 子级——语言会话中 AI 结构化卡挂载 → 句子 span 化(文本节点级切句,不破坏原有行内元素)
        ②词库(vocabMap∪gloss 关键表达 wordInfo)命中 → 句内词切 span.lg-word ③document 级点击委托:词→popover(自动入生词本),句→句下译卡
        ④gloss 40ms 合批 ≤10 句/批 + 内存缓存(glossCache/glossFail)防重复请求 ⑤渐进沉浸前 2 轮(scaffold):新卡整卡自动出「句下行间双语」(M9B,原 auto-expand 展开卡已删;单击句=收起/长按句=开, M9C) ⑥「我的生词本」列表+三级状态划
        M9D:词改双击查词(单击不再弹)、弹层内可从生词本移除(worker DELETE)、滚动自动关闭弹层 */
(function () {
    var PROFILE_KEY = "lang_profile_v1";
    var GLOSS_BATCH = 10;
    var API_BASE = /blupure\.cn$/i.test(location.hostname) ? location.origin : "https://ai.blupure.cn";
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
    function token() { try { return localStorage.getItem("pb_auth_token") || ""; } catch (e) { return ""; } }
    function readProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) { return {}; } }
    function langActive() { try { return !!window.LangEngine && window.LangEngine.isLangSession(); } catch (e) { return false; } }
    function roundNo() {
        try {
            var s = (typeof StateService !== "undefined") ? StateService.get() : null;
            var hs = s && s.history || [];
            return hs.filter(function (h) { return h && h.role === "user"; }).length + 1;
        } catch (e) { return 1; }
    }

    /* ---- 词库(释义总表 wordInfo:gloss 关键表达 ∪ 生词本)+ 生词本(vocabMap) ---- */
    var wordInfo = {};      // lower(w) → {w, en, zh}
    var vocabMap = {};      // lower(term) → {id,type,term,gloss_en,gloss_zh,origin,context,status,created_at}
    var vocabLoaded = false;
    var vocabLoadedFor = "";   // vocabMap 当前装的是哪个语种的词;与 curLearnLang() 不一致就要重拉
    var vocabReqSeq = 0;       // 请求令牌:切语种时旧请求可能后到,令牌对不上就丢弃(否则会把旧语种词表盖回来)
    var vocabReq = null, vocabReqFor = "";   // 在飞的请求 + 它是哪个语种的(同语种复用,避免互杀成死循环)
    var vocabErr = "";         // ""=正常;"auth"=登录态失效;"net"=其它失败。失败绝不能渲染成"还没有生词"——那是"词被删了"
    /* 生词本视图态(2026-09-21):两个 Tab 互斥渲染,不同时铺两套内容 */
    var vocabTab = "due";   // due=📆今日复习 | all=📚全部生词库
    var vocabQ = "";        // Tab2 搜索词
    var vocabSrc = "";      // Tab2 来源筛选("" = 全部)
    var vocabSt = "";       // Tab2 掌握程度筛选("" = 全部 | "0" 新学 | "1" 眼熟 | "2" 已掌握)
    var pendingCtx = "";    // 双击查词时暂存"该词所在的那句话",由 saveVocabSilent 取走
    /* 会话语种(词法层用):沿用 LangEngine 的语种判定;非语言会话/未加载时按 en(行为不变) */
    var IS_CJK_LANG = { ja: 1, ko: 1 };
    function curSessionLang() {
        try { if (window.LangEngine && window.LangEngine.targetLang) return window.LangEngine.targetLang(); } catch (e) {}
        return "en";
    }
    /* 学习工具(词测/词库/生词本/榜单)用哪个语种:在语言会话里随会话,不在会话里随语言页所选语种。
       不能用 curSessionLang:学习中心不在会话中,它只会回落到 en,日语词会被英语那套词形校验收掉。
       白名单兜底同样不能省:targetLang() 可能给出非 en/ja/ko 的值,下面词形校验/取词库都按它分叉。 */
    function curLearnLang() {
        var l = "", T = { en: 1, ja: 1, ko: 1 };
        try {
            if (window.LangEngine && window.LangEngine.isLangSession && window.LangEngine.isLangSession()
                && window.LangEngine.targetLang) l = window.LangEngine.targetLang();
        } catch (e) {}
        if (T[l]) return l;
        try { if (window.LangBandMeta && window.LangBandMeta.curLang && T[window.LangBandMeta.curLang()]) return window.LangBandMeta.curLang(); } catch (e) {}
        return "en";
    }
    /* 词形校验:拉丁语种沿用"3-12 位纯小写字母"(行为不变);日/韩按字形判、长度放宽到 1-20
       ——日语有「犬」「駅」这类单字词,韩语有「밤」这类单音节词,英语那套长度下限会把它们整批滤掉 */
    var WORD_FORM_RE = { ja: /^[ぁ-ゖァ-ヺー一-鿿々]+$/, ko: /^[가-힣]+$/ };
    function wordFormOk(w) {
        var s = String(w == null ? "" : w).trim(), lang = curLearnLang();
        if (!s) return false;
        if (IS_CJK_LANG[lang]) return s.length <= 20 && WORD_FORM_RE[lang].test(s);
        return s.length >= 3 && s.length <= 12 && /^[a-z]+$/.test(s);
    }
    /* 生词回投(嵌进正文)用:比 wordFormOk 宽一档——日语「犬」这类单字词也该能复现,故不限下限;
       英语仍要 ≥2 位且只含字母/撇号/连字符 */
    function injectableTerm(t) {
        var s = String(t == null ? "" : t).trim(), lang = curLearnLang();
        if (!s || /\s/.test(s)) return false;
        if (IS_CJK_LANG[lang]) return s.length <= 20 && WORD_FORM_RE[lang].test(s);
        return s.length >= 2 && /^[A-Za-z'\-]+$/.test(s);
    }
    /* 词干:日语削尾部送假名(食べる→食べ,高い→高),韩语去 -다(먹다→먹);名词原样返回空串 */
    function cjkStem(w, lang) {
        var s = String(w || "");
        if (!s) return "";
        if (lang === "ko") return /다$/.test(s) && s.length > 1 ? s.slice(0, -1) : "";
        return s.replace(/[ぁ-ゖー]+$/, "");
    }
    var wordRe = null, reDirty = true, wordReLang = "", wordSet = null, wordPoolN = 0, koStems = [];
    function noteWords(list, kind) {
        for (var i = 0; i < (list || []).length; i++) {
            var w = list[i];
            if (!w || !w.w) continue;
            var key = String(w.w).toLowerCase();
            var en = kind === "vocab" ? String(w.gloss_en || "") : String(w.en || "");
            var zh = kind === "vocab" ? String(w.gloss_zh || "") : String(w.zh || "");
            if (!wordInfo[key]) wordInfo[key] = { w: String(w.w), en: en, zh: zh };
            else { if (!wordInfo[key].en && en) wordInfo[key].en = en; if (!wordInfo[key].zh && zh) wordInfo[key].zh = zh; }
        }
        reDirty = true;
    }
    function buildWordRe() {
        var lang = curSessionLang(), cjk = !!IS_CJK_LANG[lang];
        if (!reDirty && wordReLang === lang) return wordRe;   // 切语种要重建(池子的收词规则不同)
        reDirty = false; wordReLang = lang;
        var terms = [], k, w;
        for (k in wordInfo) {
            if (!Object.prototype.hasOwnProperty.call(wordInfo, k)) continue;
            w = wordInfo[k].w;
            if (!w || w.length < 2 || /\s/.test(w)) continue;            // 短语(含空格)不在正文切词,走译卡 chips
            if (!cjk && /[^A-Za-z0-9'\-]/.test(w)) continue;             // 拉丁语种:非 ASCII 词形不入池
            terms.push(w);
        }
        wordPoolN = terms.length;
        if (!terms.length) { wordRe = null; wordSet = null; koStems = []; return null; }
        terms.sort(function (a, b) { return b.length - a.length; });
        if (cjk) {
            /* 日/韩没有词边界,\b 锚不住,几千分支的扫描正则也跑不动 → 改「词集 + 分词器逐词判定」。
               词集额外收词干:gloss 给的 w 是辞书形/基本形(食べる / 먹다),正文里是活用形(食べた / 먹었어요),
               靠词干把两者接上,否则金标恒不命中。 */
            wordSet = {};
            koStems = [];
            for (var t = 0; t < terms.length; t++) {
                var tk = terms[t].toLowerCase();
                if (wordSet[tk]) continue;
                wordSet[tk] = 1;
                var st = cjkStem(tk, lang);
                if (st && st !== tk) {
                    if (lang === "ko") { if (st.length >= 2) koStems.push(st); }
                    else wordSet[st] = 1;
                }
            }
            koStems.sort(function (a, b) { return b.length - a.length; });
            wordRe = null;
            return null;
        }
        wordSet = null; koStems = [];
        var src = "\\b(?:" + terms.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")\\b";
        try { wordRe = new RegExp(src, "gi"); } catch (e) { wordRe = null; }
        return wordRe;
    }
    /* 日/韩词命中:先精确,再退词干。韩语词干前缀匹配限定 ≥2 字且长度差 ≤4,
       防 하늘(天) 被 하- 类单字词干或 과- 类前缀误标成金标。 */
    function cjkHit(tok) {
        var t = String(tok || "").toLowerCase();
        if (!t || !wordSet) return false;
        if (wordSet[t]) return true;
        if (koStems.length) {
            for (var i = 0; i < koStems.length; i++) {
                var s = koStems[i];
                if (t.indexOf(s) === 0 && t.length <= s.length + 4) return true;
            }
        } else {
            if (t.length > 1 && wordSet[t.slice(0, -1)]) return true;
            if (t.length > 2 && wordSet[t.slice(0, -2)]) return true;
        }
        return false;
    }
    /* 日/韩分词:优先 Intl.Segmenter(ICU 词典切分,浏览器原生);不可用时退化为"按字形类别整段取"(仍可整段点查) */
    var segCache = {};
    function tokensOfCJK(val, lang) {
        var out = [], i, se;
        var Seg = (typeof Intl !== "undefined" && Intl.Segmenter) ? Intl.Segmenter : null;
        if (Seg) {
            se = segCache[lang] || (segCache[lang] = new Seg(lang === "ja" ? "ja" : "ko", { granularity: "word" }));
            var it = se.segment(val);
            for (var s of it) {
                if (s.segment) out.push({ t: s.segment, i: s.index, word: !!s.isWordLike });
            }
        } else {
            var re = lang === "ja" ? /[ぁ-ゖァ-ヺー一-鿿々]+/g : /[가-힣]+/g, m;
            while ((m = re.exec(val))) out.push({ t: m[0], i: m.index, word: true });
        }
        return out;
    }
    /* 生词本按语种分开装:切到日语就只能看到日语生词(小徐 2026-09-21 定)。
       vocabMap 同时也是剧情页高亮用的词表,所以它会随语言页所选语种整体换掉 —— 与词库/榜单同一口径。 */
    /* 语种中文名:本块看不到 LangPlay 那个 IIFE 里的 LANG_TAG_INFO,统一走挂 window 的 LangBandMeta
       (同 24756 处 gLangZh 的写法),拿不到时回落英语 —— 文案而已,不该让整块渲染炸掉 */
    function learnLangName() {
        try { return { en: "英语", ja: "日语", ko: "韩语" }[curLearnLang()] || "英语"; } catch (e) { return "英语"; }
    }
    function loadVocab(cb) {
        var want = curLearnLang();
        if (vocabLoaded && vocabLoadedFor === want) { if (cb) cb(); return; }
        /* 同语种已有请求在飞:直接复用,别再开一个新的。开新的会把前一个响应判成"过期"丢弃,
           而被丢弃的那次也会触发 renderLearn 再发一次请求 —— 两个请求来回互杀,
           生词本就永远停在「加载中…」(2026-09-24 线上:进生词本页 onShow 与 goVocab 各调一次
           retryVocab,vocabReset 后正好凑成这个死循环) */
        if (vocabReq && vocabReqFor === want) {
            if (cb) vocabReq.then(function () { cb(); }, function () { cb(); });
            return vocabReq;
        }
        var seq = ++vocabReqSeq;
        if (!token()) { vocabLoaded = true; vocabLoadedFor = want; vocabErr = ""; if (cb) cb(); return; }
        var p = fetch(API_BASE + "/api/lang/vocab?lang=" + encodeURIComponent(want), { headers: { "X-Auth-Token": "Bearer " + token() } })
            /* 失败必须抛出去,不能塌成 null:null 会被当成"这个语种一条词都没有",
               于是 401/500 显示成「还没有英语生词」——用户看到的就是"我的词被删了"。
               更要命的是下面会把 vocabMap 清空,连本地已有的词都跟着没。 */
            .then(function (r) {
                if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
                return r.json();
            })
            .then(function (d) {
                if (seq !== vocabReqSeq) return;   // 已被更新的请求取代:连渲染带缓存一起放弃
                if (!d || !Array.isArray(d.items)) { var e2 = new Error("bad payload"); e2.status = 0; throw e2; }
                var nm = {}, i, it, key;
                for (i = 0; i < d.items.length; i++) {
                    it = d.items[i];
                    key = String(it.term || "").toLowerCase();
                    if (key) { nm[key] = it; }
                }
                // 只标记重建,不清 wordInfo:那里还混着本局剧情注入的 gloss 表达,清掉会把正文高亮砸没。
                // 旧语种的词留在池子里无害 —— buildWordRe 按当前语种筛词形(见其 cjk 分支)。
                reDirty = true;
                vocabMap = nm;
                noteWords(d.items, "vocab");
                vocabLoaded = true;
                vocabLoadedFor = want;
                vocabErr = "";
                refreshAll();
                if (cb) cb();
            }).catch(function (err) {
                if (seq !== vocabReqSeq) return;
                /* 失败时 vocabMap 一律不动:宁可让用户继续看到上次拉到的词,也不清成空。
                   vocabLoadedFor 必须一起写 —— 只写 vocabLoaded 的话 renderLearn 会认为
                   "这个语种还没加载过",于是又发一次请求,无限循环卡在「生词加载中…」。 */
                vocabLoaded = true;
                vocabLoadedFor = want;
                vocabErr = (err && Number(err.status) === 401) ? "auth" : "net";
                if (cb) cb();
            });
        vocabReq = p;
        vocabReqFor = want;
        p.then(function () { if (vocabReq === p) { vocabReq = null; vocabReqFor = ""; } });
        return p;
    }
    /* 失败态只能由显式入口解开(点重试/进生词本页/切语种/登录):打回"没加载过"再拉一次。
       不能改成"vocabErr 时自动重拉"——MutationObserver 每 1.5s 会调一次 loadVocab,断网时会变成自转轮询。 */
    function vocabReset() { vocabErr = ""; vocabLoaded = false; vocabLoadedFor = ""; }
    function retryVocab() { vocabReset(); loadVocabNow(); }
    /* 渲染前先把要渲染的那个语种的词表拿到手:异步没回来时旧词表还在,直接渲染会闪一屏旧语种生词 */
    function loadVocabNow(cb) {
        var p = loadVocab(cb);
        if (p && p.then) { try { p.then(function () { renderLearn(); }, function () { renderLearn(); }); } catch (e) {} }
    }
    function refreshAll() {
        var k;
        for (k in sentences) {
            if (Object.prototype.hasOwnProperty.call(sentences, k)) {
                var s = sentences[k];
                if (s && !s.hDone) highlightSen(s);
            }
        }
    }

    /* ---- 句子注册表 + 切句 ---- */
    var senSeq = 0;
    var sentences = {};    // senId → sen{id,text,spans[],expanded,glossEl,gotGloss,hDone}
    var BLOCK_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, DIV: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, HR: 1 };
    function collectRuns(root) {
        var runs = [], cur = null;
        function flush() { if (cur && cur.text.trim()) runs.push(cur); cur = null; }
        function walk(el) {
            for (var i = 0; i < el.childNodes.length; i++) {
                var ch = el.childNodes[i];
                if (ch.nodeType === 3) {
                    var t = ch.nodeValue || "";
                    if (!t.length) continue;
                    if (!cur) cur = { text: "", ranges: [] };
                    cur.ranges.push({ node: ch, start: cur.text.length, end: cur.text.length + t.length });
                    cur.text += t;
                } else if (ch.nodeType === 1) {
                    var tag = ch.tagName;
                    if (tag === "BR" || ch.classList && ch.classList.contains("lg-gloss")) { flush(); continue; }
                    if (tag === "SCRIPT" || tag === "STYLE") continue;
                    if (BLOCK_TAGS[tag]) { flush(); walk(ch); flush(); }
                    else walk(ch);
                }
            }
        }
        walk(root);
        flush();
        return runs;
    }
    var ABBR = { "mr": 1, "mrs": 1, "ms": 1, "dr": 1, "st": 1, "vs": 1, "etc": 1, "e.g": 1, "i.e": 1, "no": 1, "inc": 1, "ltd": 1, "co": 1, "jr": 1, "sr": 1, "prof": 1, "capt": 1, "jan": 1, "feb": 1, "mar": 1, "apr": 1, "jun": 1, "jul": 1, "aug": 1, "sep": 1, "sept": 1, "oct": 1, "nov": 1, "dec": 1, "mt": 1, "rd": 1, "ave": 1, "approx": 1 };
    /* 日/韩切句:句读后不要求空格(日语 。！？ 后直接接下一句),故不能走拉丁那套"后随空格才算句界";
       日语用 。！？…,韩语另收英文句点(排除 3.5 这类小数点);连用省略号 …… 合并成一个句界 */
    function cutSentencesCJK(text, lang) {
        var cuts = [], s = 0, i, j, len = text.length;
        var END = lang === "ko" ? ".!?…。！？" : "。！？!?…";
        var CLOSE = "\"'”’)]}»」』）】";
        for (i = 0; i < len; i++) {
            var c = text.charAt(i);
            if (END.indexOf(c) < 0) continue;
            if (c === "." && /\d/.test(text.charAt(i - 1) || "") && /\d/.test(text.charAt(i + 1) || "")) continue;
            j = i + 1;
            while (j < len && END.indexOf(text.charAt(j)) >= 0) j++;
            while (j < len && CLOSE.indexOf(text.charAt(j)) >= 0) j++;
            while (j < len && (text.charAt(j) === " " || text.charAt(j) === "　" || text.charAt(j) === "\n")) j++;
            if (j <= s) { continue; }
            cuts.push([s, j]);
            s = j; i = j - 1;
        }
        if (s < len) cuts.push([s, len]);
        return cuts;
    }
    function cutSentences(text) {
        var _lang = curSessionLang();
        if (IS_CJK_LANG[_lang]) return cutSentencesCJK(text, _lang);
        var cuts = [], s = 0, i, j, nx, len = text.length;
        for (i = 0; i < len; i++) {
            var c = text.charAt(i);
            if (c === "." || c === "!" || c === "?" || c === "…") {
                j = i + 1;
                while (j < len && ('"\'”’)]}»'.indexOf(text.charAt(j)) >= 0)) j++;
                if (j >= len) { cuts.push([s, j]); return cuts; }
                if (/\s/.test(text.charAt(j))) {
                    nx = j; while (nx < len && /\s/.test(text.charAt(nx))) nx++;
                    if (nx < len && /[a-z0-9,;:（]/.test(text.charAt(nx))) { i = j - 1; continue; }   // 后随小写 → 缩写尾巴,非句界
                    if (c === ".") {   // 常见缩写表豁免
                        var ws = text.lastIndexOf(" ", i - 1) + 1;
                        if (ws < s) ws = s;
                        var tail = text.slice(ws, i + 1).replace(/[^A-Za-z.]/g, "").toLowerCase();
                        if (ABBR[tail]) { i = j - 1; continue; }
                    }
                    cuts.push([s, j]);
                    s = j;
                    i = j - 1;
                }
            }
        }
        if (s < len) cuts.push([s, len]);
        return cuts;
    }
    function wrapNode(node, parts) {
        var parent = node.parentNode;
        if (!parent) return;
        var frag = document.createDocumentFragment();
        var pos = 0, val = node.nodeValue || "";
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p.s > pos) frag.appendChild(document.createTextNode(val.slice(pos, p.s)));
            var span = document.createElement("span");
            span.className = "lg-sentence";
            span.setAttribute("data-sen", p.senId);
            span.appendChild(document.createTextNode(val.slice(p.s, p.e)));
            frag.appendChild(span);
            var sen = sentences[p.senId];
            if (sen) sen.spans.push(span);
            pos = p.e;
        }
        if (pos < val.length) frag.appendChild(document.createTextNode(val.slice(pos)));
        parent.replaceChild(frag, node);
    }

    /* ---- 无阻畅读计量(2026-09-21) ----
       口径:一句话必须在视口里停留 ≥700ms 才算"读了";期间只要开过译文(sen.expanded)或双击查过生词,
       这句就不计入。结算发生在句子离屏/离 DOM 时——那时它身上该有的提示手势都已经记下了。
       挂机无效:没进过视口、或停留不到 700ms 就滚走的句子一个字都不算。攒够 60s 上报一次。 */
    var lgImm = (function () {
        var acc = 0, pending = [], io = null, VISIT_MS = 700, FLUSH_CHARS = 400;
        function units(lang, text) {
            var s = String(text || "");
            if ((lang || "en") === "en") return s.split(/\s+/).filter(Boolean).length;
            return (s.match(/[^\s]/g) || []).length;   // 日/韩按字计,与前端切句/排行榜单位一致
        }
        function settle(sen) {
            if (!sen || !sen.immAt || sen.immDone) return;
            var stayed = Date.now() - sen.immAt;
            var ok = !sen.expanded && !sen.hinted && stayed >= VISIT_MS;
            sen.immAt = 0; sen.immDone = true;
            if (ok) acc += units(curLearnLang(), sen.text);
        }
        function ensureIO() {
            if (io || typeof IntersectionObserver !== "function") return io;
            io = new IntersectionObserver(function (es) {
                for (var i = 0; i < es.length; i++) {
                    var e = es[i], sen = sentences[Number(e.target.getAttribute("data-sen"))];
                    if (!sen) continue;
                    if (e.isIntersecting && e.intersectionRatio >= 0.5) { if (!sen.immAt) sen.immAt = Date.now(); }
                    else settle(sen);
                }
            }, { threshold: [0, 0.5, 1] });
            return io;
        }
        return {
            // attachStory 每挂一章调一次:给这一章的句子登记可见性观察
            observe: function (sens) {
                var ob = ensureIO();
                for (var i = 0; i < sens.length; i++) {
                    var sen = sens[i];
                    if (!ob || !sen || !sen.spans.length || !sen.spans[0]) continue;
                    sen.hinted = false; sen.immAt = 0; sen.immDone = false;
                    try { ob.observe(sen.spans[0]); } catch (e) { sen.immAt = Date.now(); }   // 无 IO 时退化为"悬挂即算",仍受 hinted 约束
                }
            },
            // 双击查词时由点击委托调用:这句被"提示"过了
            hint: function (sen) { if (sen) sen.hinted = true; },
            /* 节点从 DOM 摘除时必须显式解绑:IntersectionObserver 对已移除元素不会自动复位,
               会一直持有引用;sentences 表也只增不减(tick 每轮线性扫全表)。 */
            release: function (els) {
                for (var i = 0; i < els.length; i++) {
                    var el = els[i];
                    if (!el || !el.getAttribute) continue;
                    var id = Number(el.getAttribute("data-sen"));
                    var sen = sentences[id];
                    if (!sen) continue;
                    settle(sen);   // 先按既有语义结算(够时长且没开译文才计入),再释放
                    if (io) { try { io.unobserve(el); } catch (e) {} }
                    delete sentences[id];
                }
            },
            // 定时器里调用:结算已经从 DOM 上摘掉的句子(离屏回调在节点移除时不可靠),并按需上报
            tick: function (force) {
                for (var k in sentences) {
                    if (!Object.prototype.hasOwnProperty.call(sentences, k)) continue;
                    var sen = sentences[k];
                    if (!sen) continue;
                    var el = sen.spans && sen.spans[0];
                    // 已脱离 DOM(重绘/换卡/关弹层都走这条)——结算后解绑并删表项。
                    // chatMo 那条路只在语言会话里生效,这里兜住"非语言会话时清空 board"等漏网场景。
                    if (el && !el.parentNode) {
                        settle(sen);
                        if (io) { try { io.unobserve(el); } catch (e) {} }
                        delete sentences[k];
                        continue;
                    }
                    if (!sen.immAt) continue;
                    if (force) settle(sen);
                }
                if (acc >= FLUSH_CHARS) lgImm.flush();
            },
            flush: function () {
                var n = Math.floor(acc);
                if (n < 1) return;
                var t = token();
                if (!t) { acc = 0; return; }               // 游客不计
                fetch(API_BASE + "/api/lang/immersive", {
                    method: "PUT", headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + t },
                    body: JSON.stringify({ lang: curLearnLang(), chars: Math.min(n, 3000) })
                }).then(function (r) { if (r.ok) { acc -= n; if (acc < 0) acc = 0; } }).catch(function () {});
            }
        };
    })();
    /* 新手引导:首次语言卡播放教两个手势(双击查词/长按译句)。localStorage 一次即终身;会话级去重;6s 自动关或点按关闭 */
    var gGestureShown = false;
    function showGestureGuide() {
        try {
            if (document.getElementById("lgGestureGuide")) return;
            var card = document.createElement("div");
            card.id = "lgGestureGuide";
            card.className = "lg-toast";
            var gLangZh = "英语";
            try { gLangZh = { en: "英语", ja: "日语", ko: "韩语" }[window.LangBandMeta.curLang()] || "英语"; } catch (e) {}
            card.innerHTML = '<div class="lg-toast-t">' + uiIconHtml("📖") + ' 玩' + gLangZh + '剧本小技巧</div>'
                + '<div>' + uiIconHtml("👆") + ' <b>长按</b>' + gLangZh + '句子/选项 → 看整句翻译</div>'
                + '<div>' + uiIconHtml("👆") + ' <b>双击</b>单词 → 查词典 / 收藏生词</div>'
                + '<div class="lg-toast-sub">点一下这条提示即可关闭</div>';
            var closeGuide = function () { try { if (card.parentNode) card.parentNode.removeChild(card); } catch (e) {} };
            card.addEventListener("pointerdown", function (e) {
                e.stopPropagation();
                try { e.preventDefault(); } catch (e2) {}
                closeGuide();
            }, true);
            document.body.appendChild(card);
            setTimeout(closeGuide, 6500);
        } catch (e) {}
    }

    function attachStory(st) {
        if (!st || st.dataset.lgDone) return;
        st.dataset.lgDone = "1";
        ensureChWords();   // M6d4:先于切词执行——开局预载卡档词库、换章重抽候选,保证本章正文标记/seen 用当前候选
        var runs = collectRuns(st);
        if (!runs.length) return;
        var cardSens = [], nodeList = [];
        function partsFor(node) {
            for (var i = 0; i < nodeList.length; i++) if (nodeList[i].node === node) return nodeList[i];
            var e = { node: node, parts: [] };
            nodeList.push(e);
            return e;
        }
        for (var r = 0; r < runs.length; r++) {
            var run = runs[r];
            var cuts = cutSentences(run.text);
            for (var ci = 0; ci < cuts.length; ci++) {
                var cs = cuts[ci][0], ce = cuts[ci][1];
                if (ce - cs < 1) continue;
                var t = run.text.slice(cs, ce).replace(/\s+/g, " ").trim();
                if (!t) continue;
                var id = ++senSeq;
                var sen = { id: id, text: t, spans: [], expanded: false, glossEl: null, gotGloss: false, hDone: false };
                sentences[id] = sen;
                cardSens.push(sen);
                for (var m = 0; m < run.ranges.length; m++) {
                    var rg = run.ranges[m];
                    var o1 = Math.max(rg.start, cs), o2 = Math.min(rg.end, ce);
                    if (o2 <= o1) continue;
                    partsFor(rg.node).parts.push({ s: o1 - rg.start, e: o2 - rg.start, senId: id });
                }
            }
        }
        for (var n = 0; n < nodeList.length; n++) wrapNode(nodeList[n].node, nodeList[n].parts);
        lgImm.observe(cardSens);   // 无阻畅读:登记本章句子的可见性观察
        /* M9F:双语随卡(开场/渐进前两轮)先烘烤:词注先行入池 + glossCache 预填 → scaffold 展开即时行间译文,零点译 AI;
           miss 句不标 glossFail,留待下方 queueGloss 兜底 */
        try {
            var _bik = (typeof WeakMap !== "undefined") ? biByStory.get(st) : null;
            if (!_bik) _bik = fromB64Safe(st.getAttribute("data-bi"));
            if (_bik && Array.isArray(_bik.lines)) bakeCardBi(cardSens, _bik.lines);
        } catch (e) {}
        /* 词源就绪先切一遍(vocab 已加载时;双语词注已入池 → 一次包词) */
        if (vocabLoaded) refreshCardSens(cardSens);
        /* M7a/M9B 渐进沉浸状态机 scaffold 阶段:整卡自动出句下行间双语(interlinear)——仅登录用户、≤10 句自动,其余长按再看;
           原 auto-expand 展开卡形态已删(2026-09-06);阶段判定与生成侧共用 LangEngine.immStage
           2026-09-13:自动展开只铺"已烘烤好的译文",未命中一律不展开也不发 AI——原先 miss 走 queueGloss 兜底,
           会让用户"没点过的句子也批量生成译文"(小徐报:只长按一句,开场前几句却一起出译文),违背零点译 AI 的设计 */
        var immStg = null;
        try { immStg = window.LangEngine && LangEngine.immStage ? LangEngine.immStage(roundNo()) : null; } catch (e) { immStg = null; }
        if (token() && cardSens.length && immStg && immStg.mode === "scaffold") {
            for (var a = 0; a < cardSens.length && a < GLOSS_BATCH; a++) {
                var as = cardSens[a];
                var ac = glossCache[as.text];
                if (!ac || !ac.zh) continue;   // 无预烤译文:留给用户长按,不主动生成
                as.expanded = true;
                fillGloss(as);
            }
        }
        /* M5 章末复盘入口:每 5 轮一小章,本轮卡尾挂轻量入口条(st.lgDone 保证每卡仅一次) */
        var rn = roundNo();
        if (rn === 1) sessionWords = {};   // 新会话开局:清空本局点查词(重新累积)
        if (rn >= 5 && rn % 5 === 0) {
            if (!st.querySelector(".lg-recap-entry")) {
                var ce = document.createElement("div");
                ce.className = "lg-recap-entry";
                ce.setAttribute("data-act", "recap-open");
                ce.innerHTML = uiIconHtml("📋") + " 第 " + Math.floor(rn / 5) + " 章小结 · 看看这 5 轮你学到啥 →";
                st.appendChild(ce);
            }
        }
        /* 新手引导触发:首次卡挂载完成(句子/词已切、双语已铺),给一次手势教学 */
        if (!gGestureShown && cardSens.length) {
            gGestureShown = true;
            try {
                if (!localStorage.getItem("lg_gesture_guide_v1")) {
                    localStorage.setItem("lg_gesture_guide_v1", "1");
                    setTimeout(showGestureGuide, 600);
                }
            } catch (e) {}
        }
    }
    function refreshCardSens(list) { for (var i = 0; i < list.length; i++) highlightSen(list[i]); }

    /* ---- M9F 双语随卡烘烤:官方开场/渐进第 2 轮起 AI 携带的 bilingual 逐句译文+词注,
          直接预填 glossCache(行间译文零 AI 即时出),历史重放经 data-bi 属性还原 ---- */
    var biByStory = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    function nrmBi(s) {
        return String(s || "").replace(/\s+/g, " ").trim()
            .replace(/[‘’ʼ′]/g, "'")
            .replace(/[“”«»]/g, '"')
            .replace(/–/g, "—");
    }
    function b64Encode(s) {
        try { return btoa(unescape(encodeURIComponent(String(s)))); } catch (e) { return ""; }
    }
    function fromB64Safe(s) {
        if (!s) return null;
        try { return JSON.parse(decodeURIComponent(escape(atob(String(s))))); } catch (e) { return null; }
    }
    function bakeCardBi(cardSens, lines) {
        var li = 0, hit = 0;
        for (var i = 0; i < cardSens.length; i++) {
            var sen = cardSens[i];
            if (glossCache[sen.text]) continue;
            var t = nrmBi(sen.text);
            if (!t) continue;
            var k = -1;
            for (var j = li; j < lines.length && j - li <= 1; j++) {   // 顺序双指针:优先当前行,前向容错 1 行(AI 偶漏报句)
                if (!lines[j] || !lines[j].en) continue;
                if (nrmBi(lines[j].en) === t) { k = j; break; }
            }
            if (k < 0) continue;
            var L = lines[k];
            li = k + 1;
            hit++;
            var words = Array.isArray(L.words) ? L.words.filter(function (w) { return w && w.w; }) : [];
            glossCache[sen.text] = { zh: String(L.zh || "").trim(), words: words };
            sen.gotGloss = true;
            noteWords(words, "gloss");
        }
        return hit;
    }
    /* 渲染方(mount 后)先写 data-bi 属性(须在 mountedHtml 快照之前调用)→ 历史重放可还原双语;只写属性,不切句不动 DOM */
    function attachBiAttr(node, bi) {
        if (!node || !bi || typeof bi !== "object" || !Array.isArray(bi.lines)) return null;
        var st = (node.querySelector && node.querySelector(".card-story")) || node;
        if (!st || st.nodeType !== 1) return null;
        try { st.setAttribute("data-bi", b64Encode(JSON.stringify({ v: 1, lines: bi.lines }))); } catch (e) {}
        return st;
    }
    /* 注册双语并立即烘烤(须在 DOM 挂好且 mountedHtml 快照之后);mutation tryAttach 见 lgDone 幂等跳过 */
    function attachStoryBi(node, bi) {
        var st = attachBiAttr(node, bi);
        if (!st) return null;
        if (biByStory) { try { biByStory.set(st, bi); } catch (e) {} }
        if (!st.dataset.lgDone) attachStory(st);
        return st;
    }

    /* ---- M6d4 剧情嵌词:每章开局从卡档词库抽候选词 ≤3 注入续写指令;正文词形命中 → 金标 + 记 seen ----
       词状态机起点:unknown → seen(剧情自然遇见/点查过);seen 按档持久(lang_seen_v1),
       候选优先级:本档未 seen 优先,不足补已 seen 复习;weak/learned 等 M6d5 lang_bank_progress 落库 */
    var SEEN_KEY = "lang_seen_v1";
    var seenCache = null;
    var PROG_KEY = "lang_prog_v1";    // M6d5:词态服务端镜像(本地缓存,启动免拉)
    var PROG_PEND_KEY = "lang_prog_pend_v1";   // 提交失败的待同步队列 [{band,word,ok}]
    var progByBand = {};              // band -> {word: {state,ok,fail,up}}  weak 词=隔章重测优先
    var progLoading = {};             // band -> bool(防并发)
    var chWords = { no: -1, band: "", list: [], words: [], ready: false, pushed: false };   // no=章号(每5轮), words 带 zh 供 M6d5 小测
    var chSeen = [];                                                           // 本章嵌词命中清单 {w,zh,at}(M6d5 章末词测数据源)
    var chExpan = {};                                                          // 本章 token→原形 反查表
    var STOPW = {};
    (function () { var ws = "i,you,he,she,it,we,they,this,that,these,those,a,an,the,and,or,but,not,no,yes,is,am,are,was,were,be,been,being,do,does,did,done,doing,have,has,had,having,will,would,shall,should,can,could,may,might,must,of,in,on,at,to,for,with,by,from,up,down,off,over,under,again,then,there,here,when,where,why,how,all,any,each,every,both,few,more,most,other,some,such,only,own,same,so,than,too,very,just,because,if,about,into,out,as,after,before,between,during,without,through,while,once,since,until,whether,although,though,even,also,too,what,which,who,whom,whose,my,your,his,her,its,our,their,me,him,us,them,one,two,first,second,per,via,etc,upon,toward,towards,onto,within,among,against,along,across,behind,beside,beyond,below,above,near,far,ago,ever,never,always,often,sometimes,usually,already,still,yet,maybe,perhaps,indeed,rather,quite,almost,nearly,however,therefore,thus,hence,then,else,neither,either,nor,none,nothing,everything,something,anything,everybody,everyone,nobody,noone,someone,anybody,anyone,please,ok,okay,oh,ah,well,hmm,yeah,yes,sir,maam".split(","); for (var i = 0; i < ws.length; i++) STOPW[ws[i]] = 1; })();
    var POS_NO_RE = /^(?:aux|prep|conj|pron|art|int|num|modal|det)\./;
    var POS_OK_RE = /^(?:vt|vi|v|n|adj|ad|adv|a|d)\./;
    function loadSeen() {
        if (seenCache) return seenCache;
        try { seenCache = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (e) { seenCache = {}; }
        if (typeof seenCache !== "object") seenCache = {};
        return seenCache;
    }
    function markSeenWord(band, w) {
        if (!band || !w) return false;
        var s = loadSeen();
        var b = s[band] || (s[band] = {});
        if (b[w]) return false;
        b[w] = Date.now();
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {}
        return true;
    }
    function noteChSeen(w) {
        for (var i = 0; i < chSeen.length; i++) if (chSeen[i].w === w) return;
        var zh = "";
        for (var j = 0; j < chWords.words.length; j++) if (chWords.words[j].w === w) { zh = chWords.words[j].zh; break; }
        chSeen.push({ w: w, zh: zh, at: Date.now() });
    }
    function bandChapterNo() { return Math.max(1, Math.floor((roundNo() - 1) / 5) + 1); }
    function goodPos(zh) {
        var s = String(zh || "").trim();
        if (!s) return false;
        if (POS_NO_RE.test(s)) return false;
        if (POS_OK_RE.test(s)) return true;
        return !/^[a-z]+\./.test(s);   // ky 等无词性前缀源:非词性标记开头即视为可嵌
    }
    function drawWords(band) {
        var items = langBankCache[band];
        if (!items || !items.length) return [];
        var seen = loadSeen()[band] || {};
        var prog = progByBand[band] || {};
        var fresh = [], weak = [], old = [], i, it, w;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            w = it.w;
            if (!wordFormOk(w)) continue;
            if (STOPW[w]) continue;
            if (!goodPos(it.zh || "")) continue;
            if (!seen[w]) fresh.push(it);
            else if (prog[w] && prog[w].state === "weak") weak.push(it);   // M6d5:答错弱词 → 隔章优先重测
            else old.push(it);
        }
        function rndTake(arr, n) {
            var a = arr.slice(), out = [], k, r;
            for (k = 0; k < n && a.length; k++) { r = Math.floor(Math.random() * a.length); out.push(a[r]); a.splice(r, 1); }
            return out;
        }
        var want = 3, picks = [];
        picks = rndTake(fresh, want);                                   // 本档未 seen 优先
        if (picks.length < want) picks = picks.concat(rndTake(weak, want - picks.length));   // 弱词复习
        if (picks.length < want) picks = picks.concat(rndTake(old, want - picks.length));    // 已 seen 兜底
        return picks;
    }
    function rebuildExpan(band) {
        chExpan = {};
        var i, w, it, al, j;
        for (i = 0; i < chWords.list.length; i++) {
            w = chWords.list[i];
            chExpan[w] = w;
            it = langBankItem(band, w);
            al = it && it.al;
            if (al) for (j = 0; j < al.length; j++) if (!chExpan[al[j]]) chExpan[al[j]] = w;
        }
    }
    function ensureChWords() {
        var band = currentLangBand();
        var no = bandChapterNo();
        if (chWords.no === no && chWords.band === band && chWords.ready) return chWords.list;
        if (chWords.no !== no || chWords.band !== band) { chWords = { no: no, band: band, list: [], words: [], ready: false, pushed: false }; chSeen = []; }   // 换章/换档:旧章命中清单作废
        if (!langBankCache[band]) {
            if (!langBankLoading[band]) loadLangBank(band);   // fire:开局/换章即预载词库,保证注入前 ready
            return [];
        }
        if (token() && !progByBand[band] && !progLoading[band]) loadProg(band);   // M6d5:弱词状态拉到本地,注入前可回池(异步兜底 afterProgReload)
        chWords.ready = true;
        var picks = drawWords(band);
        chWords.list = picks.map(function (p) { return String(p.w).toLowerCase(); });
        chWords.words = picks.map(function (p) { return { w: String(p.w).toLowerCase(), zh: String(p.zh || "").slice(0, 80) }; });
        rebuildExpan(band);
        return chWords.list;
    }
    /* ---- M6d5:词态进度(服务端 lang_bank_progress 镜像 + 失败重试队列) ---- */
    function readProgLocal() {
        try { return JSON.parse(localStorage.getItem(PROG_KEY) || "{}") || {}; } catch (e) { return {}; }
    }
    function writeProgLocal() { try { localStorage.setItem(PROG_KEY, JSON.stringify(progByBand)); } catch (e) {} }
    function loadProg(band, cb) {
        if (!token() || !band) return;
        if (progLoading[band]) return;
        var cached = readProgLocal()[band];
        if (cached) { progByBand[band] = cached; if (cb) cb(); }
        progLoading[band] = true;
        fetch(API_BASE + "/api/lang/progress?band=" + encodeURIComponent(band), { headers: { "X-Auth-Token": "Bearer " + token() } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                progLoading[band] = false;
                var nm = {};
                if (d && d.items) for (var i = 0; i < d.items.length; i++) {
                    var it = d.items[i];
                    nm[String(it.word).toLowerCase()] = { state: String(it.state || "seen"), ok: Number(it.ok_count || 0), fail: Number(it.fail_count || 0), up: it.updated_at || "" };
                }
                progByBand[band] = nm;
                writeProgLocal();
                flushPendingProg(band);
                afterProgReload(band);   // 弱词回池:本章尚未注入则重抽(隔章重测闭环)
                if (cb) cb();
            })
            .catch(function () { progLoading[band] = false; if (cb) cb(); });
    }
    function flushPendingProg(band) {
        var arr = [];
        try { arr = JSON.parse(localStorage.getItem(PROG_PEND_KEY) || "[]") || []; } catch (e) {}
        var pend = arr.filter(function (p) { return p && p.band === band; });
        if (!pend.length) return;
        fetch(API_BASE + "/api/lang/progress", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ band: band, items: pend.map(function (p) { return { word: p.word, ok: p.ok }; }) })
        })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.ok) return;
                try { localStorage.setItem(PROG_PEND_KEY, JSON.stringify(arr.filter(function (p) { return p.band !== band; }))); } catch (e) {}
            }).catch(function () {});
    }
    function pushProgPending(band, word, ok) {
        var arr = [];
        try { arr = JSON.parse(localStorage.getItem(PROG_PEND_KEY) || "[]") || []; } catch (e) {}
        arr.push({ band: band, word: word, ok: ok });
        try { localStorage.setItem(PROG_PEND_KEY, JSON.stringify(arr.slice(-200))); } catch (e) {}
    }
    function progStateOf(band, w) { var b = progByBand[band]; return (b && b[w]) ? b[w].state : ""; }
    function isLearned(band, w) { return progStateOf(band, w) === "learned"; }
    function applyProgResult(band, word, state) {   // 词测提交成功后的本地落位
        var b = progByBand[band] || (progByBand[band] = {});
        var old = b[word] || { ok: 0, fail: 0 };
        if (state === "learned") old.ok += 1; else if (state === "weak") old.fail += 1;
        old.state = state;
        old.up = new Date().toISOString().slice(0, 19).replace("T", " ");
        b[word] = old;
        writeProgLocal();
    }
    function afterProgReload(band) {
        try {
            if (chWords.band !== band || !chWords.ready || chWords.pushed) return;
            if (chWords.no !== bandChapterNo()) return;
            var p = drawWords(band);
            if (!p.length) return;
            chWords.list = p.map(function (x) { return String(x.w).toLowerCase(); });
            chWords.words = p.map(function (x) { return { w: String(x.w).toLowerCase(), zh: String(x.zh || "").slice(0, 80) }; });
            chSeen = [];
            rebuildExpan(band);
        } catch (e) {}
    }
    /* token → 本章候选原形(exact / ECDICT 词形 al / 尾 's 与简单复数兜底),未命中 null */
    function chapterOwnerOf(tok) {
        if (!chWords.ready || !chWords.list.length) return null;
        var t = String(tok).toLowerCase();
        if (chExpan[t]) return chExpan[t];
        if (t.length > 4 && /'s$/.test(t)) { var s1 = t.slice(0, -2); if (chExpan[s1]) return chExpan[s1]; }
        if (t.length > 4 && /[^s]s$/.test(t)) { var s2 = t.slice(0, -1); if (chExpan[s2]) return chExpan[s2]; }
        return null;
    }
    function getChapterWords() { var l = ensureChWords(); if (l && l.length) chWords.pushed = true; return l; }   // 注入即推送:prog 迟到不再换词


    var WORD_TOK = /[A-Za-z][A-Za-z0-9'’-]*/g;
    var CJK_TOKEN_RE = { ja: /[ぁ-ゖァ-ヺー一-鿿々]/, ko: /[가-힣]/ };
    /* 一个词该不该划虚线:词池(生词本∪gloss 关键表达)命中,**或用户当前那档考纲词库收了这个词**。
       小徐 2026-09-26:只要是用户词库(高考/CET4…)里的单词就该标出来。
       词库这半边直连点查用的同一套表 —— langBankItem 的小写表(拉丁)/ bankLookupCJK 的词干回查(日/韩),
       免得「点得出来」和「看得出」两处判定各判各的、慢慢漂开。
       band 传空串＝词库还没载,一律不算命中:先标满再回退会闪,不如等词库到了再补标(见 flushPendSens)。 */
    /* 词库那半边的频次下界(2026-09-26)。frq 是词频排名:a=5 / ability=783 / abandon=2182,
       越小越常见。词库里连 the/a/and/at 都收着,而旧口径是"在库就划"——一段普通剧情能被划掉
       一半的词,满屏虚线反而没有提示作用(小徐 2026-09-26「泛滥无分级」)。取 1000:实测
       CET4 词库 p10=492、p25=1271,这个下界砍掉的正是"不该再提示你"的那一档。
       日/韩词库整档没有 frq(实测 ja-n3 / ko-2 全为 0),拿不到就维持原样 ——
       不能因为缺字段把这两个语种的标注全丢掉。 */
    var BANK_FRQ_MIN = 1000;
    /* 这个 token 在生词本里的状态;-1 = 不在生词本(可能只是词池里的表达) */
    function poolStatusOf(tok) {
        var it = vocabMap[String(tok || "").toLowerCase()];
        return it ? (Number(it.status) || 0) : -1;
    }
    function wordHit(tok, re, cjk, band) {
        var mine = false;
        if (cjk) { if (cjkHit(tok)) mine = true; }
        else if (re) {
            re.lastIndex = 0;
            var hm = re.exec(tok);
            if (hm && hm[0].toLowerCase() === tok.toLowerCase()) mine = true;
        }
        /* 自己的词:已掌握(status>=2)的不再划虚线。注意只是不划,仍然可点查 ——
           虚线是"提醒你注意",已经掌握的词一直提醒只会让提醒贬值(小徐 2026-09-26)。 */
        if (mine) return poolStatusOf(tok) < 2;
        if (!band) return false;
        var bit = cjk ? bankLookupCJK(band, tok) : langBankItem(band, tok);
        if (!bit) return false;
        var frq = Number(bit.frq);
        if (frq > 0 && frq < BANK_FRQ_MIN) return false;
        return true;
    }
    function wrapWords(span) {
        var re = buildWordRe();
        var lang = curSessionLang(), cjk = !!IS_CJK_LANG[lang];
        /* 档位在这里解一次就够:currentLangBand() 要读 profile、还要问选中的卡,
           放进按词的循环里会让切句慢一个量级。 */
        var band = currentLangBand();
        if (!langBankCache[band]) band = "";
        var kids = [], i, j, node;
        for (i = 0; i < span.childNodes.length; i++) kids.push(span.childNodes[i]);
        for (i = 0; i < kids.length; i++) {
            node = kids[i];
            if (node.nodeType !== 3) continue;
            var val = node.nodeValue || "";
            if (!val) continue;
            var frag = document.createDocumentFragment(), pos = 0, m, toks = [];
            if (cjk) {
                toks = tokensOfCJK(val, lang);
            } else {
                WORD_TOK.lastIndex = 0;
                while ((m = WORD_TOK.exec(val))) toks.push({ t: m[0], i: m.index, word: true });
            }
            for (var ti = 0; ti < toks.length; ti++) {
                var tok = String(toks[ti].t || ""), at = toks[ti].i;
                // 标点/空白/拉丁人名:不包 span 也不推 pos,交给下一段的 slice 原样输出
                if (!tok || !toks[ti].word) continue;
                if (cjk && !CJK_TOKEN_RE[lang].test(tok)) continue;
                if (at > pos) frag.appendChild(document.createTextNode(val.slice(pos, at)));
                var hit = wordHit(tok, re, cjk, band);
                var sp = document.createElement("span");
                sp.className = hit ? "lg-word" : "lg-w";
                sp.setAttribute("data-w", tok);
                /* M6d4:候选词词形命中 → 金标;点查徽标/释义走原有词库逻辑 */
                var cw = chapterOwnerOf(tok);
                if (cw) { sp.className += " lg-ch"; markSeenWord(chWords.band, cw); noteChSeen(cw); }
                sp.appendChild(document.createTextNode(tok));
                frag.appendChild(sp);
                pos = at + tok.length;
            }
            if (pos < val.length) frag.appendChild(document.createTextNode(val.slice(pos)));
            span.replaceChild(frag, node);
        }
        /* 这一段可能上一轮就切过了(词库是异步后到的),那一轮没有词库可判,全落成了 .lg-w。
           wrapWords 对文本节点是幂等的(只切 textNode,已包的 span 不再进),所以不会重复包词,
           但也就永远不会回头看那些 .lg-w —— 不补这一步,词库到货后虚线一个都不会亮。
           只升格 .lg-w → .lg-word,不动 .lg-ch(金标另有来源,别在这里抢)。 */
        var olds = span.querySelectorAll ? span.querySelectorAll(".lg-w") : [];
        for (var oi = 0; oi < olds.length; oi++) {
            if (wordHit(olds[oi].getAttribute("data-w") || "", re, cjk, band)) {
                olds[oi].className = olds[oi].className.replace(/\blg-w\b/, "lg-word");
            }
        }
    }
    var pendSens = [];   // M6d3 补:M6d4 词库兜底切词——词池词库皆空时挂起,词库到后补切(非登录也能全词点查)
    function queuePendSen(sen) {
        for (var i = 0; i < pendSens.length; i++) if (pendSens[i] === sen) return;
        pendSens.push(sen);
    }
    function flushPendSens() {
        var a = pendSens; pendSens = [];
        for (var i = 0; i < a.length; i++) if (a[i] && !a[i].hDone) highlightSen(a[i]);
        /* 考纲词库异步到货,而句子通常更早切完(hDone=true,上面那条循环管不到它们)。
           重跑一遍 wrapWords,把已切好的 .lg-w 按新词库升格成 .lg-word。
           本函数的调用方只有 loadLangBank 的两条到货路径(本地缓存命中 / 网络返回),所以补标挂这儿。 */
        for (var k in sentences) {
            if (!Object.prototype.hasOwnProperty.call(sentences, k)) continue;
            var s = sentences[k];
            if (!s || !s.hDone) continue;
            for (var j = 0; j < s.spans.length; j++) { var sp = s.spans[j]; if (sp && sp.parentNode) wrapWords(sp); }
        }
    }
    function highlightSen(sen) {
        if (!sen || sen.hDone) return;
        buildWordRe();
        if (!wordRe && !wordPoolN) {                      // 词池空:词库已载则以词库兜底切(全 .lg-w 仍可点查),皆无则挂起
            if (langBankCache[currentLangBand()]) { /* fall through:词库兜底切词 */ }
            else { queuePendSen(sen); return; }
        }
        for (var i = 0; i < sen.spans.length; i++) {
            var sp = sen.spans[i];
            if (sp && sp.parentNode) wrapWords(sp);
        }
        sen.hDone = true;
    }

    /* ---- gloss 缓存 + 合批 ---- */
    var glossCache = {};    // 句文本 → {zh, words}
    var glossFail = {};     // 句文本 → true
    var glossBlocked = false;   // M7c:当日点译额度用尽(worker 429 GLOSS_DAILY_LIMIT),句下译卡改显专属提示
    var glossCoinMsg = "";      // 2026-09-08:超限且云币不足(402 INSUFFICIENT_COIN),显示服务端引导文案;P1 附小额救急包 CTA
    var batchQueue = [], batchTimer = null, batchBusy = false;
    function queueGloss(arr) {
        var need = [], i, s;
        for (i = 0; i < arr.length; i++) {
            s = arr[i];
            if (!s || s.inFlight) continue;
            if (glossCache[s.text] || glossFail[s.text]) continue;
            s.inFlight = true;
            need.push(s);
        }
        if (!need.length) return;
        batchQueue = batchQueue.concat(need);
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(flushBatch, 40);
    }
    function flushBatch() {
        batchTimer = null;
        if (batchBusy || !batchQueue.length) return;
        var take = batchQueue.splice(0, GLOSS_BATCH);
        batchBusy = true;
        fetch(API_BASE + "/api/lang/gloss", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ sentences: take.map(function (s) { return s.text.slice(0, 500); }), lang: curSessionLang() })
        })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                if (d && d.code === "GLOSS_DAILY_LIMIT") glossBlocked = true;   // M7c:日配额用尽(明天 08:00 刷新)
                else if (d && d.code === "INSUFFICIENT_COIN") { glossBlocked = true; glossCoinMsg = String(d.error || ""); }  // 2026-09-08:超限云币续用但余额不足(402)
                var ok = !!(d && d.ok && Array.isArray(d.items));
                for (var i = 0; i < take.length; i++) {
                    var s = take[i];
                    delete s.inFlight;
                    if (ok && d.items[i] && d.items[i].zh) okGloss(s, { zh: String(d.items[i].zh), words: d.items[i].words || [] });
                    else { glossFail[s.text] = true; if (s.expanded) fillGloss(s); }
                }
            })
            .catch(function () {
                for (var i = 0; i < take.length; i++) {
                    var s = take[i];
                    delete s.inFlight;
                    glossFail[s.text] = true;
                    if (s.expanded) fillGloss(s);
                }
            })
            .then(function () {
                batchBusy = false;
                if (batchQueue.length) { if (batchTimer) clearTimeout(batchTimer); batchTimer = setTimeout(flushBatch, 60); }
            });
    }
    function okGloss(sen, d) {
        glossCache[sen.text] = d;
        delete glossFail[sen.text];
        sen.gotGloss = true;
        noteWords(d.words, "gloss");
        sen.hDone = false;
        highlightSen(sen);   // 词源更全后再切一次(已切间隙不会重复包词)
        if (sen.expanded) fillGloss(sen);
    }

    /* ---- 句下译区(M9B 行间 interlinear;M9C 长按开 + 加载动画)---- */
    function ensureCard(sen) {
        if (sen.glossEl && sen.glossEl.parentNode) return sen.glossEl;
        var card = document.createElement("div");
        card.className = "lg-gloss";
        card.setAttribute("data-sen", sen.id);
        var anchor = sen.spans[sen.spans.length - 1];
        if (!anchor || !anchor.parentNode) { sen.expanded = false; return null; }
        anchor.parentNode.insertBefore(card, anchor.nextSibling);
        sen.glossEl = card;
        return card;
    }
    function fillGloss(sen) {
        if (!sen || !sen.expanded) return;
        var card = ensureCard(sen);
        if (!card) return;
        card.classList.add("lg-inter");
        var d = glossCache[sen.text];
        var noAuth = !token();
        var inner = "";
        if (d && d.zh) {
            inner = '<div class="lg-inter-zh">' + esc(String(d.zh)) + "</div>";
        } else if (glossFail[sen.text]) {
            inner = '<div class="lg-gloss-note">' + (noAuth
                ? '登录后即可使用点句翻译 <button type="button" class="lg-gloss-close" data-act="gloss-login">去登录</button>'
                : (glossBlocked
                    ? (glossCoinMsg
                        ? esc(glossCoinMsg) + '<div class="btn-row"><button type="button" class="lg-gloss-close" data-act="buy-pack">小额直付 ¥1/¥3</button><button type="button" class="lg-gloss-close" data-act="buy-member">开通会员不限量</button></div>'
                        : "今天的点译次数用完啦，明天 08:00 刷新；开通会员可点更多")
                    : '<button type="button" class="lg-gloss-close" data-act="retry">译文没取到 · 点此重试</button>')) + "</div>";
        } else {
            inner = '<div class="lg-gloss-note">' + (noAuth
                ? '登录后即可使用点句翻译 <button type="button" class="lg-gloss-close" data-act="gloss-login">去登录</button>'
                : '<span class="lg-gload"><i></i><i></i><i></i></span><span class="note-in">译文生成中…</span>') + "</div>";
        }
        card.innerHTML = inner;
    }
    function collapseSen(sen) {
        if (!sen) return;
        sen.expanded = false;
        if (sen.glossEl) { sen.glossEl.remove(); sen.glossEl = null; }
    }
    /* 单击句子 = 开/收译文(2026-09-26 改)。原来单击只能"收起已开的",想开新译文必须长按 430ms ——
       小徐要的是"点开点收",而长按在手机上本来就和选中文字打架。前两轮的沉浸 scaffold 依旧
       自动展开(见 lgImm autoExpand,不经过这里),所以新手第一眼还是能看见双语对照。 */
    function toggleSen(sen) {
        if (!sen) return;
        if (sen.expanded) { collapseSen(sen); return; }
        openSen(sen);
    }
    function openSen(sen) {
        if (!sen) return;
        if (sen.expanded) { collapseSen(sen); return; }   // 已开:长按收起
        sen.expanded = true;
        sen.hinted = true;   // 无阻畅读:看过译文就不算无阻(收起后也要记住,故另存 sticky 标记)
        if (glossCache[sen.text] || glossFail[sen.text]) fillGloss(sen);
        else { fillGloss(sen); queueGloss([sen]); }   // 未取到:先占位(加载动画),批回后自动填充
    }

    /* ---- 词 popover(点击自动入生词本) ---- */
    var pop = null;
    function ensurePop() {
        if (!pop) { pop = document.createElement("div"); pop.className = "lg-pop"; document.body.appendChild(pop); }
        return pop;
    }
    function hidePop() { if (pop) { pop.classList.remove("on"); pop.style.left = "-999px"; pop.style.top = "-999px"; } }
    /* ---- M6d3 点查考纲化:当前档词库命中 → 考纲徽标+词库标准释义;未命中 → AI info/整句引导 ---- */
    var BAND_NAMES = { hs: "高中", cet4: "四级", cet6: "六级", ky: "考研", toefl: "托福", "ja-n5": "N5", "ja-n4": "N4", "ja-n3": "N3", "ja-n2": "N2", "ja-n1": "N1", "ko-1": "初级", "ko-2": "中级", "ko-3": "高级" };
    var bandAliasIdx = {};   // band -> {词形变体: 原形}
    /* 2026-09-13:词汇难度改由"用户学习档"动态决定——剧情/点译/章节词/词测全走这一处;
       未选档时才退回卡内档位兜底(保证有词库可用),不再让卡的难度Tag 决定用户学什么词。 */
    /* 当前学习档:优先用户档,其次卡档;两者都要属于**当前语种**(否则切语种后会把英语档当日语档用/反之) */
    function currentLangBand() {
        var lang = curLearnLang();
        var order = (window.LangBandMeta && window.LangBandMeta.orderOf) ? window.LangBandMeta.orderOf(lang) : null;
        function ok(k) { return !!k && (order ? order.indexOf(k) >= 0 : !!BAND_NAMES[k]); }
        var p = readProfile();
        var ub = p && p.band;
        if (ok(ub)) return ub;
        try {
            var c = (typeof ScenarioCardService !== "undefined" && ScenarioCardService.getSelectedCard) ? ScenarioCardService.getSelectedCard() : null;
            var sb = c && c.structured && String(c.structured.band || "");
            if (ok(sb)) return sb;
        } catch (e) {}
        return (window.LangBandMeta && window.LangBandMeta.defOf) ? window.LangBandMeta.defOf(lang) : "cet4";
    }
    /* 日/韩词形活用回查:词库收的是辞书形/基本形(食べる / 먹다),正文里出现的是活用形(食べた / 먹었어요),
       所以点词要能"顺词干找回去"。英语那套 -s/-ing/-ed 词形还原对日韩无效,另建词干索引。 */
    var cjkBankIdx = {};
    function bankLookupCJK(band, tok) {
        var items = langBankCache[band];
        if (!items || !items.length || !tok) return null;
        var lang = curSessionLang(), tl = String(tok).toLowerCase();
        if (!tl) return null;
        var idx = cjkBankIdx[band];
        if (!idx || idx.lang !== lang || idx.n !== items.length) {
            idx = { lang: lang, n: items.length, exact: Object.create(null), stems: [] };
            for (var i = 0; i < items.length; i++) {
                var w = String(items[i].w || "");
                if (!w) continue;
                var k = w.toLowerCase();
                if (!idx.exact[k]) idx.exact[k] = items[i];
                var st = cjkStem(k, lang);
                if (st && st !== k && (lang !== "ko" || st.length >= 2)) idx.stems.push({ s: st, it: items[i] });
            }
            idx.stems.sort(function (a, b) { return b.s.length - a.s.length; });
            cjkBankIdx[band] = idx;
        }
        if (idx.exact[tl]) return idx.exact[tl];
        for (var m = 0; m < idx.stems.length; m++) {
            var sm = idx.stems[m].s;
            if (tl.indexOf(sm) === 0 && tl.length <= sm.length + 4) return idx.stems[m].it;
        }
        return null;
    }
    function bankAliasItem(band, w) {
        var items = langBankCache[band];
        if (!items || !items.length) return null;
        var idx = bandAliasIdx[band];
        if (!idx) {
            idx = bandAliasIdx[band] = {};
            for (var i = 0; i < items.length; i++) {
                var al = items[i].al;
                if (!al) continue;
                for (var j = 0; j < al.length; j++) if (!idx[al[j]]) idx[al[j]] = items[i].w;
            }
        }
        var w2 = idx[w];
        return w2 ? langBankItem(band, w2) : null;
    }
    function bankStemCandidates(w) {
        var c = [];
        if (w.length <= 3) return c;
        if (/ies$/.test(w)) c.push(w.slice(0, -3) + "y");
        if (/(ss|sh|ch|x|z)es$/.test(w)) c.push(w.slice(0, -2));
        if (/[a-z]s$/.test(w) && !/ss$/.test(w)) c.push(w.slice(0, -1));
        var s1 = w.replace(/ing$/, "");
        if (s1 !== w) { c.push(s1); c.push(s1 + "e"); }
        var s2 = w.replace(/ed$/, "");
        if (s2 !== w) { c.push(s2); c.push(s2 + "e"); if (s2.length > 3) c.push(s2.slice(0, -1)); }
        return c;
    }
    function bankLookup(band, term) {
        var w = String(term).toLowerCase();
        var it = langBankItem(band, w);
        if (it && it.zh) return { it: it, word: w, band: band };
        it = bankAliasItem(band, w);
        if (it && it.zh) return { it: it, word: String(it.w).toLowerCase(), band: band };
        var cs = bankStemCandidates(w), k;
        for (k = 0; k < cs.length; k++) {
            it = langBankItem(band, cs[k]);
            if (it && it.zh) return { it: it, word: cs[k], band: band };
        }
        return null;
    }
    function renderPop(p, term, disp, hit, info, inVocab) {
        var html = "";
        if (hit) html += '<div class="lg-pop-badge">【' + (BAND_NAMES[hit.band] || "") + "考纲词】</div>";
        html += '<div class="lg-pop-w">' + esc(disp);
        if (hit && hit.it.ph) html += '<span class="lg-pop-ph">' + esc(hit.it.ph) + "</span>";
        else if (info && info.ph) html += '<span class="lg-pop-ph">' + esc(info.ph) + "</span>";
        html += sayBtnHtml(disp);   // 小喇叭:手机设置里关掉「单词发音」后这里就不出（在念的是当前会话语种）
        html += "</div>";
        if (hit) {
            html += '<div class="lg-pop-zh">' + esc(hit.it.zh) + "</div>";
        } else {
            if (info && info.en) html += '<div class="lg-pop-en">' + esc(info.en) + "</div>";
            if (info && info.zh) html += '<div class="lg-pop-zh">' + esc(info.zh) + "</div>";
            if (!info) html += '<div class="lg-pop-zh dim">考纲词库和全量词典里都没有这个词——点它所在的句子，看整句译文里怎么理解。</div>';
        }
        html += '<div class="lg-pop-foot">';
        if (inVocab) {
            var vk = String(disp).toLowerCase(), vi = vocabMap[vk] || null;
            html += '<span class="ok">' + uiIconHtml("✓") + ' 已收进生词本</span>';
            if (vi && vi.id) html += '<button type="button" class="lg-pop-del" data-act="del-vocab" data-vid="' + esc(vi.id) + '" data-key="' + esc(vk) + '">从生词本移除</button>';
            html += '<span class="lg-vr-origin">在大厅「我的生词本」里可以划状态</span>';
        } else if (token()) {
            html += '<span class="later">正在自动收进生词本…</span>';
        } else {
            html += '<span class="later">登录后，点查的词会自动收进生词本</span><button type="button" class="lg-gloss-close" data-act="gloss-login">去登录</button>';
        }
        html += "</div>";
        p.innerHTML = html;
    }
    function openPop(term, x, y) {
        if (!term) return;
        var key = String(term).toLowerCase();
        var info = wordInfo[key] || null;
        var p = ensurePop();
        p.dataset.dw = key;   // 本词标记:迟到的兜底查询回调据此放弃已被新词接管的弹层
        p.innerHTML = '<div class="lg-pop-w">' + esc(String(term)) + '</div><div class="lg-pop-zh dim">查词中…</div>';
        p.classList.add("on");
        p.style.left = "-999px";
        p.style.top = "-999px";
        var pw = p.offsetWidth || 300, ph = p.offsetHeight || 120;
        var vw = window.innerWidth || 390, vh = window.innerHeight || 700;
        var lx = x + 10; if (lx + pw > vw - 8) lx = Math.max(8, x - pw - 10);
        var ty = y + 14; if (ty + ph > vh - 8) ty = Math.max(8, y - ph - 12);
        p.style.left = lx + "px";
        p.style.top = ty + "px";
        var band = currentLangBand();
        var done = function (hit) {
            if (!p.classList.contains("on")) return;    // 已被关闭/新词接管
            if (hit) {
                var hdisp = hit.word;
                key = hdisp; info = null;
                markSeenWord(band, hdisp);   // M6d4:点查词库词=seen(词状态机起点)
                var hinVocab = !!vocabMap[key];
                noteTapped(hdisp, { w: hdisp, zh: hit.it.zh });
                renderPop(p, term, hdisp, hit, info, hinVocab);
                // M9D:已进本=渲染即终态;未进本→静默保存(词库词按考纲原形收录)
                if (hinVocab || !token()) return;
                saveVocabSilent(hdisp, { zh: hit.it.zh, en: "" }, function (saved) {
                    if (!saved || !p.classList.contains("on") || !vocabMap[key]) return;
                    renderPop(p, term, hdisp, hit, info, true);
                });
                return;
            }
            // 词库 miss → ECDICT 全量词典兜底查词(未命中/词典不可用回落原 miss 文案,收词不中断)
            if (vocabMap[key]) { renderPop(p, term, term, null, wordInfo[String(term).toLowerCase()] || null, true); return; }
            missResolve(term, p);
        };
        if (langBankCache[band]) {
            done(bankLookup(band, term));
            return;
        }
        loadLangBank(band).then(function (items) {
            if (!items) { done(null); return; }
            var h = bankLookup(band, term);
            done(h);
        });
    }
    function missResolve(term, p) {
        var key = String(term).toLowerCase();
        var stale = function () { return !p.classList.contains("on") || p.dataset.dw !== key; };
        var show = function (info) {
            if (stale()) return;
            renderPop(p, term, term, null, info, !!vocabMap[key]);
        };
        var save = function (info) {
            if (!token() || vocabMap[key]) return;
            saveVocabSilent(term, info, function (saved) {
                if (!saved || stale() || !vocabMap[key]) return;
                renderPop(p, term, term, null, info, true);
            });
        };
        var settle = function (info) {
            noteTapped(term, info ? { w: String(term), en: info.en || "", zh: info.zh || "" } : null);
            show(info);
            save(info);
        };
        var cached = wordInfo[key];
        if (cached) { settle(cached); return; }
        /* 日/韩没有 ECDICT 词典(worker 的 /api/lang/dict 里 ECDICT 只服务英语)→ 先查本档词库;
           词库没收录的词再走 worker 的有道兜底(2026-09-24:日/韩点词接网易有道翻译);
           两边都没有才 settle(null),popup 会提示"点句子看整句翻译"而不是空转 */
        if (IS_CJK_LANG[curSessionLang()]) {
            var lg = curSessionLang(), bit = null, bd = currentLangBand();
            try { bit = bankLookupCJK(bd, term); } catch (e) {}
            if (!bit) { try { bit = langBankItem(bd, String(term).toLowerCase()); } catch (e) {} }
            if (bit) {
                var infoB = { w: String(bit.w || term), en: String(bit.ph || ""), zh: String(bit.zh || ""), ph: String(bit.ph || "") };
                wordInfo[key] = infoB;
                settle(infoB);
                return;
            }
            fetch(API_BASE + "/api/lang/dict?q=" + encodeURIComponent(String(term).slice(0, 32)) + "&lang=" + encodeURIComponent(lg))
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    var infoY = null;
                    if (d && d.hit && d.hit.zh) {
                        infoY = { w: String(term), en: "", zh: String(d.hit.zh || ""), ph: String(d.hit.ph || "") };
                        wordInfo[key] = infoY;
                    }
                    settle(infoY);
                })
                .catch(function () { settle(null); });
            return;
        }
        fetch(API_BASE + "/api/lang/dict?q=" + encodeURIComponent(String(term).slice(0, 64)) + "&lang=en")
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                var info2 = null;
                if (d && d.hit) {
                    info2 = { w: String(term), en: d.hit.en || "", zh: d.hit.zh || "", ph: d.hit.ph || "" };
                    wordInfo[key] = info2;
                }
                settle(info2);
            })
            .catch(function () { settle(null); });
    }
    function saveVocabSilent(term, info, cb) {
        var key = String(term).toLowerCase();
        if (!token() || vocabMap[key]) return;
        var origin = "";
        try {
            if (typeof ScenarioCardService !== "undefined" && ScenarioCardService.getSelectedCard) {
                var c = ScenarioCardService.getSelectedCard();
                if (c && c.title) origin = "卡:「" + String(c.title).slice(0, 40) + "」";
            }
        } catch (e) {}
        if (!origin) origin = learnLangName() + "剧本";
        var ctx = pendingCtx;
        pendingCtx = "";   // 取走即清:避免把上一句的例句贴到这次查的词上
        fetch(API_BASE + "/api/lang/vocab", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({
                lang: curLearnLang(), type: "word", term: String(term).slice(0, 64),
                gloss_en: info && info.en ? String(info.en).slice(0, 500) : "",
                gloss_zh: info && info.zh ? String(info.zh).slice(0, 500) : "",
                ph: info && info.ph ? String(info.ph).slice(0, 64) : "",
                origin: origin.slice(0, 200),
                context: ctx
            })
        })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d) { if (cb) cb(false); return; }
                vocabMap[key] = { id: d.id || "", type: "word", term: String(term).slice(0, 64), gloss_en: info && info.en ? String(info.en) : "", gloss_zh: info && info.zh ? String(info.zh) : "", ph: info && info.ph ? String(info.ph) : "", origin: origin, context: ctx, status: 0, created_at: "" };
                reDirty = true;
                if (cb) cb(true);
            }).catch(function () { if (cb) cb(false); });
    }

    // M9D:从生词本移除(worker DELETE /api/lang/vocab?id=)
    function removeVocab(vid, key) {
        if (!token() || !vid) return;
        var k = String(key).toLowerCase();
        fetch(API_BASE + "/api/lang/vocab?id=" + encodeURIComponent(vid), {
            method: "DELETE",
            headers: { "X-Auth-Token": "Bearer " + token() }
        })
            .then(function (r) { return r.ok ? true : null; })
            .then(function (ok) {
                if (!ok) return;
                delete vocabMap[k];
                reDirty = true;
                hidePop();
                try { if (window.LangAssist && window.LangAssist.refreshVocab) window.LangAssist.refreshVocab(); } catch (e) {}
            }).catch(function () {});
    }

    /* ---- 点击/长按委托(M9C 句长按开译区+单击收起;M9D 词双击查词+滚动关弹层) ---- */
    var lastDbl = { key: "", at: 0 };   // M9D 双击检测(同词 ≤320ms)
    var PRESS_MS = 430;   // M9C 长按阈值
    var press = { sen: null, x: 0, y: 0, timer: null, fired: false, optEl: null };
    function clearPress() {
        if (press.timer) { clearTimeout(press.timer); press.timer = null; }
        press.sen = null; press.fired = false; press.optEl = null;
    }
    function firePress() {
        if (!press.sen) return;
        press.timer = null;
        press.fired = true;
        openSen(press.sen);
    }
    /* 选项长按翻译:首次按下时把选项文案惰性注册成句,复用 openSen/fillGloss 链路(译卡插在选项按钮下方) */
    function senForOption(el) {
        var id = Number(el.getAttribute("data-lg-sen") || 0);
        if (id && sentences[id]) return sentences[id];
        var tEl = el.querySelector(".wy-opt-text") || el;
        var t = String(tEl.textContent || "").replace(/\s+/g, " ").trim();
        for (var k = 0; k < 2; k++) t = t.replace(/^(\d+[.)、]\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*|【?选项[:：]?\s*\d*】?\s*)/, "");
        var _sl = curSessionLang();
        if (!t) return null;
        if (!(_sl === "en" ? /[A-Za-z]/ : CJK_TOKEN_RE[_sl]).test(t)) return null;   // 纯中文选项不走长按翻译
        var nid = ++senSeq;
        // hDone=true:选项不做词级切分(免得双击查词与"点选项推进剧情"打架)
        var sen = { id: nid, text: t, spans: [el], expanded: false, glossEl: null, gotGloss: false, hDone: true };
        sentences[nid] = sen;
        el.setAttribute("data-lg-sen", String(nid));
        return sen;
    }
    document.addEventListener("pointerdown", function (e) {
        if (!langActive() || !e.target || !e.target.closest) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;   // 忽略右键
        var sEl = e.target.closest(".lg-sentence");
        var oEl = sEl ? null : (e.target.closest(".lg-gloss") ? null : e.target.closest(".card-option-btn, .wy-option-btn, [data-choice]"));
        if (!sEl && !oEl) return;
        clearPress();
        if (oEl) {
            press.sen = senForOption(oEl);
            press.optEl = press.sen ? oEl : null;
        } else {
            press.sen = sentences[Number(sEl.getAttribute("data-sen"))] || null;
        }
        press.x = e.clientX; press.y = e.clientY;
        press.timer = setTimeout(firePress, PRESS_MS);
    }, true);
    document.addEventListener("pointermove", function (e) {
        if (press.timer && !press.fired && e.clientX != null &&
            (Math.abs(e.clientX - press.x) > 12 || Math.abs(e.clientY - press.y) > 12)) clearPress();   // 位移=滚动,取消长按
    }, true);
    document.addEventListener("pointerup", function () {
        if (press.fired) { setTimeout(function () { press.fired = false; }, 600); return; }   // 吞掉长按后的 click
        clearPress();
    }, true);
    /* 选项长按后的抬起 click:卡片级选项处理器挂在冒泡链前段且会 stopPropagation,必须在捕获阶段先吞掉,防误发"我选择" */
    document.addEventListener("click", function (e) {
        if (!press.fired || !press.optEl) return;
        var t = e.target;
        if (t && (t === press.optEl || press.optEl.contains(t))) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    document.addEventListener("pointercancel", clearPress, true);
    window.addEventListener("blur", clearPress, false);
    document.addEventListener("contextmenu", function (e) {
        var t = e.target;
        if (press.sen && t && t.closest && (t.closest(".lg-sentence") || t.closest(".card-option-btn, .wy-option-btn"))) e.preventDefault();   // 长按进行/已触发:禁系统选择菜单
    }, true);
    /* P1(2026-09-08)小额救急包/会员 CTA:额度用尽弹层直达充值面板 */
    function buyPackFlow() {
        try {
            if (typeof MembershipService === "undefined") return;
            if (typeof MembershipService.selectPlan === "function") MembershipService.selectPlan("rescue3");
            MembershipService.openPanel();
        } catch (e) {}
    }
    function openMemberPanel() {
        try { if (typeof MembershipService !== "undefined") MembershipService.openPanel(); } catch (e) {}
    }
    /* M9D:滚动自动收起查词弹层 */
    document.addEventListener("scroll", function () { hidePop(); }, true);
    document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var maskEl = t.closest ? t.closest(".lg-rm-mask") : null;
        if (maskEl && t === maskEl) { closeRecap(); return; }   // 复盘弹层:点空白关闭
        var actEl = t.closest("[data-act]");
        if (actEl) {
            var act = actEl.getAttribute("data-act");
            if (act === "buy-pack") { e.preventDefault(); e.stopPropagation(); buyPackFlow(); return; }
            if (act === "buy-member") { e.preventDefault(); e.stopPropagation(); openMemberPanel(); return; }
            if (act === "gloss-login") { e.preventDefault(); e.stopPropagation(); openLoginSheet(); return; }
            if (act === "say") { e.preventDefault(); e.stopPropagation(); sayOne(String(actEl.getAttribute("data-say") || ""), curSessionLang()); return; }
            var g = actEl.closest(".lg-gloss");
            var sen = g ? sentences[Number(g.getAttribute("data-sen"))] : null;
            if (sen) {
                if (act === "close") collapseSen(sen);
                else if (act === "retry") { delete glossFail[sen.text]; sen.expanded = true; fillGloss(sen); queueGloss([sen]); }
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (act === "del-vocab") { e.preventDefault(); e.stopPropagation(); removeVocab(String(actEl.getAttribute("data-vid") || ""), String(actEl.getAttribute("data-key") || "")); return; }
            if (act === "recap-open" || actEl.closest(".lg-rm-mask")) {
                handleRecapAct(actEl, act);
                e.stopPropagation();
                e.preventDefault();
                return;
            }
        }
        if (!langActive()) { hidePop(); return; }
        var wEl = t.closest(".lg-word, .lg-w");   // M6d3:池词+普通词全可点查;M9D:双击才弹查词(单击收起浮层,防误触)
        if (wEl) {
            e.preventDefault(); e.stopPropagation();
            var wk = wEl.getAttribute("data-w") || wEl.textContent;
            var nw = Date.now();
            if (lastDbl.key === wk && nw - lastDbl.at <= 320) {
                lastDbl.key = "";
                var wSenEl = wEl.closest(".lg-sentence");   // 无阻畅读:查过词的这句不再算无阻
                var wSen = wSenEl ? sentences[Number(wSenEl.getAttribute("data-sen"))] : null;
                /* 生词本例句:记下"这个词出现的那句话",存库供日后回看在哪见到的 */
                pendingCtx = wSen && wSen.text ? String(wSen.text).slice(0, 300) : "";
                if (wSenEl) lgImm.hint(wSen);
                openPop(wk, e.clientX, e.clientY);
            }
            else { lastDbl.key = wk; lastDbl.at = nw; hidePop(); }
            return;
        }
        var sEl = t.closest(".lg-sentence");
        if (sEl) {
            e.preventDefault(); e.stopPropagation();
            if (press.fired) { press.fired = false; return; }   // 长按触发后的抬起 click:忽略
            toggleSen(sentences[Number(sEl.getAttribute("data-sen"))]);   // 单击 = 收起已开译文
            return;
        }
        hidePop();
    }, false);

    /* ---- 观察 #play-chat-area:AI 结构化卡挂载 → 句子化 ---- */
    function tryAttach(node) {
        if (!node || node.nodeType !== 1) return;
        if (!langActive()) return;
        var st = node.querySelector ? node.querySelector(".card-story") : null;
        if (!st || st.dataset.lgDone) return;
        if (st.querySelector(".stream-loading, .streaming-cursor")) {
            setTimeout(function () { tryAttach(node); }, 700);   // 流式中骨架:等终版卡(mutation 再触发)
            return;
        }
        attachStory(st);
    }
    // 剧情节点被摘除(重绘清空/换卡/裁掉的老消息)时,把里面的句子从观察表摘掉
    function releaseStory(node) {
        if (!node || node.nodeType !== 1) return;
        var els = [];
        if (node.getAttribute && node.getAttribute("data-sen")) els.push(node);
        if (node.querySelectorAll) {
            var inner = node.querySelectorAll("[data-sen]");
            for (var i = 0; i < inner.length; i++) els.push(inner[i]);
        }
        if (els.length) lgImm.release(els);
    }
    var chatMo = null;
    function initChatWatch() {
        var board = $("play-chat-area");
        if (!board || chatMo) return;
        chatMo = new MutationObserver(function (muts) {
            if (!langActive()) return;
            for (var i = 0; i < muts.length; i++) {
                var adds = muts[i].addedNodes;
                for (var j = 0; j < adds.length; j++) tryAttach(adds[j]);
                var rems = muts[i].removedNodes;
                for (var k = 0; k < rems.length; k++) releaseStory(rems[k]);
            }
        });
        chatMo.observe(board, { childList: true });
    }

    /* ---- 「我的生词本」视图(view-lang ⑤) ---- */
    var lastLearnAt = 0;
    /* ---- 复习计划(2026-09-26 重做:前端渐进式 SRS) ----
       旧实现把每词的到期日锚死在「收录日 +1/2/4/7 天」这四天,复习完既不推进也不循环 ——
       任何收录超过 7 天的词永远不再到期(实测:17 条收录于 09-05~09-16 的生词,在 09-26 当天
       diff 全在 10~21,一条都落不进 {1,2,4,7} → 「今日复习」恒为 0,功能等于死了)。
       现改为阶梯推进:SRS_STEPS 是「距上次复习的天数」,答对升一档、答错退回第一档;
       从没复习过的词一律按「收录日 + 第一档」算,所以收录满一天还没复习的一律算逾期、立刻补进今日。
       数据存 localStorage lang_srs_v1:{vid:{r:轮次,d:上次复习北京日,w:答错累计}}。
       lang_review_done_v1(当日已自评)保留作兜底,保证同一天既推进档位又不会被重复列出。
       status>=2 已掌握毕业、永久移出排程;这个门是单向的,但改回新学/眼熟后会按既有档位继续排
       (旧实现在这点上更糟:改回来也永远不再到期)。复习动作=自评三键(没记住/记住了/很熟了)调 status API。 */
    var SRS_STEPS = [1, 2, 4, 7, 15, 30];
    var SRS_KEY = "lang_srs_v1";
    var srsMap = {};
    (function () {
        try {
            var o = JSON.parse(localStorage.getItem(SRS_KEY) || "null");
            if (o && typeof o === "object") {
                for (var k in o) if (o[k] && typeof o[k] === "object") srsMap[k] = o[k];
            }
        } catch (e) {}
    })();
    function srsSave() {
        try { localStorage.setItem(SRS_KEY, JSON.stringify(srsMap)); } catch (e) {}
    }
    function srsStep(r) {
        var i = Number(r) || 0;
        if (i < 0) i = 0;
        if (i > SRS_STEPS.length - 1) i = SRS_STEPS.length - 1;
        return SRS_STEPS[i];
    }
    /* 到期日(北京日整数)。没记录 = 收录日 + 第一档 */
    function srsDueDay(it) {
        if (!it) return null;
        var k = String(it.id || "");
        var rec = k ? srsMap[k] : null;
        if (rec && typeof rec.d === "number" && rec.d > 0) return rec.d + srsStep(rec.r);
        var bj = bjDayInt(it.created_at);
        return bj == null ? null : bj + SRS_STEPS[0];
    }
    /* 到期(含逾期);已掌握毕业的不再排 */
    function srsIsDue(it, tday) {
        if (!it || Number(it.status || 0) >= 2) return false;
        var dd = srsDueDay(it);
        return dd != null && tday >= dd;
    }
    /* 自评后推进档位:没记住→退回第一档并记一次错;记住了→升一档;很熟了→拉满 */
    function srsAdvance(vid, st) {
        if (!vid) return;
        var rec = srsMap[vid] || { r: 0, d: 0, w: 0 };
        var r = Number(rec.r) || 0;
        if (st === 0) { r = 0; rec.w = (Number(rec.w) || 0) + 1; }
        else if (st === 2) { r = SRS_STEPS.length - 1; }
        else { r = Math.min(r + 1, SRS_STEPS.length - 1); }
        rec.r = r;
        rec.d = todayBjInt();
        srsMap[vid] = rec;
        srsSave();
    }
    /* 所有未毕业的词(预报、自主复习共用) */
    function srsPool() {
        var pool = [], k, it;
        for (k in vocabMap) {
            if (!Object.prototype.hasOwnProperty.call(vocabMap, k)) continue;
            it = vocabMap[k];
            if (!it || Number(it.status || 0) >= 2) continue;
            pool.push(it);
        }
        return pool;
    }
    /* 未来 7 天预报:今天(含逾期)记在 d=0,只返回有词的档 */
    function srsForecast() {
        var tday = todayBjInt(), cnt = [], i, res = [], pool = srsPool();
        for (i = 0; i <= 7; i++) cnt.push(0);
        for (i = 0; i < pool.length; i++) {
            var dd = srsDueDay(pool[i]);
            if (dd == null) continue;
            var rel = dd - tday;
            if (rel < 0) rel = 0;
            if (rel <= 7) cnt[rel]++;
        }
        for (i = 0; i <= 7; i++) if (cnt[i]) res.push({ d: i, n: cnt[i] });
        return res;
    }
    /* 错词重练:答错过的词,错得多的在前 */
    function srsWrongList(max) {
        var pool = srsPool(), hit = [], i, rec;
        for (i = 0; i < pool.length; i++) {
            rec = srsMap[String(pool[i].id || "")];
            if (rec && Number(rec.w) > 0) hit.push({ it: pool[i], w: Number(rec.w) });
        }
        hit.sort(function (a, b) { return b.w - a.w; });
        return hit.slice(0, Math.max(1, Math.min(Number(max) || 20, 50))).map(function (x) { return x.it; });
    }
    /* 提前复习(自主模式):不管排程,从未毕业词里随机抽一批,治「今天没有到期的词」的憋屈 */
    function srsFreeList(max) {
        var pool = srsPool(), i, j, t;
        for (i = pool.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1)); t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        return pool.slice(0, Math.max(1, Math.min(Number(max) || 20, 50)));
    }
    function bjDayInt(iso) {
        var t = Date.parse(String(iso || "").replace(" ", "T"));
        return isNaN(t) ? null : Math.floor((t + 8 * 3600000) / 86400000);
    }
    function todayBjInt() { return Math.floor((Date.now() + 8 * 3600000) / 86400000); }
    function reviewDoneSet() {
        try {
            var o = JSON.parse(localStorage.getItem("lang_review_done_v1") || "null");
            if (o && o.d === String(todayBjInt())) return (o.ids || []).slice();
        } catch (e) {}
        return [];
    }
    function reviewDoneAdd(vid) {
        var ids = reviewDoneSet();
        if (ids.indexOf(vid) < 0) ids.push(vid);
        try { localStorage.setItem("lang_review_done_v1", JSON.stringify({ d: String(todayBjInt()), ids: ids })); } catch (e) {}
    }
    function reviewDueList() {
        if (!vocabLoaded) return [];
        var tday = todayBjInt(), done = reviewDoneSet(), out = [], k, it;
        for (k in vocabMap) {
            if (!Object.prototype.hasOwnProperty.call(vocabMap, k)) continue;
            it = vocabMap[k];
            if (!srsIsDue(it, tday)) continue;
            if (done.indexOf(String(it.id)) >= 0) continue;    // 今日已自评过
            out.push(it);
        }
        out.sort(function (a, b) { return String(a.created_at || "") < String(b.created_at || "") ? 1 : -1; });
        return out;
    }
    function reviewHtml(rv) {
        var h = '<div class="rv-box"><div class="rv-t">' + uiIconHtml("📅") + ' 今日复习 <span class="cap-soft">到期 ' + rv.length + " 词（含逾期）</span></div>";
        var i, it, isExp = function (x) { return x.type === "expression"; };
        var gz, gl;
        for (i = 0; i < rv.length; i++) {
            it = rv[i];
            gz = String(it.gloss_zh || "");
            gl = (gz || "（暂无释义）").slice(0, 200);
            h += '<div class="rv-item"><div class="rv-term"><div class="rv-w" id="rvw-' + esc(String(it.id)) + '">' + esc(it.term) + (isExp(it) ? '<span class="rv-exp-tag">表达</span>' : "") + "</div>" +
                '<div class="rv-gl">' + esc(gl) + "</div>" +
                '<div class="lg-st">' +
                '<button type="button" data-act="rv" data-vid="' + esc(String(it.id)) + '" data-st="0">没记住</button>' +
                '<button type="button" data-act="rv" data-vid="' + esc(String(it.id)) + '" data-st="1">记住了</button>' +
                '<button type="button" data-act="rv" data-vid="' + esc(String(it.id)) + '" data-st="2">很熟了</button>' +
                "</div></div></div>";
        }
        h += "</div>";
        return h;
    }
    /* ---- 生词本 2026-09-21:来源归类 / 例句 / 搜索 / 双 Tab / 全屏复习 ---- */
    /* origin 形如 卡:「XXX」 / 卡:「XXX」· 第 N 章复盘 / 英语剧本 → 归类成剧本名 */
    function vocabSrcOf(it) {
        var o = String((it && it.origin) || "");
        var m = o.match(/卡:「([^」]*)」/);
        if (m) return m[1] || "未命名卡";
        if (!o) return "其他";
        return o.replace(/^·\s*/, "").slice(0, 24) || "其他";
    }
    /* 句子型收藏(章末复盘的仿写句)的原文 —— 它同时是翻译缓存的键。
       老数据把句子重复写进了 gloss_zh(收藏按钮的 data-zh 直接抄了 term),新数据 gloss_zh 留空,
       两种都返回句子本身;正常表达(有独立中文释义)返回空串,走普通渲染。 */
    function expSentenceOf(it) {
        if (!it || it.type !== "expression") return "";
        var t = String(it.term || "").trim();
        if (!t) return "";
        var g = String(it.gloss_zh || "").trim();
        if (!g || g.toLowerCase() === t.toLowerCase()) return t;
        return "";
    }
    /* 词典释义标点规整(只作用于显示,不回写库)。ECDICT 常原样吐出中英标点混用的释义:
       「v.盯,凝视;n.凝视」「v. （门）嘎吱作响( creak的现在分词 )」「n. 浓香, 香气\n[医] 香气」。
       只做四件事、只动标点不动字:合并换行与多余空格、去掉圆括号内侧空格、
       内容含汉字的圆括号转全角、夹在汉字之间的半角 , ; : 转全角。 */
    function tidyGloss(s) {
        var t = String(s == null ? "" : s);
        if (!t) return t;
        t = t.replace(/\r/g, "").replace(/[ \t]*\n+[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
        t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
        t = t.replace(/(^|[；;])\s*(n|v|vt|vi|adj|adv|a|prep|pron|conj|num|art|int|aux|abbr|pl)\.(?=\S)/g, "$1$2. ");
        if (/[一-鿿]/.test(t)) {
            t = t.replace(/\(([^()]*[一-鿿][^()]*)\)/g, "（$1）");
            t = t.replace(/([一-鿿])[,;:][ \t]*(?=[一-鿿])/g, function (m, a, b) {
                return a + ({ ",": "，", ";": "；", ":": "：" })[b];
            });
        }
        return t;
    }
    /* 例句:把命中的那个词加粗(大小写不敏感,只标第一处) */
    function vocabCtxHtml(ctx, term) {
        var c = String(ctx || "").trim();
        if (!c) return "";
        var t = String(term || ""), i = t ? c.toLowerCase().indexOf(t.toLowerCase()) : -1;
        var inner = i < 0 ? esc(c)
            : esc(c.slice(0, i)) + "<b>" + esc(c.slice(i, i + t.length)) + "</b>" + esc(c.slice(i + t.length));
        return '<div class="lg-vr-ctx">' + inner + "</div>";
    }
    function vocabAllList() {
        var keys = Object.keys(vocabMap), arr = [], i;
        for (i = 0; i < keys.length; i++) arr.push(vocabMap[keys[i]]);
        arr.sort(function (a, b) { var ta = a.created_at || "", tb = b.created_at || ""; return ta === tb ? 0 : (ta > tb ? -1 : 1); });
        return arr;
    }
    /* 复习预报:未来 7 天各有多少词到期摊成一行。今天那档不写 —— 上面的列表本身就是今天。 */
    function srsForecastHtml() {
        var f = srsForecast(), parts = [], i, lbl;
        for (i = 0; i < f.length; i++) {
            if (f[i].d === 0) continue;
            lbl = f[i].d === 1 ? "明天" : f[i].d + " 天后";
            parts.push(lbl + " " + f[i].n + " 词");
        }
        if (!parts.length) return "";
        return '<div class="lg-rv-fc">复习预报 · ' + parts.join(" · ") + "</div>";
    }
    function vocabDueHtml(rv) {
        var fc = srsForecastHtml(), all = vocabAllList();
        if (!rv.length) {
            var wrongN = srsWrongList(50).length;
            return '<div class="lg-vr word"><div class="lg-vr-main">' +
                '<div class="lg-vr-term">今天没有到期的词 ' + uiIconHtml("🎉") + "</div>" +
                '<div class="lg-vr-gl">按 1·2·4·7·15·30 天的间隔排，到期才出现。答对升一档、答错退回第一档。</div>' +
                "</div></div>" + fc + '<div class="lg-rv-acts">' +
                (all.length ? '<button type="button" class="lg-rv-go ghost" data-act="rvfree">提前复习 · 随机刷 ' + Math.min(all.length, 20) + " 词</button>" : "") +
                (wrongN ? '<button type="button" class="lg-rv-go ghost" data-act="rvwrong">错词重练 · ' + wrongN + " 词</button>" : "") +
                (all.length ? '<button type="button" class="lg-rv-go ghost" data-act="vall">查看全部生词库（' + all.length + "）</button>" : "") +
                '<button type="button" class="lg-rv-go ghost" data-act="vplay">去玩新剧本攒新词</button>' +
                "</div>";
        }
        return '<button type="button" class="lg-rv-go" data-act="rvgo">' + uiIconHtml("▶") + ' 一键开始复习 · 全屏刷 ' + rv.length + " 词</button>" + fc + reviewHtml(rv);
    }
    function vocabAllHtml(all) {
        var srcs = {}, i, j, s;
        for (i = 0; i < all.length; i++) srcs[vocabSrcOf(all[i])] = 1;
        var names = Object.keys(srcs).sort();
        var chips = "";
        if (names.length > 1) {
            chips = '<div class="lg-srcs"><span class="lg-src' + (vocabSrc === "" ? " on" : "") + '" data-act="vsrc" data-src="">全部 ' + all.length + "</span>";
            for (i = 0; i < names.length; i++) {
                var cnt = 0;
                for (j = 0; j < all.length; j++) if (vocabSrcOf(all[j]) === names[i]) cnt++;
                chips += '<span class="lg-src' + (vocabSrc === names[i] ? " on" : "") + '" data-act="vsrc" data-src="' + esc(names[i]) + '">' + esc(names[i]) + " " + cnt + "</span>";
            }
            chips += "</div>";
        }
        /* 掌握程度筛选:与来源筛选各占一行。来源是"我玩过哪些卡"、掌握度是"我背到哪一步",
           两件事正交,所以不合并成一组,免得点来源把掌握度筛掉还得再点回来。 */
        var ST = [["0", "新学"], ["1", "眼熟"], ["2", "已掌握"]];
        var stc = [0, 0, 0];
        for (i = 0; i < all.length; i++) { s = Number(all[i].status) || 0; if (stc[s] != null) stc[s]++; }
        var stfs = '<div class="lg-stfs"><span class="lg-stf' + (vocabSt === "" ? " on" : "") + '" data-act="vstf" data-st="">全部 ' + all.length + "</span>";
        for (i = 0; i < ST.length; i++) {
            stfs += '<span class="lg-stf' + (vocabSt === ST[i][0] ? " on" : "") + '" data-act="vstf" data-st="' + ST[i][0] + '">' + ST[i][1] + " " + stc[i] + "</span>";
        }
        stfs += "</div>";
        var h = '<div class="lg-tools">' +
            '<input id="lg-vocab-q" class="lg-srch" type="search" placeholder="搜索单词 / 释义 / 例句…" value="' + esc(vocabQ) + '" autocomplete="off">' + chips + stfs + "</div>";
        if (!all.length) return h;
        h += '<div class="list-sub vocab-cnt" id="lg-vocab-cnt"></div>';
        var needTr = [];
        for (i = 0; i < all.length; i++) {
            var it = all[i];
            var cls = it.type === "expression" ? "expr" : "word";
            var tname = it.type === "expression" ? "表达" : "词";
            var stv0 = Number(it.status) || 0;
            var rawZ = String(it.gloss_zh || "");
            var sen = expSentenceOf(it);
            var gl, senAttr = "";
            if (sen) {
                senAttr = ' data-sen="' + esc(sen) + '"';
                if (rvTr[sen]) gl = rvTr[sen];
                else if (rvTrBad[sen]) gl = "（这句的译文暂时取不到）";
                else { gl = "译文获取中…"; needTr.push(sen); }
            } else {
                var ge = it.type === "expression" && String(it.gloss_en || "") ? " · 例: " + String(it.gloss_en) : "";
                gl = tidyGloss(rawZ) + ge;
                if (!String(gl).trim()) gl = "（暂无释义）";
            }
            gl = String(gl).slice(0, 220);
            var btns = "";
            for (j = 0; j < ST.length; j++) {
                var stv = Number(ST[j][0]);
                btns += '<button type="button" data-act="st" data-vid="' + esc(String(it.id || "")) + '" data-status="' + stv + '" class="' + (stv0 === stv ? "on-" + stv : "") + '">' + ST[j][1] + "</button>";
            }
            /* 释义两头空的(ECDICT 没收录就存了下来)给一个现查入口 —— 走的还是首次收录那条
               POST,worker 见到同词同人只补空字段,所以既不用新接口也不会覆盖已有释义 */
            if (!sen && !rawZ.trim() && !String(it.gloss_en || "").trim() && String(it.term || "").trim()) {
                btns += '<button type="button" class="lg-st-fix" data-act="vfix" data-vid="' + esc(String(it.id || "")) + '">补查释义</button>';
            }
            btns += '<button type="button" class="lg-st-del" data-act="del-vocab" data-vid="' + esc(String(it.id || "")) + '" data-key="' + esc(vocabKeyOfTerm(it.term)) + '">移出</button>';
            var hay = (String(it.term || "") + " " + rawZ + " " + String(it.gloss_en || "") + " " + String(it.context || "")).toLowerCase();
            h += '<div class="lg-vr ' + cls + '" data-src="' + esc(vocabSrcOf(it)) + '" data-mst="' + stv0 + '"' + senAttr + ' data-hay="' + esc(hay) + '">' +
                '<span class="lg-vt ' + cls + '">' + tname + "</span>" +
                '<div class="lg-vr-main"><div class="lg-vr-term">' + esc(it.term) +
                (it.ph ? '<span class="lg-vr-ipa">' + esc(String(it.ph)) + "</span>" : "") +
                sayBtnHtml(it.term) + "</div>" +
                '<div class="lg-vr-gl">' + esc(gl) + "</div>" +
                vocabCtxHtml(it.context, it.term) +
                (it.origin ? '<div class="lg-vr-origin">' + esc(String(it.origin).slice(0, 80)) + "</div>" : "") +
                '<div class="lg-st">' + btns + "</div></div></div>";
        }
        /* 译文取回来只改那几行释义,不整块重绘 —— 重绘会把正在输入的搜索框焦点冲掉 */
        if (needTr.length) {
            rvTrFetch(needTr, function (got) {
                if (!got) return;
                var bx = $("lang-learn-box");
                if (!bx) return;
                var cs = bx.querySelectorAll(".lg-vr[data-sen]"), m, zh, node;
                for (m = 0; m < cs.length; m++) {
                    zh = rvTr[String(cs[m].getAttribute("data-sen") || "")];
                    if (!zh) continue;
                    node = cs[m].querySelector(".lg-vr-gl");
                    if (node) node.textContent = String(zh).slice(0, 220);
                }
            });
        }
        return h;
    }
    /* 搜索/来源筛选走"就地显隐",不重绘整块——否则输入框每敲一个字就丢焦点 */
    function vocabApplyFilter() {
        var box = $("lang-learn-box");
        if (!box) return;
        var q = vocabQ.trim().toLowerCase();
        var cards = box.querySelectorAll(".lg-vr[data-src]");
        var shown = 0, i, c, hit;
        for (i = 0; i < cards.length; i++) {
            c = cards[i];
            hit = (!vocabSrc || c.getAttribute("data-src") === vocabSrc)
                && (vocabSt === "" || c.getAttribute("data-mst") === vocabSt);
            if (hit && q) hit = String(c.getAttribute("data-hay") || "").indexOf(q) >= 0;
            c.style.display = hit ? "" : "none";
            if (hit) shown++;
        }
        var cnt = $("lg-vocab-cnt");
        if (cnt) {
            var total = cards.length;
            cnt.textContent = (vocabQ.trim() || vocabSrc || vocabSt !== "")
                ? "筛选出 " + shown + " 条（共 " + total + " 条，点剧情里的词会自动收进来）"
                : "共 " + total + " 条（点剧情里的词 / 章末复盘里收藏的表达都会收进来）";
        }
    }
    /* 全屏复习:覆盖层挂在 body 上,所以身后生词本重绘不会把它冲掉 */
    var rvPlay = null;
    function rvEnsureMask() {
        var m = $("lg-rv-mask");
        if (m) return m;
        m = document.createElement("div");
        m.id = "lg-rv-mask";
        m.className = "lg-rv-mask";
        m.addEventListener("click", function (e) {
            var b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
            if (b) {
                var a = b.getAttribute("data-act");
                e.preventDefault(); e.stopPropagation();
                if (a === "rvclose") { rvPlayClose(); return; }
                if (a === "rvshow") { if (rvPlay) { rvPlay.shown = true; rvPlayRender(); } return; }
                if (a === "rvgrade") { rvPlayGrade(Number(b.getAttribute("data-st"))); return; }
                return;
            }
            if (e.target === m) rvPlayClose();
        }, false);
        document.body.appendChild(m);
        return m;
    }
    function rvPlayOpen(list) {
        if (!list || !list.length) return;
        rvPlay = { list: list.slice(), i: 0, shown: false };
        rvPlayRender();
    }
    function rvPlayClose() {
        rvPlay = null;
        var m = $("lg-rv-mask");
        if (m && m.parentNode) m.parentNode.removeChild(m);
    }
    function rvPlayGrade(st) {
        if (!rvPlay) return;
        var it = rvPlay.list[rvPlay.i];
        if (!it) return;
        var gst = [0, 1, 2].indexOf(st) >= 0 ? st : 1;
        if (it.id) { reviewDoneAdd(String(it.id)); srsAdvance(String(it.id), gst); }   // 自评即复习:推进档位 + 当日不再重复提示
        changeStatus(it.id, gst);   // 顺带刷新身后的生词本
        rvPlay.i++;
        rvPlay.shown = false;
        rvPlayRender();
    }
    /* 复习卡的句子译文(2026-09-24):句子型收藏(章末复盘的仿写例句)连"释义"存的都是句子本身,
       揭示后"该出译文的地方还是原句"。揭示时按句现取一次 /api/lang/gloss(与点句同一路),
       结果落 localStorage 长期缓存 —— 同一句只翻一次,不重复吃额度;取不到就退回原样,不在本会话重试。
       只管句子型卡片:词卡的例句译文暂不取,那是每张卡一次请求,会挤掉点译的免费额度。 */
    var RV_TR_KEY = "lang_sen_zh_v1";
    var rvTr = {}, rvTrBad = {};
    (function () {
        try {
            var o = JSON.parse(localStorage.getItem(RV_TR_KEY) || "null");
            if (o && typeof o === "object") for (var k in o) if (typeof o[k] === "string") rvTr[k] = o[k];
        } catch (e) {}
    })();
    function rvTrSave() {
        try {
            var ks = Object.keys(rvTr);
            if (ks.length > 400) {   // 攒太多砍掉前一半(键顺序=写入顺序,越靠前越旧)
                var cut = {};
                for (var i = Math.floor(ks.length / 2); i < ks.length; i++) cut[ks[i]] = rvTr[ks[i]];
                rvTr = cut;
            }
            localStorage.setItem(RV_TR_KEY, JSON.stringify(rvTr));
        } catch (e) {}
    }
    function rvTrFetch(list, cb, retried) {
        var need = [], i, s;
        for (i = 0; i < list.length; i++) {
            s = String(list[i] || "").trim();
            if (!s || rvTr[s] || rvTrBad[s] || need.indexOf(s) >= 0) continue;
            need.push(s);
        }
        if (!need.length) { if (cb) cb(false); return; }
        fetch(API_BASE + "/api/lang/gloss", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ sentences: need.map(function (x) { return x.slice(0, 500); }), lang: curLearnLang() })
        })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                // 服务端 6s 限频:紧接着点句/上一张卡会被挡,等一等重试一次(只为这一句)
                if (d && d.code === "GLOSS_TOO_FREQUENT" && !retried) {
                    setTimeout(function () { rvTrFetch(list, cb, true); }, 6500);
                    return;
                }
                var ok = !!(d && d.ok && Array.isArray(d.items)), got = false, j, zh;
                for (j = 0; j < need.length; j++) {
                    zh = ok && d.items[j] && d.items[j].zh ? String(d.items[j].zh).trim() : "";
                    if (zh) { rvTr[need[j]] = zh; got = true; } else rvTrBad[need[j]] = true;
                }
                if (got) rvTrSave();
                if (cb) cb(got);
            })
            .catch(function () {
                for (var j = 0; j < need.length; j++) rvTrBad[need[j]] = true;   // 断网时不反复打
                if (cb) cb(false);
            });
    }
    function rvPlayRender() {
        if (!rvPlay) { rvPlayClose(); return; }
        var m = rvEnsureMask();
        var it = rvPlay.list[rvPlay.i];
        if (!it) {
            m.innerHTML = '<div class="lg-rv-card"><div class="lg-rv-done"><b>' + uiIconHtml("🎉") + ' 今日复习完成</b>' +
                '<span class="lg-rv-hint tight">答对的词会按 1·2·4·7·15·30 天的间隔越排越远，到期自己回来。</span>' +
                '<button type="button" class="lg-rv-btn" data-act="rvclose">返回生词本</button></div></div>';
            return;
        }
        var term = String(it.term || "");
        var gz = String(it.gloss_zh || "") || "（暂无释义）";
        var ph = it.type === "expression" ? "固定表达" : "单词";
        var need = [], body;
        if (rvPlay.shown) {
            var sen = expSentenceOf(it);
            if (sen) {
                // 句子型收藏(章末复盘的仿写例句):"释义"位存的就是原句,译文得现取
                var sz = rvTr[sen];
                body = '<div class="lg-rv-gz">' +
                    (sz ? esc(sz) : rvTrBad[sen] ? "（译文暂时取不到，先按上面的原句回看）" : "译文获取中…") + "</div>";
                if (!sz && !rvTrBad[sen]) need.push(sen);
            } else {
                body = '<div class="lg-rv-gz">' + esc(tidyGloss(gz)) + "</div>" + vocabCtxHtml(it.context, term);
            }
        } else {
            body = '<div class="lg-rv-hint">先在心里回想它的意思，再点下面揭示</div>';
        }
        m.innerHTML = '<div class="lg-rv-card">' +
            '<div class="lg-rv-top"><span>' + (rvPlay.i + 1) + " / " + rvPlay.list.length + " · 今日复习 · " + ph + "</span>" +
            '<span class="lg-rv-x" data-act="rvclose">✕</span></div>' +
            '<div class="lg-rv-w">' + esc(term) + "</div>" +
            '<div class="lg-rv-ph">' + (it.origin ? "来自 " + esc(vocabSrcOf(it)) : "&nbsp;") + "</div>" +
            '<div class="lg-rv-body">' + body + "</div>" +
            (rvPlay.shown
                ? '<div class="lg-rv-st"><button type="button" class="s0" data-act="rvgrade" data-st="0">没记住</button>' +
                  '<button type="button" class="s1" data-act="rvgrade" data-st="1">记住了</button>' +
                  '<button type="button" class="s2" data-act="rvgrade" data-st="2">很熟了</button></div>'
                : '<button type="button" class="lg-rv-btn" data-act="rvshow">显示释义与例句</button>') +
            "</div>";
        if (need.length) {
            rvTrFetch(need, function (got) {
                // 卡片没换、仍处于揭示态才重画(取回译文或确认取不到)
                if (!rvPlay || !rvPlay.shown || rvPlay.list[rvPlay.i] !== it) return;
                rvPlayRender();
            });
        }
    }
    function renderLearn() {
        var box = $("lang-learn-box");
        if (!box) return;
        var ln = learnLangName();
        if (!token()) {
            box.innerHTML = '<div class="lg-vr"><div class="lg-vr-main"><div class="lg-vr-term">登录后，生词本随账号同步</div><div class="lg-vr-gl">玩' + ln + '剧本时点查的单词会自动收进这里，换设备也不丢。</div></div><button type="button" class="lg-gloss-close" data-act="vocab-login">去登录</button></div>';
            return;
        }
        if (!vocabLoaded || vocabLoadedFor !== curLearnLang()) {
            box.innerHTML = '<div class="list-sub">' + ln + '生词加载中…</div>';
            loadVocabNow();
            return;
        }
        if (vocabErr) {
            box.innerHTML = vocabErr === "auth"
                ? '<div class="lg-vr"><div class="lg-vr-main"><div class="lg-vr-term">登录状态过期了</div><div class="lg-vr-gl">' + ln + '生词都还在云端，重新登录就能看到。</div><button type="button" class="mini-btn ghost list-loose" data-act="vocab-login">重新登录</button></div></div>'
                : '<div class="lg-vr"><div class="lg-vr-main"><div class="lg-vr-term">' + ln + '生词没加载出来</div><div class="lg-vr-gl">网络开小差了。你的生词还在云端，点下面重试就好。</div><button type="button" class="mini-btn ghost list-loose" data-act="vocab-retry">重新加载</button></div></div>';
            return;
        }
        var all = vocabAllList();
        if (!all.length) {
            box.innerHTML = '<div class="lg-vr"><div class="lg-vr-main"><div class="lg-vr-term">还没有' + ln + '生词</div><div class="lg-vr-gl">去玩一个' + ln + '剧本吧——游戏里点查过的词和关键表达会自动出现在这里。</div></div></div>';
            return;
        }
        var rv = reviewDueList();
        box.innerHTML = '<div class="lg-tabs">' +
            '<button type="button" class="lg-tab' + (vocabTab === "due" ? " on" : "") + '" data-act="vtab" data-tab="due">' + uiIconHtml("📆") + ' 今日复习 <b>' + rv.length + "</b></button>" +
            '<button type="button" class="lg-tab' + (vocabTab === "all" ? " on" : "") + '" data-act="vtab" data-tab="all">' + uiIconHtml("📚") + ' 全部生词库 <b>' + all.length + "</b></button>" +
            "</div>" +
            (vocabTab === "due" ? vocabDueHtml(rv) : vocabAllHtml(all));
        /* 两个 Tab 互斥:同一时刻只铺一套内容,不再上下叠着渲染 */
        if (vocabTab === "all") vocabApplyFilter();
    }
    function changeStatus(vid, st) {
        if (!vid || !token()) return;
        fetch(API_BASE + "/api/lang/vocab/status", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ id: vid, status: st })
        })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.ok) return;
                for (var k in vocabMap) {
                    if (Object.prototype.hasOwnProperty.call(vocabMap, k) && String(vocabMap[k].id) === vid) {
                        vocabMap[k].status = st;
                        break;
                    }
                }
                renderLearn();
            }).catch(function () {});
    }
    /* 补查释义:当年收录时词典没命中(ECDICT 未收录的专名、生造词),记录里只有词、没有释义。
       点一下现查一次 /api/lang/dict —— 日/韩走有道兜底,英语走 ECDICT。查到就本地补上并重绘,
       再走一次首次收录那条 POST 落库:worker 见"同人同词"只补空字段,不会覆盖已有释义、
       更不会动 status,所以这一步是幂等的,连点也只会写同样的值。 */
    function vocabFix(vid) {
        if (!vid || !token()) return;
        var key = null, it = null, k;
        for (k in vocabMap) {
            if (Object.prototype.hasOwnProperty.call(vocabMap, k) && String(vocabMap[k].id) === vid) { key = k; it = vocabMap[k]; break; }
        }
        if (!key || !it) return;
        var term = String(it.term || "").slice(0, 64);
        if (!term) return;
        fetch(API_BASE + "/api/lang/dict?q=" + encodeURIComponent(term) + "&lang=" + encodeURIComponent(curLearnLang()))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                var hh = d && d.hit ? d.hit : null;
                var zh = hh && hh.zh ? String(hh.zh).slice(0, 500) : "";
                var en = hh && hh.en ? String(hh.en).slice(0, 500) : "";
                var phv = hh && hh.ph ? String(hh.ph).slice(0, 64) : "";
                if (!zh && !en && !phv) {
                    var bx = $("lang-learn-box");
                    var bb = bx ? bx.querySelector('.lg-st-fix[data-act="vfix"][data-vid="' + vid + '"]') : null;
                    if (bb) { bb.textContent = "词典里没有这个词"; bb.disabled = true; }
                    return;
                }
                if (zh) vocabMap[key].gloss_zh = zh;
                if (en) vocabMap[key].gloss_en = en;
                if (phv) vocabMap[key].ph = phv;
                if (vocabTab === "all") renderLearn();
                return fetch(API_BASE + "/api/lang/vocab", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
                    body: JSON.stringify({ lang: curLearnLang(), type: it.type || "word", term: term, gloss_en: en, gloss_zh: zh, ph: phv })
                });
            })
            .catch(function () {});
    }
    var learnMo = null;
    function initLearnWatch() {
        var main = $("main-content");
        var box = $("lang-learn-box");
        if (!main || !box) return;
        var boxClick = box.addEventListener("click", function (e) {
            var b = e.target && e.target.closest
                ? e.target.closest('[data-act="vtab"], [data-act="rvgo"], [data-act="vsrc"], [data-act="vstf"], [data-act="st"], [data-act="rv"], [data-act="vocab-retry"], [data-act="vocab-login"], [data-act="rvfree"], [data-act="rvwrong"], [data-act="vall"], [data-act="vplay"], [data-act="vfix"]')
                : null;
            if (!b) return;
            var act = b.getAttribute("data-act");
            if (act === "vocab-retry") { retryVocab(); return; }
            if (act === "vocab-login") { vocabReset(); openLoginSheet(); return; }   // 先打回状态,登录后 onAuthChanged 会重拉
            if (act === "vtab") {                       // 双 Tab 互斥切换
                var tb = b.getAttribute("data-tab");
                if (tb !== "due" && tb !== "all") return;
                if (tb !== vocabTab) { vocabTab = tb; renderLearn(); }
                return;
            }
            if (act === "vsrc") {                       // 来源筛选:就地显隐,不重绘(免得搜索框丢焦点)
                vocabSrc = String(b.getAttribute("data-src") || "");
                var chips = box.querySelectorAll('.lg-src[data-act="vsrc"]');
                for (var ci = 0; ci < chips.length; ci++) {
                    chips[ci].classList.toggle("on", String(chips[ci].getAttribute("data-src") || "") === vocabSrc);
                }
                vocabApplyFilter();
                return;
            }
            if (act === "vstf") {                       // 掌握程度筛选:同样就地显隐
                var sv = String(b.getAttribute("data-st") || "");
                vocabSt = (sv === "0" || sv === "1" || sv === "2") ? sv : "";
                var fcs = box.querySelectorAll('.lg-stf[data-act="vstf"]');
                for (var fi = 0; fi < fcs.length; fi++) {
                    fcs[fi].classList.toggle("on", String(fcs[fi].getAttribute("data-st") || "") === vocabSt);
                }
                vocabApplyFilter();
                return;
            }
            if (act === "vall") { vocabTab = "all"; renderLearn(); return; }
            if (act === "vplay") {                      // 空状态出口:回语言首页挑新剧本(攒新词)
                try { if (window.LangController && window.LangController.goLibrary) { window.LangController.goLibrary(); return; } } catch (e) {}
                return;
            }
            if (!token()) return;
            if (act === "vfix") { vocabFix(String(b.getAttribute("data-vid") || "")); return; }
            if (act === "rvgo") { rvPlayOpen(reviewDueList()); return; }   // 一键开始复习 → 全屏
            if (act === "rvfree") { rvPlayOpen(srsFreeList(20)); return; }  // 提前复习:不管排程随机抽
            if (act === "rvwrong") { rvPlayOpen(srsWrongList(20)); return; }   // 错词重练:错得多的在前
            if (act === "rv") {
                var vid2 = String(b.getAttribute("data-vid") || "");
                var st2 = Number(b.getAttribute("data-st"));
                if (vid2 && [0, 1, 2].indexOf(st2) >= 0) {
                    reviewDoneAdd(vid2);
                    srsAdvance(vid2, st2);   // 自评即复习:推进档位 + 当日不再重复提示
                    changeStatus(vid2, st2);
                }
            } else {
                changeStatus(b.getAttribute("data-vid"), Number(b.getAttribute("data-status")));
            }
        });
        box.addEventListener("input", function (e) {
            if (e.target && e.target.id === "lg-vocab-q") { vocabQ = String(e.target.value || ""); vocabApplyFilter(); }
        });
        if (learnMo) return;
        learnMo = new MutationObserver(function () {
            /* M6a/M8d:生词本挂语言页组任一子页(view-lang/-learn/-vocab)active 时兜底刷新 */
            var on = false, i, ids = ["view-lang", "view-lang-learn", "view-lang-vocab"];
            for (i = 0; i < ids.length; i++) {
                var vl = $(ids[i]);
                if (vl && vl.classList && vl.classList.contains("active")) { on = true; break; }
            }
            if (!on) return;
            var now = Date.now();
            if (now - lastLearnAt < 1500) return;
            lastLearnAt = now;
            loadVocab(function () { renderLearn(); });
        });
        learnMo.observe(main, { attributes: true, attributeFilter: ["class"], subtree: true });
    }

    /* ---- 初始化 ---- */
    function init() {
        if (!window.LangEngine) return;
        initChatWatch();
        initLearnWatch();
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden && langActive()) hidePop();
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    /* ============================================================
       M5 章末复盘:本局点查词回顾 + AI 剧情高频表达/仿写例句 + ★收藏闭环
       入口:attachStory 每 5 轮卡尾挂 .lg-recap-entry;生成走 POST /api/lang/recap;
       收藏 type="expression" 落 lang_vocab(与点查词同表,生词本视图同列表)
       ============================================================ */
    var sessionWords = {};    // 本局(自最近一次进卡)点查过的词:term → {w,en,zh}
    function noteTapped(term, info) {
        var k = String(term || "").toLowerCase();
        if (!k) return;
        if (!sessionWords[k]) sessionWords[k] = { w: String(term), en: info && info.en ? String(info.en) : "", zh: info && info.zh ? String(info.zh) : "" };
    }
    function recapCardTitle() {
        try {
            if (typeof ScenarioCardService !== "undefined" && ScenarioCardService.getSelectedCard) {
                var c = ScenarioCardService.getSelectedCard();
                if (c && c.title) return String(c.title).slice(0, 40);
            }
        } catch (e) {}
        return "";
    }
    function recapCardId() {
        try {
            var s = (typeof StateService !== "undefined") ? StateService.get() : null;
            if (s && s.card_id) return String(s.card_id);
            var c = typeof ScenarioCardService !== "undefined" ? ScenarioCardService.getSelectedCard() : null;
            if (c && c.id) return String(c.id);
        } catch (e) {}
        return "";
    }
    function plainTextOf(html) {
        try {
            var d = document.createElement("div");
            d.innerHTML = String(html || "");
            return (d.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        } catch (e) { return String(html || ""); }
    }
    /* 章剧情文本 = 历史里最近 ≤5 条 AI 回复(即本章窗口),HTML 转纯文本,跳过状态提示行 */
    function chapterStoryText() {
        var hs = [];
        try {
            var s = (typeof StateService !== "undefined") ? StateService.get() : null;
            hs = (s && s.history) || [];
        } catch (e) {}
        var parts = [], i, m, t;
        for (i = hs.length - 1; i >= 0 && parts.length < 5; i--) {
            m = hs[i];
            if (!m || m.role !== "ai") continue;
            t = m.text || "";
            if (/社交线|重试仍失败|^>/.test(t)) continue;
            t = plainTextOf(t);
            if (!t || /^[>⚠️]/.test(t)) continue;
            var keep = [], ln;
            t = t.split("\n");
            for (var j = 0; j < t.length; j++) { ln = t[j].trim(); if (ln && !/^>/.test(ln)) keep.push(ln); }
            t = keep.join("\n").slice(-1600);
            if (t) parts.unshift(t);
        }
        return parts.join("\n\n").slice(-8000);
    }
    function recapChapterNo() { return Math.max(1, Math.floor((roundNo() - 1) / 5) + 1); }
    function vocabKeyOfTerm(term) { return String(term || "").slice(0, 64).toLowerCase(); }

    /* ---- 复盘弹层 ---- */
    var recapMask = null;
    var recapState = { mode: "idle", msg: "", expressions: [], writing: [] };   // mode: idle|busy|err|done
    function openRecap() {
        if (!langActive()) return;
        if (!recapMask) {
            recapMask = document.createElement("div");
            recapMask.className = "lg-rm-mask";
        }
        if (!recapMask.parentNode) document.body.appendChild(recapMask);   // closeRecap 后复开:重新挂回
        recapState = { mode: "idle", msg: "", expressions: [], writing: [] };
        recapMask.innerHTML =
            '<div class="lg-rm">' +
                '<img class="lg-rm-img" src="lang/recap-top.webp" alt="章末复盘" loading="lazy">' +
                '<div class="lg-rm-scroll">' +
                    '<div class="lg-rm-head">' + uiIconHtml("📋") + ' 第 ' + recapChapterNo() + " 章复盘<span class=\"lg-rm-close\" data-act=\"rm-close\">✕</span></div>" +
                    '<div class="lg-rm-note">每 5 轮一小章:先看看你点查过的词,再让 AI 从剧情里提炼值得收藏的表达——全都会进大厅「⑤ 我的生词本」。</div>' +
                    '<div id="lg-rm-sec1"></div><div id="lg-rm-sec2"></div><div id="lg-rm-sec3"></div>' +
                "</div>" +
            "</div>";
        fillRecapWords();
        fillRecapAi();
        if (recapMask.dataset.esckey) document.removeEventListener("keydown", recapEsc);
        document.addEventListener("keydown", recapEsc);
        recapMask.dataset.esckey = "1";
    }
    function closeRecap() {
        if (recapMask) {
            recapMask.innerHTML = "";
            if (recapMask.parentNode) recapMask.parentNode.removeChild(recapMask);
            if (recapMask.dataset) delete recapMask.dataset.esckey;
        }
        document.removeEventListener("keydown", recapEsc);
    }
    window.closeLangRecap = closeRecap;   // 供主站切页收口(closeAllOverlaysOnLeave)跨 IIFE 调用
    function recapEsc(e) { if (e && e.key === "Escape") closeRecap(); }
    /* ---- M6d5:章末词测(recap ①区 · 登录用户;题源:剧情金标命中词 > 本章候选 > 本局点查) ---- */
    var quizState = null;   // {band, qs:[{word,zh,corr,opts,pick}], idx, done, subm}
    var quizDone = {};      // band -> {word:1} 本章已测过(重开复盘不再考)
    function optTxt(z) {
        z = String(z || "").split(/[；;]/)[0].trim();
        return z.length > 28 ? z.slice(0, 28) + "…" : z;
    }
    function quizDistractors(band, word, corr) {
        var items = langBankCache[band] || [], n = items.length;
        var start = Math.floor(Math.random() * Math.max(n, 1)), arr = [], i, it, z;
        for (i = 0; i < n && arr.length < 3; i++) {
            it = items[(start + i) % n];
            if (!it || it.w === word) continue;
            z = optTxt(it.zh);
            if (!z || z === corr || arr.indexOf(z) >= 0) continue;
            arr.push(z);
        }
        return arr;
    }
    function buildQuiz(band) {
        var items = langBankCache[band];
        if (!items || !items.length) return null;
        var words = [], i, k, it, done = quizDone[band] || {};
        function pushW(wd) {
            var j;
            if (words.length >= 5) return;
            wd = String(wd || "").toLowerCase();
            if (!wd || done[wd]) return;
            for (j = 0; j < words.length; j++) if (words[j].word === wd) return;
            if (isLearned(band, wd)) return;   // 已掌握的词不再考
            it = langBankItem(band, wd);
            if (!it || !it.zh) return;   // 词库无释义的词不参与词测
            words.push({ word: wd, zh: String(it.zh).slice(0, 80) });
        }
        for (i = 0; i < chSeen.length; i++) pushW(chSeen[i]);                  // 1) 本章剧情里金标命中过的
        for (i = 0; i < chWords.words.length; i++) pushW(chWords.words[i].w);  // 2) 本章候选(没嵌进剧情也当学习词)
        for (k in sessionWords) if (Object.prototype.hasOwnProperty.call(sessionWords, k)) pushW(sessionWords[k].w);   // 3) 本局点查兜底
        if (words.length < 3) return null;   // 词太少:回落点查词表
        var qs = [], q, ds, pos;
        for (i = 0; i < words.length; i++) {
            q = { word: words[i].word, zh: words[i].zh, corr: optTxt(words[i].zh), opts: [], pick: -1 };
            ds = quizDistractors(band, q.word, q.corr);
            q.opts = ds.slice(0, 3);
            pos = Math.floor(Math.random() * (q.opts.length + 1));
            q.opts.splice(pos, 0, q.corr);
            qs.push(q);
        }
        return { band: band, qs: qs, idx: 0, done: false, subm: false };
    }
    function renderQuizInto(box) {
        if (!box) return;
        var st = quizState;
        if (!st || st.done) return;
        var q = st.qs[st.idx], h = "", j;
        h = '<div class="lg-rm-sec">① 本章词测<span class="list-sub">剧情金标词 · 错词下章优先再出现</span></div>';
        h += '<div class="lg-qz"><div class="lg-qz-bar">第 ' + (st.idx + 1) + " / " + st.qs.length + " 题</div>";
        h += '<div class="lg-qz-word">' + esc(q.word) + '</div><div class="lg-qz-tip">选出这个词的中文释义</div>';
        for (j = 0; j < q.opts.length; j++) {
            h += '<button type="button" class="lg-qz-opt" data-act="qz-opt" data-idx="' + st.idx + '" data-opt="' + j + '">' + esc(q.opts[j]) + "</button>";
        }
        h += '<div class="lg-qz-feed"></div></div>';
        box.innerHTML = h;
    }
    function qzPick(el) {
        var st = quizState;
        if (!st || st.done || !el) return;
        var idx = parseInt(el.getAttribute("data-idx") || "-1", 10);
        var opt = parseInt(el.getAttribute("data-opt") || "-1", 10);
        if (idx !== st.idx || opt < 0) return;
        var q = st.qs[st.idx];
        if (!q || opt >= q.opts.length || q.pick >= 0) return;   // 本题已答:防双击
        q.pick = opt;
        var right = q.opts[opt] === q.corr;
        var box = el.parentNode, btns = box.querySelectorAll(".lg-qz-opt"), i, b;
        for (i = 0; i < btns.length; i++) btns[i].disabled = true;
        el.classList.add(right ? "ok" : "bad");
        if (!right) {
            for (i = 0; i < q.opts.length; i++) if (q.opts[i] === q.corr) { b = box.querySelector('[data-opt="' + i + '"]'); if (b) b.classList.add("ok"); }
        }
        var feed = box.querySelector(".lg-qz-feed");
        if (feed) feed.innerHTML = right ? '<span class="ok-t">' + uiIconHtml("✓") + ' 答对了</span>' : '<span class="bad-t">' + uiIconHtml("✗") + ' 记一下:' + esc(q.word) + ' = ' + esc(q.zh.slice(0, 60)) + "</span>";
        setTimeout(function () { qzNext(); }, right ? 620 : 2100);   // 答错多停留读释义
    }
    function qzNext() {
        var st = quizState;
        if (!st || st.done) return;
        if (st.idx + 1 < st.qs.length) { st.idx += 1; renderQuizInto(document.getElementById("lg-rm-sec1")); }
        else finishQuiz();
    }
    function finishQuiz() {
        var st = quizState;
        if (!st || st.done) return;
        st.done = true;
        var okN = 0, i, q, done = quizDone[st.band] || (quizDone[st.band] = {});
        for (i = 0; i < st.qs.length; i++) {
            q = st.qs[i];
            done[q.word] = 1;
            if (q.pick >= 0 && q.opts[q.pick] === q.corr) okN += 1;
        }
        var all = okN === st.qs.length;
        var box = document.getElementById("lg-rm-sec1");
        if (!box) return;
        box.innerHTML = '<div class="lg-rm-sec">① 本章词测<span class="list-sub">' + esc(String(st.band).toUpperCase()) + ' · 掌握 ' + okN + '/' + st.qs.length + '</span></div>' +
            '<div class="lg-qz-done">' + (all ? uiIconHtml("🎉") + ' 全对,本章学习词都掌握了!下章继续遇见新词。' : '答对 ' + okN + '/' + st.qs.length + ' 题。答错的词已标为弱词,下一章剧情会优先安排它们重逢,留意金标词就好。') + '</div>' +
            '<div class="lg-qz-sync">' + uiIconHtml("⏳") + ' 学习进度同步中…</div>';
        submitQuiz(box.querySelector(".lg-qz-sync"));
    }
    function submitQuiz(syncEl) {
        var st = quizState;
        if (!st || !st.qs.length) return;
        var items = [], i, q;
        for (i = 0; i < st.qs.length; i++) {
            q = st.qs[i];
            if (q.pick < 0) continue;
            items.push({ word: q.word, ok: q.opts[q.pick] === q.corr });
        }
        if (!items.length) return;
        function pendAll() { for (i = 0; i < items.length; i++) pushProgPending(st.band, items[i].word, items[i].ok); }
        fetch(API_BASE + "/api/lang/progress", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ band: st.band, items: items })
        })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                if (d && d.ok) {
                    for (i = 0; i < items.length; i++) applyProgResult(st.band, items[i].word, items[i].ok ? "learned" : "weak");
                    if (syncEl) syncEl.innerHTML = uiIconHtml("✓") + " 学习进度已同步云端(错词进入下章重测队列)";
                } else { pendAll(); if (syncEl) syncEl.innerHTML = uiIconHtml("⚠️") + " 同步失败,进度已暂存本地,联网后自动补交"; }
            })
            .catch(function () { pendAll(); if (syncEl) syncEl.innerHTML = uiIconHtml("⚠️") + " 同步失败,进度已暂存本地,联网后自动补交"; });
    }
    function fillRecapWords() {
        var box = document.getElementById("lg-rm-sec1");
        if (!box) return;
        /* M6d5:登录用户先出词测;游客/题不足回落点查词表 */
        if (token()) {
            quizState = buildQuiz(currentLangBand());
            if (quizState) { renderQuizInto(box); return; }
        }
        var arr = [], k;
        for (k in sessionWords) { if (Object.prototype.hasOwnProperty.call(sessionWords, k)) arr.push(sessionWords[k]); }
        arr.reverse();
        var h = '<div class="lg-rm-sec">① 本局点查过的词<span class="list-sub">进卡以来点过即自动收生词本</span></div>';
        if (!arr.length) {
            h += '<div class="lg-rm-empty">本局还没点查词——点剧情里 <span class="lg-hl">蓝色虚线</span> 的生词就会自动收进生词本,也会出现在这里。</div>';
        } else {
            h += '<div class="lg-rm-words">';
            for (var i = 0; i < Math.min(arr.length, 30); i++) {
                var w = arr[i];
                h += '<span class="lg-rm-word"><b>' + esc(w.w) + "</b>" + (w.zh ? "<span>" + esc(String(w.zh).slice(0, 70)) + "</span>" : "") + "</span>";
            }
            h += "</div>";
        }
        box.innerHTML = h;
    }
    function fillRecapAi() {
        var b2 = document.getElementById("lg-rm-sec2"), b3 = document.getElementById("lg-rm-sec3");
        if (!b2 || !b3) return;
        var st = recapState;
        var h2 = '<div class="lg-rm-sec">② 剧情高频表达<span class="list-sub">AI 提炼本章 · 可收藏</span></div>';
        var h3 = '<div class="lg-rm-sec">③ 仿写例句<span class="list-sub">下章练手 · 可收藏</span></div>';
        if (!token()) {
            h2 += '<div class="lg-rm-empty">登录后即可让 AI 读本章剧情,提炼 3-6 条高频表达与仿写句,一键收藏、云端同步。</div>';
            h2 += '<button type="button" class="lg-rm-gen light" data-act="rm-login">先去登录</button>';
        } else if (st.mode === "busy") {
            h2 += '<button type="button" class="lg-rm-gen" disabled>' + uiIconHtml("⏳") + ' AI 正在读这一章…（约 10 秒）</button>';
        } else if (st.mode === "err") {
            h2 += '<div class="lg-rm-empty err">' + esc(st.msg || "生成失败") + "</div>";
            if (st.needPay) h2 += '<div class="btn-row mid"><button type="button" class="lg-rm-gen light" data-act="buy-pack">小额直付 ¥1/¥3</button><button type="button" class="lg-rm-gen light" data-act="buy-member">开通会员不限量</button></div>';
            h2 += '<button type="button" class="lg-rm-gen" data-act="rm-gen">' + uiIconHtml("↻") + ' 重试生成</button>';
        } else if (st.mode === "done") {
            var i2, x;
            for (i2 = 0; i2 < st.expressions.length; i2++) {
                x = st.expressions[i2];
                h2 += '<div class="lg-rm-exp"><span class="lg-rm-star' + (vocabMap[vocabKeyOfTerm(x.en)] ? " saved" : "") + '" data-act="rm-star" data-term="' + esc(x.en) + '" data-zh="' + esc(x.zh) + '" data-ex="' + esc(x.example) + '">' + (vocabMap[vocabKeyOfTerm(x.en)] ? uiIconHtml("✓") : uiIconHtml("★")) + "</span>" +
                    '<div class="lg-rm-exp-main"><div class="lg-rm-exp-en">' + esc(x.en) + '</div><div class="lg-rm-exp-zh">' + esc(x.zh) + '</div>' +
                    (x.example ? '<div class="lg-rm-exp-ex">例: ' + esc(x.example) + "</div>" : "") + "</div></div>";
            }
            if (!st.expressions.length) h2 += '<div class="lg-rm-empty">这一章没有太值得单独收藏的表达,重点看看下面的仿写句吧。</div>';
            for (i2 = 0; i2 < st.writing.length; i2++) {
                var wx = st.writing[i2];
                /* 仿写句没有中文释义,data-zh 必须留空 —— 曾经把句子本身抄进 data-zh,
                   collectExp 原样 POST 成 gloss_zh,列表里就出现「同一条译文上下重复两遍」。
                   留空后由 expSentenceOf 认领,译文走 rvTrFetch 现取并长期缓存。 */
                h3 += '<div class="lg-rm-write"><span class="lg-rm-star' + (vocabMap[vocabKeyOfTerm(wx)] ? " saved" : "") + '" data-act="rm-star" data-term="' + esc(wx) + '" data-zh="" data-ex="">' + (vocabMap[vocabKeyOfTerm(wx)] ? uiIconHtml("✓") : uiIconHtml("★")) + "</span>" +
                    '<div class="lg-rm-write-main">' + esc(wx) + "</div></div>";
            }
            if (!st.writing.length) h3 += '<div class="lg-rm-empty">本章仿写例句为空——把表达的例句当仿写模板也可以。</div>';
        } else {
            h2 += '<button type="button" class="lg-rm-gen" data-act="rm-gen">' + uiIconHtml("✨") + ' 生成剧情高频表达 + 仿写例句（AI 读本章剧情）</button>';
        }
        b2.innerHTML = h2;
        b3.innerHTML = h3;
    }
    function genRecap() {
        if (!token()) { closeRecap(); openLoginSheet(); return; }
        if (recapState.mode === "busy") return;
        recapState = { mode: "busy", msg: "", expressions: [], writing: [], needPay: false };
        fillRecapAi();
        var profile = readProfile();
        fetch(API_BASE + "/api/lang/recap", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({ story: chapterStoryText(), band: String(profile.band || "cet6") })
        })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                if (d && d.ok) {
                    recapState = { mode: "done", msg: "", expressions: d.expressions || [], writing: d.writing || [] };
                } else {
                    recapState.mode = "err";
                    // 2026-09-08:超限云币续用但余额不足 → 直接展示服务端引导(免费次数用完+续用单价+当前余额)
                    recapState.needPay = !!(d && d.code === "INSUFFICIENT_COIN");
                    recapState.msg = (d && d.code === "INSUFFICIENT_COIN" && d.error)
                        ? String(d.error) : ((d && d.message) ? String(d.message) : "生成失败,请稍后重试");
                }
                fillRecapAi();
            })
            .catch(function () { recapState.mode = "err"; recapState.msg = "网络开小差了,请重试"; fillRecapAi(); });
    }
    /* 收藏(表达/仿写句)→ lang_vocab type=expression;服务端按 term 幂等,前端乐观置 ✓ */
    function collectExp(term, zh, ex, btn) {
        var k = vocabKeyOfTerm(term);
        if (!k || !token() || vocabMap[k]) return;
        var title = recapCardTitle();
        var origin = (title ? "卡:「" + title + "」· " : "") + "第 " + recapChapterNo() + " 章复盘";
        fetch(API_BASE + "/api/lang/vocab", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + token() },
            body: JSON.stringify({
                lang: curLearnLang(), type: "expression", term: String(term).slice(0, 64),
                gloss_zh: String(zh || "").slice(0, 500),
                gloss_en: String(ex || "").slice(0, 500),
                origin: String(origin).slice(0, 200),
                context: String(ex || "").slice(0, 300)   // 表达没有"所在句",用仿写例句充当回看线索
            })
        })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                if (!d || !d.ok) return;
                vocabMap[k] = { id: d.id || "", type: "expression", term: String(term).slice(0, 64), gloss_zh: String(zh || ""), gloss_en: String(ex || ""), origin: origin, context: String(ex || ""), status: 0, created_at: "" };
                noteWords([{ w: String(term), en: "", zh: String(zh || "") }], "gloss");   // 单字词回填正文高亮库
                reDirty = true;
                if (btn) { btn.classList.add("saved"); btn.innerHTML = uiIconHtml("✓"); }
            }).catch(function () {});
    }
    function openLoginSheet() {
        // 登录层唯一开合点;AuthService 未就绪时退回文字提示
        try { AuthService.openLogin(); } catch (e) { hint("请先登录账号"); }
    }
    function handleRecapAct(el, act) {
        if (!el) return;
        if (act === "rm-close") closeRecap();
        else if (act === "rm-login") openLoginSheet();
        else if (act === "rm-gen") genRecap();
        else if (act === "rm-star") {
            if (el.classList.contains("saved")) return;
            collectExp(el.getAttribute("data-term") || "", el.getAttribute("data-zh") || "", el.getAttribute("data-ex") || "", el);
        }
        else if (act === "qz-opt") qzPick(el);   // M6d5:章末词测选项
        else if (act === "recap-open") openRecap();
    }
    /* ---- M6d1 五档考试词库:按档懒加载(/api/lang/bank + localStorage 缓存),点查考纲化/嵌词/词测共用 ---- */
    var langBankCache = {};      // band -> items[]
    var langBankMapCache = {};   // band -> {word: item}
    var langBankLoading = {};    // band -> Promise(防并发)
    function bankCacheKey(band) { return "lang_bank_v4_" + band; }
    /* v4(2026-09-22):旧版把五档并集整批塞进 localStorage —— 六级起累积(六级5713/考研6277/托福8128),
       五档合计约 265 万字符,浏览器按 UTF-16 算 ≈5MB,正好压满单源配额。setItem 抛 QuotaExceededError
       被下面静默吞掉,于是"缓存"其实从没写进去过,每次进学习中心都要重下 300-780KB(用户反馈的"加载时间过长");
       更糟的是配额被占满后,app 其它模块的 localStorage 写入也会开始静默失败。
       改成预算内缓存:超预算先逐出最久未用的那档,配额仍满则清空词库缓存再试,再失败就只留内存副本。
       v1/v2/v3 一并清理 —— 旧数据既占地方,又正是压垮配额的那批。 */
    var BANK_CACHE_BUDGET = 1000000;   // 词库缓存总预算(字符数 ≈2MB UTF-16);余量留给存档/会话/生词本
    var BANK_LRU_KEY = "lang_bank_lru";
    (function () {
        try {
            var bs = ["hs", "cet4", "cet6", "ky", "toefl"];
            for (var i = 0; i < bs.length; i++) {
                localStorage.removeItem("lang_bank_v1_" + bs[i]);
                localStorage.removeItem("lang_bank_v2_" + bs[i]);
                localStorage.removeItem("lang_bank_v3_" + bs[i]);
            }
            localStorage.removeItem(BANK_LRU_KEY);
        } catch (e) {}
    })();
    function bankCachePut(key, s) {
        try {
            var lru = [], i;
            try { var a = JSON.parse(localStorage.getItem(BANK_LRU_KEY) || "[]"); if (Array.isArray(a)) lru = a; } catch (e2) {}
            lru = lru.filter(function (x) { return x && x.k && x.k !== key && localStorage.getItem(x.k) !== null; });
            lru.unshift({ k: key, n: s.length });
            var tot = 0;
            for (i = 0; i < lru.length; i++) tot += Number(lru[i].n) || 0;
            while (lru.length > 1 && tot > BANK_CACHE_BUDGET) { tot -= Number(lru[lru.length - 1].n) || 0; localStorage.removeItem(lru.pop().k); }
            localStorage.setItem(key, s);
            localStorage.setItem(BANK_LRU_KEY, JSON.stringify(lru));
            return;
        } catch (e) {}
        try {   // 配额被别的模块先占满了:把词库缓存全让出来再试一次
            var all = [], j;
            for (j = 0; j < localStorage.length; j++) { var k = localStorage.key(j); if (k && k.indexOf("lang_bank_v4_") === 0) all.push(k); }
            for (j = 0; j < all.length; j++) localStorage.removeItem(all[j]);
            localStorage.removeItem(BANK_LRU_KEY);
            localStorage.setItem(key, s);
            localStorage.setItem(BANK_LRU_KEY, JSON.stringify([{ k: key, n: s.length }]));
        } catch (e) {}
    }
    function loadLangBank(band, force) {
        band = String(band || "").trim();
        if (!band) return Promise.resolve(null);
        if (langBankCache[band]) return Promise.resolve(langBankCache[band]);
        if (langBankLoading[band]) return langBankLoading[band];
        if (!force) {
            try {
                var saved = localStorage.getItem(bankCacheKey(band));
                if (saved) {
                    var obj = JSON.parse(saved);
                    if (obj && Array.isArray(obj.items) && obj.items.length) {
                        langBankCache[band] = obj.items;
                        try { flushPendSens(); } catch (e) {}   // M6d3 补:本地缓存命中同样补切挂起句
                        return Promise.resolve(obj.items);
                    }
                }
            } catch (e) {}
        }
        langBankLoading[band] = fetch(API_BASE + "/api/lang/bank?band=" + encodeURIComponent(band) + "&lang=" + encodeURIComponent(curLearnLang()))
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
                langBankLoading[band] = null;
                if (!d || !d.ok || !Array.isArray(d.items)) return null;
                langBankCache[band] = d.items;
                bankCachePut(bankCacheKey(band), JSON.stringify({ band: band, total: d.total || d.items.length, items: d.items }));
                try { if (chWords.band === band && !chWords.ready) ensureChWords(); } catch (e) {}   // M6d4:词库就绪补抽本章候选
                try { flushPendSens(); } catch (e) {}   // M6d3 补:挂起的句子补切(词库兜底)
                return d.items;
            })
            .catch(function () { langBankLoading[band] = null; return null; });
        return langBankLoading[band];
    }
    function langBankItem(band, word) {
        band = String(band || "").trim();
        var items = langBankCache[band];
        if (!items || !items.length || !word) return null;
        var map = langBankMapCache[band];
        if (!map) {
            map = langBankMapCache[band] = {};
            /* 查表键统一小写:考研源含 April/Bible 等 31 个专有名词原形大写,不折平则点查永远 miss */
            for (var i = 0; i < items.length; i++) map[String(items[i].w || "").toLowerCase()] = items[i];
        }
        return map[String(word).toLowerCase()] || null;
    }
    function langBankStatus(band) {
        band = String(band || "").trim();
        return { loaded: !!langBankCache[band], loading: !!langBankLoading[band], total: langBankCache[band] ? langBankCache[band].length : 0 };
    }
    /* ---- 单词发音(2026-09-26):点译弹层里的小喇叭 + 手机设置里的发音设置 ----
       只用浏览器自带的 speechSynthesis,不引第三方音频:免流量、免鉴权、离线也在。
       音色不点名:各端名字完全不一样(Windows 是 Microsoft Huihui/Yaoyao,安卓是 Google 普通话…),
       点名一个就等于在别的设备上没声音。改成按名字打分挑——「名字像女声」加分、「像男声」减分、
       本机离线音色再加分(在线音色如 Google 在国内常静默失败);挑不出就交给系统默认。
       小徐要的「兼容各种用户端浏览器默认女声」就是靠这层打分,而不是写死某个音色名。
       音色列表是异步到货的(Chrome 首帧 getVoices() 就是空数组),到货后叫手机设置页重画一次下拉。 */
    var SAY_CODE = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };
    var SAY_SAMPLE = { en: "hello", ja: "こんにちは", ko: "안녕하세요" };
    var FEMALE_HINT = ["zira", "aria", "jenny", "michelle", "ana", "samantha", "karen", "moira", "tessa",
        "xiaoxiao", "xiaoyi", "huihui", "yaoyao", "nanami", "ayumi", "haruka", "kyoko", "sayaka",
        "sunhi", "heami", "yuna", "female", "woman"];
    var MALE_HINT = ["david", "mark", "guy", "george", "james", "ryan", "steffan", "eric", "roger",
        "ichiro", "keita", "injoon", "gook", "kangkang", "male", "man "];
    var liveUtts = [];   // 正在念的 utterance 必须有人持有:被 GC 掉会念到一半断音(Chrome/iOS 实测)
    var voicesWired = false;

    function saySupported() {
        return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }
    function sayCode(lang) { return SAY_CODE[String(lang || "en").slice(0, 2)] || "en-US"; }
    /* 发音设置住在手机设置里(存档内的 phoneSettings),这里只读。读取时兜底:
       老存档没有这几个新键,tts 缺省当作开(缺省不发音等于功能没上线)。 */
    function sayPref() {
        var ps = null;
        try { ps = (window.PhoneSettingsService && PhoneSettingsService.get()) || null; } catch (e) { ps = null; }
        ps = ps || {};
        var rate = Number(ps.ttsRate);
        return {
            on: ps.tts !== false,
            rate: (rate >= 0.5 && rate <= 1.6) ? rate : 1,
            /* 手选音色覆盖表 { en: voiceURI }:老存档里没有,首次手选时才由手机设置页建立。
               不在 DEFAULTS 里放 {}——对象会被所有用户共用同一份引用。 */
            store: (ps.ttsVoice && typeof ps.ttsVoice === "object") ? ps.ttsVoice : null
        };
    }
    function allVoices() {
        try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
    }
    function voicesFor(code) {
        var c = String(code || "en-US").toLowerCase().slice(0, 2);
        /* 按语言主标签匹配:同一语种会出现 en-GB / en_US 等写法,只比前两位 */
        return allVoices().filter(function (v) {
            return String(v.lang || "").replace("_", "-").toLowerCase().indexOf(c) === 0;
        });
    }
    function scoreVoice(v) {
        var n = String(v.name || "").toLowerCase(), s = 0, i;
        for (i = 0; i < FEMALE_HINT.length; i++) { if (n.indexOf(FEMALE_HINT[i]) >= 0) { s += 100; break; } }
        for (i = 0; i < MALE_HINT.length; i++) { if (n.indexOf(MALE_HINT[i]) >= 0) { s -= 100; break; } }
        if (v.localService) s += 20;
        return s;
    }
    function pickVoice(code, store) {
        var list = voicesFor(code);
        if (!list.length) return null;
        var ov = store && store[String(code).slice(0, 2)];
        for (var i = 0; i < list.length; i++) if (list[i].voiceURI === ov) return list[i];
        return list.slice().sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); })[0];
    }
    /* 念一段文本。返回 false = 没念成(该语种一个音色都没有 / 浏览器不支持),
       调用方据此决定要不要说话,引擎自己不弹窗、不打扰。 */
    function sayOne(text, lang) {
        var t = String(text == null ? "" : text).trim();
        if (!t || !saySupported()) return false;
        var p = sayPref(), code = sayCode(lang);
        if (!voicesFor(code).length) return false;
        try {
            window.speechSynthesis.cancel();   // 连点小喇叭:后一次压掉前一次,不叠着念
            liveUtts.length = 0;
            var u = new SpeechSynthesisUtterance(t);
            u.lang = code;
            u.rate = p.rate;
            var v = pickVoice(code, p.store);
            if (v) u.voice = v;
            liveUtts.push(u);
            var drop = function () { liveUtts = liveUtts.filter(function (x) { return x !== u; }); };
            u.onend = drop;
            u.onerror = drop;
            window.speechSynthesis.speak(u);
            return true;
        } catch (e) { return false; }
    }
    /* 音色列表异步到货:到货后手机设置页那个下拉要重画一遍,否则用户看到的是「暂无可用音色」 */
    function wireVoices() {
        if (voicesWired || !saySupported()) return;
        voicesWired = true;
        try {
            allVoices();   // 有些浏览器要调过一次才开始加载
            window.speechSynthesis.onvoiceschanged = function () {
                try { if (window.PhoneSettingsService) PhoneSettingsService.refreshUI(); } catch (e) {}
            };
        } catch (e) {}
    }
    /* 手机设置页的下拉用:「暂无」也出一项,免得下拉空着一片白 */
    function voiceOptions(code) {
        var list = voicesFor(code);
        var uniq = [], seen = {}, i, v, key;
        for (i = 0; i < list.length; i++) {
            v = list[i];
            key = String(v.voiceURI || v.name || i);
            if (seen[key]) continue;
            seen[key] = 1;
            uniq.push({
                uri: key,
                /* 别用 ♀ 符号:这条 label 是喂给 <option> 的 textContent,塞不了 SVG;
                   而裸字符伪图标会被 lang_skeleton_test 的「图标必须走 uiIconHtml」扫出来。用中文后缀,和 · 本地/· 在线 同款。 */
                label: String(v.name || key) + (scoreVoice(v) >= 100 ? " · 女声" : "") + (v.localService ? " · 本地" : " · 在线"),
                female: scoreVoice(v) >= 100
            });
        }
        uniq.sort(function (a, b) { return (b.female ? 1 : 0) - (a.female ? 1 : 0); });
        return uniq;
    }
    function sayBtnHtml(disp) {
        if (!saySupported() || !sayPref().on) return "";
        return '<button type="button" class="lg-pop-say" data-act="say" data-say="' + esc(disp) + '"'
            + ' aria-label="朗读" title="朗读">' + uiIconHtml("🔊") + "</button>";
    }
    window.LangSpeech = {
        supported: saySupported,
        say: sayOne,                        // say(词, 语种) → true/false
        sayCode: sayCode,
        sample: function (lang) { return SAY_SAMPLE[String(lang || "en").slice(0, 2)] || SAY_SAMPLE.en; },
        learnCode: curLearnLang,            // 手机设置页按「学习语种」发音(不在会话里时随语言页所选)
        options: voiceOptions,              // 设置页下拉用
        voices: voicesFor,
        pick: pickVoice,
        pref: sayPref
    };
    wireVoices();

    /* 给任意一块静态 HTML(档案弹层、详情弹层…)切词,切完就能走 document 级那套点查委托。
       两条护栏:
       ① 交互元素里的文字不动 —— 委托命中 .lg-word 时会 preventDefault + stopPropagation,
          按钮文字真被包成 .lg-word,点按钮就变成了查词,按钮自己永远点不着;
       ② 非语言会话直接返回,不给普通模式平添一堆 span。 */
    function decorateTree(root) {
        if (!root || !root.querySelectorAll || !langActive()) return;
        var skip = 'a,button,input,textarea,select,label,[role="button"],[onclick],script,style,svg';
        var all = root.querySelectorAll("*"), hosts = [], i;
        for (i = 0; i < all.length; i++) {
            if (all[i].closest && all[i].closest(skip)) continue;
            hosts.push(all[i]);
        }
        for (i = 0; i < hosts.length; i++) wrapWords(hosts[i]);
    }
    window.LangAssist = {
        loadBank: loadLangBank, bankItem: langBankItem, bankStatus: langBankStatus,
        decorate: decorateTree,               // 静态 HTML 块补切词(档案/详情弹层用)
        reloadVocab: retryVocab,            // 切语种/重新登录后重拉生词本;走 retryVocab 才能解开上次的失败态
        /* 学习中心的「进入今日复习」要用:页签状态 vocabTab 只在本文件里,外面改不到,
           先拨到 due 再整页跳转,免得落到用户上次停留的「全部生词库」(2026-09-26) */
        openDueTab: function () {
            vocabTab = "due";
            if (window.LangController && window.LangController.goVocab) window.LangController.goVocab();
        },
        getChapterWords: getChapterWords,   // M6d4:当前章候选词(供 LangEngine 续写注入;内部触发预载/抽词)
        /* R1 生词回投取样:续写注入用;优先复习到期→未掌握新学→眼熟补位;只取单词(expression 跳过),≤10;未加载时静默触发拉取 */
        reviewVocabSample: function (max) {
            if (!vocabLoaded) { loadVocab(function () {}); return []; }
            var cap = Math.max(1, Math.min(10, Number(max) || 10));
            var done = reviewDoneSet();
            var due = [], fresh = [], seen = [], k, it, term;
            var tday = todayBjInt();
            for (k in vocabMap) {
                if (!Object.prototype.hasOwnProperty.call(vocabMap, k)) continue;
                it = vocabMap[k];
                if (!it || it.type === "expression") continue;
                term = String(it.term || "").trim();
                if (!injectableTerm(term)) continue;                              // 词组/含生僻符号不注入
                if (Number(it.status || 0) >= 2) continue;                        // 已掌握毕业不打扰
                if (srsIsDue(it, tday) && done.indexOf(String(it.id)) < 0) {
                    due.push(term);                                              // 按 SRS 阶梯到期(当日未自评)
                } else if (Number(it.status || 0) === 0) fresh.push({ t: term, c: String(it.created_at || "") });
                else seen.push({ t: term, c: String(it.created_at || "") });
            }
            function rndTake(arr, n) {
                var a = arr.slice(), res = [], i;
                while (a.length && res.length < n) { i = Math.floor(Math.random() * a.length); res.push(a[i]); a.splice(i, 1); }
                return res;
            }
            var out = due.slice(0, cap), rest = cap - out.length;
            if (rest > 0) {
                fresh.sort(function (a, b) { return a.c < b.c ? 1 : -1; });
                out = out.concat(rndTake(fresh.slice(0, 40), rest).map(function (x) { return x.t; }));
                rest = cap - out.length;
                if (rest > 0) {
                    seen.sort(function (a, b) { return a.c < b.c ? 1 : -1; });
                    out = out.concat(rndTake(seen.slice(0, 40), rest).map(function (x) { return x.t; }));
                }
            }
            return out.slice(0, cap);
        },
        /* M8d:生词本独立子页 — 切页钩子直接调,绕开 MutationObserver 1.5s 节流;
           进这一页就是明确的"我要看生词"动作,顺带把上次的失败态解开重拉 */
        refreshVocab: retryVocab,
        reloadVocabForLang: retryVocab,
        /* M9F:渲染方挂卡后注册双语(卡首轮/渐进第 2 轮 AI 输出)→ 同步烘烤行间译文,免 AI 点译;
           attachBiAttr 供 finishStreaming 在 mountedHtml 快照前先写 data-bi(历史重放还原用) */
        attachStoryBi: attachStoryBi,
        attachBiAttr: attachBiAttr
    };

    /* ---- 排行榜:学习时长埋点(2026-09-06)----
       口径:英语文游游玩(view-main 且 LangEngine 会话)+ 语言首页/学习中心/生词本停留(剧本库已并入语言首页,同样计入);
       10s tick 连续两拍都在学且页面可见才累计该区间;累计满 60s 或页面隐藏即上报 PUT /api/lang/study(登录才记,游客丢弃);失败保留待下轮补报 */
    (function () {
        var INTERVAL_MS = 10000, FLUSH_SEC = 60;
        var acc = 0, lastTs = 0, inLearn = false;
        function viewOn(id) {
            var el = document.getElementById(id);
            return !!(el && el.classList && el.classList.contains("active"));
        }
        function learnActive() {
            try {
                if (viewOn("view-main")) return !!(window.LangEngine && window.LangEngine.isLangSession());
                return viewOn("view-lang") || viewOn("view-lang-learn") || viewOn("view-lang-vocab");
            } catch (e) { return false; }
        }
        function flush() {
            var n = Math.floor(acc);
            if (n < 1) return;
            var t = token();
            if (!t) { acc = 0; return; }
            fetch(API_BASE + "/api/lang/study", {
                method: "PUT", headers: { "Content-Type": "application/json", "X-Auth-Token": "Bearer " + t },
                body: JSON.stringify({ lang: curLearnLang(), seconds: Math.min(n, 600) })
            }).then(function (r) {
                if (r.ok) { acc -= n; if (acc < 0) acc = 0; }
            }).catch(function () {});
        }
        function tick() {
            var now = Date.now();
            if (!lastTs) { lastTs = now; inLearn = learnActive() && !document.hidden; return; }
            var dt = now - lastTs; lastTs = now;
            if (dt > 0) {
                var ok = learnActive() && !document.hidden;
                if (ok && inLearn) acc += dt / 1000;   // 只有连续可见学习才计,切走/隐藏即断
                inLearn = ok;
            }
            if (acc >= FLUSH_SEC) flush();
            lgImm.tick(!!document.hidden);   // 无阻畅读:结算离屏/已摘除的句子,并按需上报
        }
        setInterval(tick, INTERVAL_MS);
        document.addEventListener("visibilitychange", function () {
            tick();
            if (document.hidden) { flush(); lgImm.flush(); }
        });
        window.addEventListener("pagehide", flush, false);
        window.addEventListener("pagehide", function () { lgImm.flush(); }, false);
    })();
})();
