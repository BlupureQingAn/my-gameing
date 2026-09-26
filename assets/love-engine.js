
/* ===== R1 恋爱攻略 LoveEngine(love_mode 攻略卡:选项标签结算/锁线淡出/好感UI/心动时刻/角色卡/结局)
   只作用于 language 会话 + 卡 structured.love_mode=true;普通会话全程零影响 ===== */
window.LoveEngine = (() => {
    const esc = (s) => { try { return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); } catch (e) { return ""; } };
    function curCard() { try { return ScenarioCardService.getSelectedCard(); } catch (e) { return null; } }
    function getState() { try { return StateService.get(); } catch (e) { return null; } }
    function isLang() { return !!(window.LangEngine && window.LangEngine.isLangSession && window.LangEngine.isLangSession()); }
    function isLoveSession() {
        try {
            const c = curCard();
            return !!(c && c.structured && c.structured.love_mode === true && isLang());
        } catch (e) { return false; }
    }
    // 标签数值模板:卡级 love_rules.affection 可覆盖(缺省=引擎默认)
    function rulesOf(st) {
        const lr = (st && st.love_rules) || {};
        const base = {
            flirt: { favor: 1, affection: 6 }, kind: { favor: 4, affection: 1 }, tease: { favor: 2, affection: 2 },
            neutral: { favor: 1, affection: 0 }, awkward: { favor: 0, affection: -2 },
            rude: { favor: -4, affection: -3 }, reject: { favor: -3, affection: -8 }
        };
        const custom = (lr.affection && typeof lr.affection === "object") ? lr.affection : {};
        Object.keys(custom).forEach((k) => {
            if (!base[k]) return;
            const v = custom[k];
            if (v && typeof v === "object") {
                base[k] = {
                    favor: v.favor == null ? base[k].favor : Number(v.favor),
                    affection: v.affection == null ? base[k].affection : Number(v.affection)
                };
            } else {
                base[k] = { favor: base[k].favor, affection: Number(v) || 0 };
            }
        });
        return {
            slots: Number(lr.slots) > 0 ? Number(lr.slots) : 3,
            lock_at: Number(lr.lock_at) > 0 ? Number(lr.lock_at) : 70,
            he_aff: (lr.he_end && Number(lr.he_end.min_affection)) || 75,
            be_aff: (lr.be_end && Number(lr.be_end.min_affection)) || 30,
            affection: base
        };
    }
    function rules() { try { const c = curCard(); return rulesOf(c && c.structured); } catch (e) { return rulesOf(null); } }
    function findNpc(state, name) {
        const n = String(name || "").trim().toLowerCase();
        if (!n) return null;
        const list = (state && state.npcs) || [];
        return list.find((x) => String(x.name || "").trim().toLowerCase() === n)
            || list.find((x) => String(x.id || "").toLowerCase() === n)
            || list.find((x) => String(x.role || x.relationship || "").trim().toLowerCase() === n) || null;
    }
    // R1 立绘:统一走全局 npcImageOf(卡 structured.npcs[].art 立绘原图 → npc.art → 用户手动头像 → 头像池),
    // 与世界页 NPC 卡/档案详情/微信头像同一索引,保证同一 NPC 处处同图
    function artUrlOf(npc) {
        try {
            if (!npc) return "";
            if (typeof window.npcImageOf === "function") return String(window.npcImageOf(npc) || "");
            for (const k of ["art", "avatar"]) {
                const v = String(npc[k] || "");
                if (v && (v.startsWith("http") || v.startsWith("data:"))) return v;
            }
            return "";
        } catch (e) { return ""; }
    }
    function avHtmlOf(npc, name) {
        const u = artUrlOf(npc);
        return u ? `<img src="${esc(String(u).replace(/"/g, "%22"))}" alt="" loading="lazy">` : esc((String(name || "♥")[0]));
    }
    // 当前回合在场的主要互动角色:最近一张结构化卡正文最后出现的 npc
    function currentTarget(state) {
        const hist = (state && state.history) || [];
        for (let i = hist.length - 1; i >= 0; i--) {
            const h = hist[i];
            if (!h || h.role !== "ai" || !String(h.text || "").includes("data-structured-card")) continue;
            const txt = String(h.text || "").replace(/<[^>]*>/g, " ");
            let hit = null;
            for (const npc of (state.npcs || [])) { if (txt.includes(String(npc.name || ""))) hit = npc; }
            return hit || null;
        }
        return null;
    }
    function stageOf(aff) { aff = Number(aff) || 0; return aff >= 75 ? "倾心" : aff >= 60 ? "心动" : aff >= 30 ? "熟络" : "相识"; }
    function loveStateOf(state) {
        if (!state || !state.loveState || typeof state.loveState !== "object") {
            if (state) state.loveState = { lockedId: "", lockedName: "" };
        }
        return state ? state.loveState : { lockedId: "", lockedName: "" };
    }
    function lockedNpcOf(state, ls) {
        const l = ls || loveStateOf(state);
        if (!l.lockedId && !l.lockedName) return null;
        return (state.npcs || []).find((x) => String(x.id || "") === String(l.lockedId || "") || String(x.name || "") === String(l.lockedName || "")) || null;
    }
    /* ---- 结算:点选选项 → love 标签 → npc 好感;锁线后他人 affection 冻结(淡出) ---- */
    function settleChoice({ love = "", target = "" } = {}) {
        try {
            if (!isLoveSession()) return null;
            const state = getState();
            if (!state) return null;
            const npc = findNpc(state, target) || currentTarget(state);
            if (!npc) return null;
            const r = rules();
            const d = r.affection[love] || r.affection.neutral;
            const ls = loveStateOf(state);
            const lockedNpc = lockedNpcOf(state, ls);
            const isLockedNpc = lockedNpc && (String(lockedNpc.id) === String(npc.id || "") || String(lockedNpc.name) === String(npc.name || ""));
            const oldAff = Number(npc.affection) || 0;
            const oldFav = Number(npc.favor) || 0;
            let dAff = Number(d.affection) || 0;
            if (lockedNpc && !isLockedNpc && dAff > 0) dAff = 0; // 锁线后其余角色感情不再升温
            npc.favor = Math.max(0, Math.min(100, oldFav + (Number(d.favor) || 0)));
            npc.affection = Math.max(-100, Math.min(100, oldAff + dAff));
            // 自动锁线:未锁时若有角色爱慕 ≥ lock_at,锁定爱慕最高的那位(其余自动淡出)
            let lockedNow = false, lockedName = "";
            if (!lockedNpc) {
                const top = (state.npcs || []).filter((x) => Number(x.affection) >= r.lock_at)
                    .sort((a, b) => (Number(b.affection) || 0) - (Number(a.affection) || 0))[0];
                if (top) {
                    ls.lockedId = String(top.id || ""); ls.lockedName = String(top.name || "");
                    lockedNow = true; lockedName = String(top.name || "");
                    try { StateService.pushHistory({ role: "ai", date: Utils.nowDateStr(state), text: `> 💗 **心动锁定**：你与 ${top.name} 的距离已近到无法忽视。从这一刻起，故事的重心将落在你们之间——其他人会渐渐退到朋友的位置。` }); } catch (e) {}
                }
            }
            StateService.save();
            syncBar();
            const stage = stageOf(npc.affection);
            return { npc, love, dFavor: (Number(npc.favor) - oldFav), dAffection: (Number(npc.affection) - oldAff), stage, lockedNow, lockedName };
        } catch (e) { console.warn("[Love] settleChoice:", e); return null; }
    }
    /* ---- UI:顶部角色条 ---- */
    function syncBar() {
        try {
            const box = document.getElementById("play-love-bar");
            if (!box) return;
            if (!isLoveSession()) { box.classList.remove("show"); box.innerHTML = ""; return; }
            const state = getState();
            const list = (state && state.npcs) || [];
            const r = rules();
            const ls = loveStateOf(state);
            const lockedNpc = lockedNpcOf(state, ls);
            const cur = currentTarget(state);
            const html = list.map((n) => {
                const aff = Number(n.affection) || 0;
                const pct = Math.max(0, Math.min(100, (aff + 100) / 2));
                const lockedCls = lockedNpc && (String(lockedNpc.id) === String(n.id || "") || String(lockedNpc.name) === String(n.name || "")) ? " locked" : "";
                const isCur = cur && String(cur.name) === String(n.name || "") ? " active" : "";
                const nm = esc(String(n.name || "?"));
                const av = avHtmlOf(n, String(n.name || "?"));
                return `<div class="love-npc${lockedCls}${isCur}" data-lv-npc="${esc(nm)}"><div class="lv-av" data-lv-art="1" title="点击放大立绘">${av}</div>` +
                    `<div><div class="lv-name">${nm}</div><div class="lv-aff"><b>♥ ${aff}</b> · ${esc(stageOf(aff))}</div>` +
                    `<div class="lv-heart"><i style="width:${pct}%;"></i></div></div></div>`;
            }).join("");
            box.innerHTML = html;
            box.classList.add("show");
            Array.prototype.forEach.call(box.querySelectorAll("[data-lv-npc]"), (el) => {
                const npcObj = findNpc(state, el.getAttribute("data-lv-npc"));
                el.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    try {
                        const openPop = document.getElementById("lv-pop-el");
                        if (openPop && npcObj && openPop.getAttribute("data-npc") === String(npcObj.name || "")) { closePop(); return; }
                        showNpcCard(el, npcObj);
                    } catch (e) {}
                });
                // 头像单独可点:全屏灯箱放大观赏立绘原图(不触发右侧角色卡弹层)
                const avEl = el.querySelector("[data-lv-art]");
                if (avEl) {
                    avEl.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        try {
                            const u = artUrlOf(npcObj);
                            if (u && window.openImageLightbox) window.openImageLightbox(u, npcObj ? npcObj.name : "");
                        } catch (e) {}
                    });
                }
            });
        } catch (e) { console.warn("[Love] syncBar:", e); }
    }
    function closePop() {
        const p = document.getElementById("lv-pop-el");
        if (p) p.remove();
    }
    function showNpcCard(anchor, npc) {
        closePop();
        if (!npc) return;
        const st = getState();
        const ls = loveStateOf(st);
        const lockedNpc = lockedNpcOf(st, ls);
        const isLocked = lockedNpc && (String(lockedNpc.id) === String(npc.id || "") || String(lockedNpc.name) === String(npc.name || ""));
        const nm = esc(String(npc.name || "?"));
        const av = avHtmlOf(npc, String(npc.name || "?"));
        const prof = (npc.profile && typeof npc.profile === "object") ? npc.profile : {};
        const lines = [
            prof.identity ? `身份：${esc(String(prof.identity))}` : (npc.relation ? `身份：${esc(String(npc.relation))}` : ""),
            String(npc.gender || "") ? `性别：${esc(String(npc.gender))}` : "",
            prof.age ? `年龄：${esc(String(prof.age))}` : "",
            String(npc.mood || "") ? `心情：${esc(String(npc.mood))}` : "",
            String(npc.status || "") ? `状态：${esc(String(npc.status))}` : "",
            prof.personality ? `性格：${esc(String(prof.personality))}` : "",
            npc.traits ? `特质：${esc(String(npc.traits))}` : "",
            isLocked ? uiIconHtml("🔒") + " 你们已经走到一起" : ""
        ].filter(Boolean).join("\n");
        const el = document.createElement("div");
        el.id = "lv-pop-el";
        el.className = "lv-pop";
        el.setAttribute("data-npc", String(npc.name || ""));
        el.innerHTML = `<div class="lvp-head"><div class="lvp-av">${av}</div><div><div class="lvp-t">${nm}${isLocked ? " " + uiIconHtml("🔒") : ""}</div>` +
            `<div class="lvp-s">友善 ${esc(String(npc.favor))} · 爱慕 ${esc(String(npc.affection ?? 0))}（${esc(stageOf(npc.affection))}）</div></div></div>` +
            `<div class="lvp-body">${lines || "尚未了解的TA…"}</div>`;
        document.body.appendChild(el);
        // 弹层头像也可点:灯箱放大看立绘原图
        const avBox = el.querySelector(".lvp-av");
        if (avBox) {
            avBox.style.cursor = "zoom-in";
            avBox.title = "点击放大查看原图";
            avBox.addEventListener("click", (ev) => {
                ev.stopPropagation();
                try {
                    const u = artUrlOf(npc);
                    if (u && window.openImageLightbox) window.openImageLightbox(u, String(npc.name || ""));
                } catch (e) {}
            });
        }
        const r = anchor.getBoundingClientRect();
        el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left)) + "px";
        el.style.top = Math.max(8, r.bottom + 6) + "px";
        setTimeout(() => { const ex = document.getElementById("lv-pop-el"); if (ex && ex === el) ex.remove(); }, 5200);
    }
    function showFloat(anchorEl, dAff, dFav, npcName) {
        try {
            if (!anchorEl) return;
            const r = anchorEl.getBoundingClientRect();
            const parts = [];
            if (dAff > 0) parts.push(`+${dAff} ♥`);
            else if (dAff < 0) parts.push(`${dAff} ♥`);
            if (dFav > 0) parts.push(`+${dFav} 友善`);
            else if (dFav < 0) parts.push(`${dFav} 友善`);
            const txt = parts.length ? parts.join(" ") : "";
            if (!txt) return;
            const f = document.createElement("div");
            f.className = "love-float";
            f.textContent = (npcName ? esc(npcName) + " " : "") + txt;
            f.style.left = (r.left + r.width / 2 - 30) + "px";
            f.style.top = (r.top - 8) + "px";
            document.body.appendChild(f);
            setTimeout(() => f.remove(), 1200);
        } catch (e) {}
    }
    /* ---- 心动时刻卡(fields.heartbeat → overlay 全屏展示) ---- */
    function showHeartbeat(hb) {
        try {
            const state = getState();
            const npc = hb && hb.npc ? findNpc(state, hb.npc) : null;
            const nm = npc ? String(npc.name || hb.npc) : String((hb && hb.npc) || "TA");
            const avHtml = avHtmlOf(npc, String(nm) || "♥");
            const box = document.getElementById("heartbeat-card-content");
            const ov = document.getElementById("heartbeat-overlay");
            if (!box || !ov) return;
            box.innerHTML = `<div class="hb-title">♡ 心动时刻 ♡</div><div class="hb-av">${avHtml}</div>` +
                `<div style="font-weight:800;letter-spacing:.06em;">${esc(nm)}</div>` +
                `<div class="hb-en">“${esc(String((hb && hb.en) || ""))}”</div>` +
                (hb && hb.zh ? `<div class="hb-zh">${esc(String(hb.zh))}</div>` : "") +
                `<div class="hb-close">轻触继续</div>`;
            ov.style.display = "flex";
            const close = () => { ov.style.display = "none"; };
            box.onclick = close;
            setTimeout(close, 4200);
        } catch (e) { console.warn("[Love] heartbeat:", e); }
    }
    /* ---- 钩子:结构化卡渲染完成后调用(每轮) ---- */
    function afterCard(fields) {
        try {
            if (!isLoveSession()) return;
            syncBar();
            if (fields && fields.heartbeat) showHeartbeat(fields.heartbeat);
        } catch (e) {}
    }
    /* ---- 结局解析(love 卡:HE/BE/遗憾,由最高爱慕/锁定线决出) ---- */
    function resolveEnding(state) {
        const r = rules();
        const ls = loveStateOf(state);
        const lockedNpc = lockedNpcOf(state, ls);
        const pool = (state.npcs || []).filter((x) => x && Number.isFinite(Number(x.affection)));
        const top = pool.slice().sort((a, b) => (Number(b.affection) || 0) - (Number(a.affection) || 0))[0] || null;
        const npc = lockedNpc || (top && Number(top.affection) >= r.be_aff ? top : null);
        if (!npc) return { type: "none", npc: null, affection: 0, roundCount: (state.history || []).filter((h) => h.role === "user").length };
        const aff = Number(npc.affection) || 0;
        const roundCount = (state.history || []).filter((h) => h.role === "user").length;
        if (aff >= r.he_aff) return { type: "he", npc, affection: aff, roundCount };
        if (aff >= r.be_aff) return { type: "be", npc, affection: aff, roundCount };
        return { type: "none", npc: null, affection: 0, roundCount };
    }
    // 供结算钩子显示数值浮字:由 bindHtmlChoiceEvents 在 settle 后调用
    function settleFromClick(btnEl, love, target) {
        const res = settleChoice({ love, target });
        if (res && btnEl) showFloat(btnEl, res.dAffection, res.dFavor, res.npc ? res.npc.name : "");
        return res;
    }
    return { isLoveSession, settleChoice, settleFromClick, syncBar, afterCard, showHeartbeat, resolveEnding, rules, stageOf, findNpc, lockedNpcOf, loveStateOf };
})();
