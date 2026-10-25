/* Lexicon Rush - UI layer */
(function () {
  "use strict";

  const E = window.LexiconEngine;
  const C = window.LexiconContent;
  const A = window.LexiconAudio;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const PROFILE_KEY = "lexicon_profile_v1";
  const RUN_KEY = "lexicon_run_v1";
  const BAND_KEY = "lexicon_band_v1";
  const CUSTOM_KEY = "lexicon_custom_set_v1";
  const PROFILE_TS_KEY = "lexicon_profile_ts";
  const IMPORT_POS_ALIAS = { n: "n", noun: "n", v: "v", verb: "v", adj: "adj", adjective: "adj", adv: "adv", adverb: "adv", prep: "prep", preposition: "prep", pron: "pron", pronoun: "pron", conj: "conj", conjunction: "conj", det: "det", art: "det", article: "det", num: "num", interj: "interj", aux: "aux", auxiliary: "aux" };

  const BAND_NAMES = { hs: "高中 3500", cet4: "大学四级", cet6: "大学六级", ky: "考研", toefl: "托福" };
  const POS_CN = { n: "名", v: "动", adj: "形", adv: "副", prep: "介", pron: "代", conj: "连", det: "冠", num: "数", interj: "叹", aux: "助" };
  const BLIND_CN = { small: "小盲注", big: "大盲注", boss: "Boss 盲注" };
  const PATTERN_CN = { high: "散牌", posFlush: "词性同花", collocation: "搭配葫芦", ladder: "语义顺子", grammar: "语法同花顺" };
  const EVENT_CN = {
    vaulted: "归库",
    gold_success: "黄金成功",
    gold_saved: "黄金免降级",
    gold_broken: "黄金失败",
    blurred: "记忆模糊",
    shield: "神经元护盾",
    enhanced: "词卡觉醒",
  };

  const state = {
    profile: loadProfile(),
    band: localStorage.getItem(BAND_KEY) || "hs",
    bankCache: {},
    run: null,
    selected: new Set(),
    hintCard: null,
    screen: "menu",
    modal: null,
    customSet: readCustomSet(),
    cloudPending: null,
    importing: false,
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      return Object.assign(E.defaultProfile(), p || {});
    } catch (e) {
      return E.defaultProfile();
    }
  }

  function saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
      localStorage.setItem(PROFILE_TS_KEY, String(Date.now()));
    } catch (e) {}
    scheduleCloudPush();
  }

  function saveRun() {
    try {
      if (state.run && state.run.phase !== "victory" && state.run.phase !== "gameover") {
        localStorage.setItem(RUN_KEY, JSON.stringify({ band: state.band, run: state.run, ts: Date.now() }));
      } else {
        localStorage.removeItem(RUN_KEY);
      }
    } catch (e) {}
    scheduleCloudPush();
  }

  function clearRun() {
    localStorage.removeItem(RUN_KEY);
  }

  function syncProfile() {
    if (state.run) {
      state.profile = state.run.profile;
      saveProfile();
    }
  }

  function memberInfo() {
    let u = null;
    try {
      u = JSON.parse(localStorage.getItem("bitlife_user_cache_v1") || "null");
    } catch (e) {}
    const isMember =
      !!u && (u.membership_type === "lifetime" || (!!u.membership_type && !!u.membership_expires_at && Date.parse(u.membership_expires_at) > Date.now()));
    return { user: u, isMember };
  }

  // ---------------- account / cloud ----------------
  function authToken() {
    try {
      return localStorage.getItem("pb_auth_token") || "";
    } catch (e) {
      return "";
    }
  }

  function isLoggedIn() {
    return !!authToken();
  }

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, o.headers || {});
    const t = authToken();
    if (t) headers["X-Auth-Token"] = t;
    const res = await fetch(path, { method: o.method || "GET", headers, body: o.body });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || "请求失败 " + res.status);
      err.code = data.code || "";
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function readCustomSet() {
    try {
      const d = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null");
      if (d && d.id && d.name) return d;
    } catch (e) {}
    return null;
  }

  function localSaveTs() {
    let ts = 0;
    try {
      const d = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
      if (d && d.ts) ts = Math.max(ts, Number(d.ts) || 0);
    } catch (e) {}
    ts = Math.max(ts, Number(localStorage.getItem(PROFILE_TS_KEY) || 0));
    return ts;
  }

  let cloudTimer = null;
  function scheduleCloudPush() {
    if (!isLoggedIn()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(pushCloudSave, 2500);
  }

  async function pushCloudSave() {
    if (!isLoggedIn()) return;
    const savedLocal = readSavedRun();
    const payload = {
      profile: state.profile,
      run: savedLocal ? savedLocal.run : null,
      band: state.band,
      client_ts: localSaveTs(),
    };
    try {
      await api("/api/lexicon/save", { method: "POST", body: JSON.stringify(payload) });
    } catch (e) {}
  }

  async function pullCloudSave() {
    if (!isLoggedIn()) return;
    try {
      const d = await api("/api/lexicon/save");
      const cloud = d.save;
      if (!cloud) {
        scheduleCloudPush();
        return;
      }
      if (Number(cloud.client_ts || 0) > localSaveTs() + 2000) {
        state.cloudPending = cloud;
        showCloudChoice();
      } else {
        scheduleCloudPush();
      }
    } catch (e) {}
  }

  function showCloudChoice() {
    const c = state.cloudPending;
    if (!c) return;
    const when = c.updated_at ? new Date(c.updated_at).toLocaleString("zh-CN") : "未知时间";
    openModal(
      '<h2>云端进度</h2><p class="small dim">检测到云端存档（' +
        esc(when) +
        '）比本地更新。使用哪一份进度？</p><div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" id="cloud-local">保留本地</button><button class="btn btn-primary" id="cloud-use">使用云端</button></div>',
      { name: "cloud", dismissible: false }
    );
    $("#cloud-use").onclick = () => {
      A.play("click");
      applyCloudSave(c);
      closeModal();
    };
    $("#cloud-local").onclick = () => {
      A.play("click");
      state.cloudPending = null;
      scheduleCloudPush();
      closeModal();
    };
  }

  function applyCloudSave(cloud) {
    state.cloudPending = null;
    if (cloud.profile && typeof cloud.profile === "object") {
      state.profile = Object.assign(E.defaultProfile(), cloud.profile);
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
        localStorage.setItem(PROFILE_TS_KEY, String(Date.now()));
      } catch (e) {}
    }
    if (cloud.band) {
      state.band = String(cloud.band);
      try {
        localStorage.setItem(BAND_KEY, state.band);
      } catch (e) {}
    }
    if (cloud.run) {
      try {
        localStorage.setItem(RUN_KEY, JSON.stringify({ band: state.band, run: cloud.run, ts: Number(cloud.client_ts) || Date.now() }));
      } catch (e) {}
    }
    toast("已载入云端进度");
    renderMenu();
  }

  // ---------------- custom vocab sets ----------------
  function prepareCustomItems(rawItems) {
    const items = (rawItems || []).map((it) => Object.assign({}, it, { w: String(it.w || "").toLowerCase() }));
    const withFreq = items.filter((it) => Number.isFinite(it.freq) && it.freq > 0).sort((a, b) => b.freq - a.freq);
    withFreq.forEach((it, i) => {
      it.rank = withFreq.length <= 1 ? 7 : Math.max(1, Math.min(13, 1 + Math.floor((12 * i) / (withFreq.length - 1))));
    });
    items.forEach((it) => {
      if (Number.isFinite(it.freq) && it.freq > 0) return;
      let h = 0;
      for (let i = 0; i < it.w.length; i++) h = (h * 31 + it.w.charCodeAt(i)) >>> 0;
      it.rank = 1 + (h % 13);
    });
    const byW = new Map(items.map((it, i) => [it.w, i]));
    const parent = items.map((_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    items.forEach((it, i) => {
      (Array.isArray(it.syn) ? it.syn : []).forEach((s) => {
        const j = byW.get(String(s).toLowerCase());
        if (j == null || j === i) return;
        const ra = find(i), rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      });
    });
    const comps = new Map();
    items.forEach((_, i) => {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(i);
    });
    items.forEach((it) => {
      it.synGroup = null;
    });
    let gid = 0;
    comps.forEach((idx) => {
      if (idx.length < 3) return;
      gid += 1;
      idx.forEach((i) => {
        items[i].synGroup = gid;
      });
    });
    const seen = new Set();
    const antPairs = [];
    items.forEach((it) => {
      (Array.isArray(it.ant) ? it.ant : []).forEach((a) => {
        const j = byW.get(String(a).toLowerCase());
        if (j == null) return;
        const pair = [it.w, items[j].w].sort();
        const key = pair.join("|");
        if (seen.has(key)) return;
        seen.add(key);
        antPairs.push(pair);
      });
    });
    antPairs.sort((a, b) => items[byW.get(a[0])].rank + items[byW.get(a[1])].rank - (items[byW.get(b[0])].rank + items[byW.get(b[1])].rank));
    return { items, antPairs: antPairs.slice(0, 400), groups: gid };
  }

  function buildCustomBank(rawItems) {
    const p = prepareCustomItems(rawItems);
    return { band: "custom", items: p.items, antPairs: p.antPairs, stats: { items: p.items.length, clusters: p.groups, ant_pairs: p.antPairs.length } };
  }

  function parsePosCell(v) {
    const out = [];
    String(v || "")
      .toLowerCase()
      .split(/[,，/|;；\s]+/)
      .forEach((p) => {
        const k = IMPORT_POS_ALIAS[p.replace(/\.$/, "")];
        if (k && out.indexOf(k) < 0) out.push(k);
      });
    return out;
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  function parseImportFile(text) {
    const out = [];
    const seen = new Set();
    const push = (w, pos, zh, en) => {
      const lw = String(w == null ? "" : w).trim().toLowerCase();
      if (!/^[a-z][a-z'-]{1,30}$/.test(lw) || C.STOPWORDS.has(lw) || seen.has(lw)) return;
      seen.add(lw);
      out.push({ w: lw, pos: pos || [], zh: String(zh || "").slice(0, 200), def: String(en || "").slice(0, 300), en: String(en || "").slice(0, 300) });
    };
    const trimmed = String(text || "").replace(/^﻿/, "").trim();
    if (!trimmed) return out;
    if (trimmed[0] === "[" || trimmed[0] === "{") {
      let data = JSON.parse(trimmed);
      if (data && !Array.isArray(data) && Array.isArray(data.items)) data = data.items;
      if (data && !Array.isArray(data) && Array.isArray(data.words)) data = data.words;
      if (!Array.isArray(data)) throw new Error("JSON 需为单词数组");
      data.forEach((it) => {
        if (typeof it === "string") push(it, [], "", "");
        else if (it && typeof it === "object") {
          push(it.w || it.word || it.spelling, Array.isArray(it.pos) ? parsePosCell(it.pos.join(" ")) : parsePosCell(it.pos), it.zh || it.definition_zh || "", it.def || it.en || it.definition_en || "");
        }
      });
    } else {
      trimmed.split(/\r?\n/).forEach((line, idx) => {
        if (!line.trim()) return;
        const cols = splitCsvLine(line);
        if (idx === 0 && /^(spelling|word|单词)$/i.test(cols[0] || "")) return;
        push(cols[0], parsePosCell(cols[1]), cols[2] || "", cols[3] || "");
      });
    }
    return out;
  }

  async function enrichImportWords(words, onProgress) {
    const results = new Map();
    const failed = [];
    let quotaHit = false;
    const BATCH = 15;
    for (let i = 0; i < words.length; i += BATCH) {
      const chunk = words.slice(i, i + BATCH);
      let d;
      try {
        d = await api("/api/lexicon/enrich", { method: "POST", body: JSON.stringify({ words: chunk }) });
      } catch (e) {
        if (e.code === "MEMBER_ONLY") throw e;
        if (e.status === 429) {
          quotaHit = true;
          failed.push.apply(failed, chunk);
          break;
        }
        throw e;
      }
      (d.items || []).forEach((it) => results.set(String(it.w).toLowerCase(), it));
      (d.failed || []).forEach((w) => failed.push(String(w).toLowerCase()));
      const remaining = Number(d.remaining);
      onProgress(Math.min(words.length, i + chunk.length), words.length);
      if (Number.isFinite(remaining) && remaining <= 0 && i + BATCH < words.length) {
        quotaHit = true;
        for (let k = i + BATCH; k < words.length; k++) failed.push(words[k]);
        break;
      }
    }
    return { results, failed, quotaHit };
  }

  async function importVocabSet() {
    if (state.importing) return;
    const fileEl = $("#vocab-file");
    const nameEl = $("#vocab-name");
    const statusEl = $("#vocab-import-status");
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) {
      toast("请先选择 CSV 或 JSON 文件");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("文件超过 2MB 上限");
      return;
    }
    const name = ((nameEl && nameEl.value) || "").trim() || file.name.replace(/\.(csv|json)$/i, "").slice(0, 24);
    let parsed;
    try {
      parsed = parseImportFile(await file.text());
    } catch (e) {
      toast("解析失败：" + e.message);
      return;
    }
    if (!parsed.length) {
      toast("没有解析到有效单词");
      return;
    }
    if (parsed.length > 5000) {
      toast("单词数超过 5000 上限（" + parsed.length + "）");
      return;
    }
    state.importing = true;
    const btn = $("#vocab-import");
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "正在补全语义数据 0/" + parsed.length + "…";
    try {
      const enriched = await enrichImportWords(
        parsed.map((x) => x.w),
        (done, total) => {
          if (statusEl) statusEl.textContent = "正在补全语义数据 " + done + "/" + total + "…";
        }
      );
      const merged = [];
      parsed.forEach((x) => {
        const e = enriched.results.get(x.w) || null;
        const pos = x.pos && x.pos.length ? x.pos : (e && e.pos) || [];
        if (!pos.length) return;
        merged.push({
          w: x.w,
          pos,
          ipa: (e && e.ipa) || "",
          syl: (e && e.syl) || Math.max(1, Math.round(x.w.length / 3)),
          affixes: [],
          zh: x.zh || "",
          def: x.def || (e && e.def) || "",
          en: x.en || (e && e.en) || "",
          syn: (e && e.syn) || [],
          ant: (e && e.ant) || [],
          freq: e && Number.isFinite(e.freq) ? e.freq : null,
          forms: [],
        });
      });
      const prepared = prepareCustomItems(merged).items;
      if (!prepared.length) {
        if (statusEl) statusEl.textContent = "没有带词性的可用单词，请检查文件或稍后重试。";
        return;
      }
      if (statusEl) statusEl.textContent = "正在保存 " + prepared.length + " 词…";
      const saved = await api("/api/lexicon/vocab-sets", { method: "POST", body: JSON.stringify({ name, items: prepared }) });
      state.customSet = { id: saved.id, name, count: prepared.length };
      try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.customSet));
      } catch (e) {}
      const skipped = parsed.length - prepared.length;
      if (statusEl) {
        statusEl.textContent =
          "已保存《" + name + "》：" + prepared.length + " 词" + (skipped ? "（" + skipped + " 词缺词性或未补全被跳过）" : "") + (enriched.quotaHit ? "；今日 enrich 配额已用完，剩余词可明天再导入" : "") + "。";
      }
      toast("词库已保存，可在列表中「使用」");
      loadVocabList();
    } catch (e) {
      if (statusEl) statusEl.textContent = "导入失败：" + e.message + (e.code === "MEMBER_ONLY" ? "（需要会员）" : "");
    } finally {
      state.importing = false;
      if (btn) btn.disabled = false;
    }
  }

  function useVocabSet(id, name, count) {
    state.customSet = { id, name, count };
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.customSet));
    } catch (e) {}
    state.band = "custom:" + id;
    try {
      localStorage.setItem(BAND_KEY, state.band);
    } catch (e) {}
    closeModal();
    renderMenu();
    toast("已切换到自建词库《" + name + "》");
  }

  async function deleteVocabSet(id) {
    try {
      await api("/api/lexicon/vocab-sets", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
      if (state.customSet && state.customSet.id === id) {
        state.customSet = null;
        localStorage.removeItem(CUSTOM_KEY);
        if (String(state.band).indexOf("custom:") === 0) {
          state.band = "hs";
          localStorage.setItem(BAND_KEY, "hs");
        }
      }
      toast("已删除");
      loadVocabList();
      renderMenu();
    } catch (e) {
      toast("删除失败：" + e.message);
    }
  }

  async function loadVocabList() {
    const el = $("#vocab-list");
    if (!el) return;
    try {
      const d = await api("/api/lexicon/vocab-sets");
      const items = d.items || [];
      if (!items.length) {
        el.innerHTML = '<span class="dim">还没有自建词库。</span>';
        return;
      }
      el.innerHTML = items
        .map(
          (it) =>
            '<div class="offer"><div><div class="name">' +
            esc(it.name) +
            '</div><div class="desc">' +
            it.count +
            " 词</div></div><div class=\"row\"><button class=\"btn btn-primary\" data-use=\"" +
            esc(it.id) +
            '" data-name="' +
            esc(it.name) +
            '" data-count="' +
            it.count +
            '">使用</button><button class="btn btn-danger" data-del="' +
            esc(it.id) +
            '">删除</button></div></div>'
        )
        .join("");
      $$("#vocab-list [data-use]").forEach((btn) => {
        btn.onclick = () => {
          A.play("click");
          useVocabSet(btn.dataset.use, btn.dataset.name, Number(btn.dataset.count) || 0);
        };
      });
      $$("#vocab-list [data-del]").forEach((btn) => {
        btn.onclick = () => {
          if (window.confirm("删除这个自建词库？")) deleteVocabSet(btn.dataset.del);
        };
      });
    } catch (e) {
      el.innerHTML = '<span class="red">' + esc(e.message) + "</span>";
    }
  }

  function showVocabSets() {
    A.play("click");
    if (!isLoggedIn()) {
      toast("请先在云吞吞文游登录");
      return;
    }
    const member = memberInfo().isMember;
    openModal(
      '<h2>我的词库</h2><p class="small dim">会员可使用自建词库。CSV 表头 spelling,pos,definition_zh,definition_en；或 JSON 数组。≤5000 词、≤2MB。</p><div id="vocab-list" class="small" style="margin-bottom:8px">加载中…</div>' +
        (member
          ? '<div class="upgrade-line"><div class="small">导入新词库</div><input id="vocab-name" maxlength="24" placeholder="词库名称（如 雅思核心）" style="width:100%;margin-top:6px;padding:6px;background:#0b1322;border:2px solid var(--line);color:var(--ink)" /><input id="vocab-file" type="file" accept=".csv,.json,text/csv,application/json" style="margin-top:6px;font-size:14px" /><div id="vocab-import-status" class="tiny dim" style="margin-top:6px"></div><button class="btn btn-primary" id="vocab-import" style="margin-top:8px">开始导入</button></div>'
          : '<div class="upgrade-line small dim">自定义词库为会员功能。<a class="green" href="/">前往开通</a></div>') +
        '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="m-close">关闭</button></div>',
      { name: "vocab" }
    );
    $("#m-close").onclick = closeModal;
    loadVocabList();
    if (member) $("#vocab-import").onclick = importVocabSet;
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function openModal(html, opts) {
    const o = opts || {};
    $("#modal").innerHTML = '<div class="modal">' + html + "</div>";
    $("#modal-wrap").classList.remove("hidden");
    state.modal = o.name || null;
    if (o.onMount) o.onMount($(".modal", $("#modal")));
    if (o.dismissible !== false) {
      $("#modal-wrap").onclick = (e) => {
        if (e.target === $("#modal-wrap")) closeModal();
      };
    } else {
      $("#modal-wrap").onclick = null;
    }
  }

  function closeModal() {
    $("#modal-wrap").classList.add("hidden");
    $("#modal").innerHTML = "";
    state.modal = null;
  }

  function setScreen(name) {
    state.screen = name;
    $("#screen-menu").classList.toggle("hidden", name !== "menu");
    $("#screen-game").classList.toggle("hidden", name !== "game");
    $("#top-actions").classList.toggle("hidden", name !== "game");
  }

  async function loadBank(band) {
    if (state.bankCache[band]) return state.bankCache[band];
    if (String(band).indexOf("custom:") === 0) {
      if (!isLoggedIn()) throw new Error("登录后可载入自建词库");
      const d = await api("/api/lexicon/vocab-sets?id=" + encodeURIComponent(String(band).slice(7)));
      const bank = buildCustomBank((d.set && d.set.items) || []);
      if (!bank.items.length) throw new Error("自建词库为空");
      state.bankCache[band] = bank;
      return bank;
    }
    const res = await fetch("data/banks/" + band + ".json", { cache: "force-cache" });
    if (!res.ok) throw new Error("词库加载失败 " + res.status);
    const bank = await res.json();
    state.bankCache[band] = bank;
    return bank;
  }

  // ---------------- menu ----------------
  function renderMenu() {
    setScreen("menu");
    const { user, isMember } = memberInfo();
    const p = state.profile;
    $("#menu-profile").innerHTML =
      '<div class="row spread"><span>' +
      (user ? '<span class="green">已登录</span> · ' + esc(user.nickname || user.email || "会员通道") + (isMember ? ' <span class="level-badge">会员</span>' : ' <span class="dim">免费</span>') : '<span class="amber">匿名模式</span> · 仅高中词库，可无限游玩') +
      '</span><span class="amber">✦ ' + (p.crystals || 0) + " 结晶</span></div>";
    const bands = ["hs", "cet4", "cet6", "ky", "toefl"];
    const bandHtml = bands
      .map((b) => {
        const locked = b !== "hs" && !isMember;
        return '<button class="btn ' + (state.band === b ? "active" : "") + (locked ? " locked" : "") + '" data-band="' + b + '">' + BAND_NAMES[b] + (locked ? " 🔒" : "") + "</button>";
      })
      .join("");
    const custom = state.customSet;
    $("#band-pick").innerHTML =
      bandHtml +
      (custom
        ? '<button class="btn ' + (String(state.band).indexOf("custom:") === 0 ? "active" : "") + '" data-band="custom:' + esc(custom.id) + '">自建 · ' + esc(custom.name) + "</button>"
        : "");
    $$("#band-pick .btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        A.play("click");
        const b = btn.dataset.band;
        if (b.indexOf("custom:") === 0) {
          if (!isLoggedIn()) {
            openModal('<h2>自建词库</h2><p class="dim">请先在云吞吞文游登录后再使用自建词库。</p><div class="row" style="justify-content:flex-end;margin-top:12px"><a class="btn btn-primary" href="/">前往登录</a><button class="btn" id="m-ok">知道了</button></div>', { name: "login" });
            $("#m-ok").onclick = closeModal;
            return;
          }
          state.band = b;
          localStorage.setItem(BAND_KEY, b);
          renderMenu();
          return;
        }
        if (b !== "hs" && !memberInfo().isMember) {
          openModal(
            '<h2>会员词库</h2><p class="dim">四级 / 六级 / 考研 / 托福词库与自定义导入为会员功能。</p><p class="small">当前匿名或免费账号仅可使用高中 3500 词库，且不限游玩次数。</p><div class="row" style="justify-content:flex-end;margin-top:12px"><a class="btn btn-primary" href="/">前往登录 / 开通</a><button class="btn" id="m-ok">知道了</button></div>',
            { name: "member" }
          );
          $("#m-ok").onclick = closeModal;
          return;
        }
        state.band = b;
        localStorage.setItem(BAND_KEY, b);
        renderMenu();
      });
    });

    const saved = readSavedRun();
    $("#btn-continue").classList.toggle("hidden", !saved);
    $("#menu-stats").innerHTML =
      '<div class="statgrid"><span class="k">最高到达</span><span>Ante ' + (p.bestAnte || 0) + "</span>" +
      '<span class="k">最高分</span><span>' + fmt(p.bestScore || 0) + "</span>" +
      '<span class="k">总局数</span><span>' + (p.runs || 0) + "</span>" +
      '<span class="k">结晶</span><span class="amber">✦ ' + (p.crystals || 0) + "</span></div>";
    const up = p.upgrades || {};
    $("#menu-upgrades").textContent = "词力 " + (up.power || 0) + " / 记忆 " + (up.memory || 0) + " / 经济 " + (up.economy || 0);
  }

  function readSavedRun() {
    try {
      const d = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
      if (d && d.run && d.run.phase !== "victory" && d.run.phase !== "gameover") return d;
    } catch (e) {}
    return null;
  }

  async function startRun() {
    A.unlock();
    try {
      const bank = await loadBank(state.band);
      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      const run = E.createRun({ seed, band: state.band, bank, profile: state.profile });
      state.profile = run.profile;
      state.run = run;
      state.selected.clear();
      state.hintCard = null;
      syncProfile();
      saveRun();
      setScreen("game");
      renderGame();
      A.play("play");
    } catch (e) {
      toast(e.message || "开局失败");
    }
  }

  function resumeRun() {
    const d = readSavedRun();
    if (!d) return;
    state.run = d.run;
    state.band = d.band || "hs";
    state.profile = Object.assign(state.profile, d.run.profile || {});
    state.run.profile = state.profile;
    state.selected.clear();
    state.hintCard = null;
    setScreen("game");
    renderGame();
    if (state.run.phase === "settle") doSettle();
    else if (state.run.phase === "shop") renderShop();
  }

  // ---------------- game ----------------
  function fmt(n) {
    if (n == null) return "0";
    const v = Math.floor(n);
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e4) return (v / 1e3).toFixed(1) + "K";
    return String(v);
  }

  function renderGame() {
    const run = state.run;
    if (!run) return;
    setScreen("game");
    const conf = C.ANTES[run.ante] || C.ANTES[8];
    const boss = run.blindType === "boss" ? C.BOSSES[conf.bossType] : null;
    $("#game-head").innerHTML =
      '<div><div class="small dim">ANTE ' + run.ante + " / 8 · " + BLIND_CN[run.blindType] + '</div><div class="target-score">' + fmt(run.score) + ' <span class="dim">/</span> ' + fmt(run.target) + "</div>" +
      '<div class="progress"><i style="width:' + Math.min(100, Math.floor((run.score / Math.max(1, run.target)) * 100)) + '%"></i></div></div>' +
      '<div class="statline" style="margin:0"><span class="amber">$' + run.money + '</span><span>出牌 <b>' + run.handsLeft + "</b></span><span>弃牌 <b>" + run.discardsLeft + "</b></span></div>";
    $("#boss-banner").classList.toggle("hidden", !boss);
    if (boss) $("#boss-banner").innerHTML = '<b>' + esc(boss.name) + "</b> · " + esc(boss.desc);

    const rel = run.relics.map((id) => {
      const r = C.RELICS.find((x) => x.id === id);
      return r ? '<span class="relic-chip ' + (r.school === "mem" ? "mem" : "") + '" title="' + esc(r.desc) + '">' + esc(r.name) + "</span>" : "";
    });
    const cons = run.consumables.map((id, i) => {
      const c = C.CONSUMABLES.find((x) => x.id === id);
      return c ? '<button class="consumable-chip" data-cons="' + i + '" title="' + esc(c.desc) + '">' + esc(c.name) + "</button>" : "";
    });
    $("#relic-row").innerHTML = rel.concat(cons).join("") || '<span class="tiny dim">暂无圣物 · 商店可购买</span>';
    $$("#relic-row .consumable-chip").forEach((b) => b.addEventListener("click", () => useConsumable(Number(b.dataset.cons))));

    renderHand();
    renderPreview();

    const blackout = E.bossActive(run, "blackout");
    $("#btn-hint").disabled = blackout || run.phase !== "blind";
    $("#btn-play").disabled = run.phase !== "blind";
    $("#btn-discard").disabled = run.phase !== "blind" || run.discardsLeft <= 0;
    $("#btn-play").textContent = "出牌 (" + state.selected.size + ")";
    $("#btn-discard").textContent = "弃牌 (" + run.discardsLeft + ")";
    saveRun();
  }

  function renderHand() {
    const run = state.run;
    const hand = run.hand;
    const grid = $("#hand");
    grid.innerHTML = "";
    hand.forEach((c) => {
      const b = document.createElement("button");
      const pos = c.posPlayable[0] || "n";
      b.className = "card" + (state.selected.has(c.id) ? " selected" : "") + (c.gold ? " gold-card" : "") + (c.blurred ? " blurred" : "");
      b.dataset.id = c.id;
      b.dataset.pos = pos;
      const goldBase = 10 + (run.upgradeEff.goldMultBonus || 0);
      const dots = c.mastery > 0 ? "●".repeat(Math.min(4, c.mastery)) : "";
      b.innerHTML =
        '<span class="rank">R' + (c.rank == null ? "-" : c.rank) + "</span>" +
        (c.gold ? '<span class="badges">★×' + goldBase + "</span>" : "") +
        '<span class="word">' + esc(c.w) + "</span>" +
        '<span class="pos">' + c.posPlayable.map((p) => POS_CN[p] || p).join("·") + (c.syl ? " · " + c.syl + "音" : "") + "</span>" +
        (dots ? '<span class="mastery">' + dots + "</span>" : "") +
        (c.synGroup != null ? '<span class="groupdot"></span>' : "");
      b.addEventListener("click", () => toggleSelect(c));
      grid.appendChild(b);
    });
    if (!hand.length) grid.innerHTML = '<div class="dim small" style="grid-column:1/-1;padding:20px;text-align:center">手牌为空</div>';
  }

  function toggleSelect(c) {
    if (!state.run || state.run.phase !== "blind") return;
    if (c.blurred) {
      toast("这张卡已被记忆模糊，无法打出");
      return;
    }
    if (state.selected.has(c.id)) {
      state.selected.delete(c.id);
    } else {
      if (state.selected.size >= 5) {
        toast("最多选择 5 张卡");
        return;
      }
      state.selected.add(c.id);
    }
    A.play("select");
    state.hintCard = state.selected.size === 1 ? c : null;
    renderHand();
    renderPreview();
    renderHintPanel();
  }

  function selectedCards() {
    if (!state.run) return [];
    return state.run.hand.filter((c) => state.selected.has(c.id));
  }

  function renderPreview() {
    const cards = selectedCards();
    const run = state.run;
    if (!cards.length) {
      $("#pattern-preview").innerHTML = "选择 1-5 张卡。出 5 张可触发牌型，出 1 张为散牌。";
      return;
    }
    const relax = E.hasRelic(run, "grammar-scholar") ? 1 : 0;
    const det = E.detectPattern(cards, { relax });
    const h = C.HANDS[det.pattern];
    let lv = run.levels[det.pattern] || 1;
    const ladderRelic = 0;
    let extra = "";
    if (det.pattern === "ladder") extra = " · 档位 " + cards.map((c) => c.rank).join("→");
    const maxed = det.pattern === "high" && cards.length > 1 ? ' <span class="red">（不足 5 张，仅算散牌）</span>' : "";
    $("#pattern-preview").innerHTML = "当前：<b>" + PATTERN_CN[det.pattern] + "</b> · " + h.chips + " Chips × " + h.mult + " Mult" + extra + maxed;
  }

  function renderHintPanel() {
    const el = $("#hint-panel");
    const c = state.hintCard;
    if (!c) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML =
      '<div class="row spread"><b>' + esc(c.w) + '</b><span class="tiny dim">' + (c.ipa || "") + " · " + (c.syl || 1) + " 音节 · R" + (c.rank == null ? "-" : c.rank) + "</span></div>" +
      '<div class="tiny">' + esc(c.posPlayable.map((p) => POS_CN[p] || p).join(" · ")) + "</div>" +
      '<div style="margin-top:4px">' + esc(c.zh || "（暂无中文释义）") + "</div>" +
      (c.def ? '<div class="en">' + esc(c.def) + "</div>" : "") +
      (c.syn && c.syn.length ? '<div class="tiny" style="margin-top:4px">同义：' + esc(c.syn.slice(0, 6).join(", ")) + "</div>" : "") +
      (c.ant && c.ant.length ? '<div class="tiny">反义：' + esc(c.ant.slice(0, 6).join(", ")) + "</div>" : "") +
      (c.hintedThisBlind ? '<div class="tiny amber" style="margin-top:4px">本盲注该卡 Chips 失效' + (c.freeHintThisBlind ? "（免费提示，未破坏无瑕）" : "") + "</div>" : "");
  }

  function onHint() {
    const run = state.run;
    if (!run || run.phase !== "blind") return;
    if (E.bossActive(run, "blackout")) {
      toast("全盲考验：本盲注禁用查看提示");
      return;
    }
    const card = state.hintCard || selectedCards()[0];
    if (!card) {
      toast("先点选一张手牌");
      return;
    }
    const res = E.useHint(run, card.id);
    if (!res.ok) {
      toast(res.reason === "BLACKOUT" ? "全盲考验：禁用提示" : "无法查看");
      return;
    }
    state.hintCard = res.card;
    A.play("select");
    renderHintPanel();
    renderHand();
    saveRun();
  }

  function onPlay() {
    const run = state.run;
    if (!run || run.phase !== "blind") return;
    const ids = Array.from(state.selected);
    if (!ids.length) return toast("先选择卡牌");
    const declare = $("#declare").value || "auto";
    const res = E.playHand(run, ids, declare);
    if (!res.ok) {
      A.play("error");
      const map = { NOT_BLIND: "当前不能出牌", EMPTY: "未选择卡牌", NOT_IN_HAND: "卡牌不在手牌", BLURRED: "有卡已模糊", NO_HANDS: "没有出牌次数了" };
      return toast(map[res.reason] || res.reason);
    }
    state.selected.clear();
    state.hintCard = null;
    syncProfile();
    saveRun();
    A.play(res.declarationFail ? "error" : res.detail.goldMult > 1 ? "gold" : "score");
    renderGame();
    showResult(res);
  }

  function onDiscard() {
    const run = state.run;
    if (!run || run.phase !== "blind") return;
    const ids = Array.from(state.selected);
    if (!ids.length) return toast("先选择要弃掉的卡");
    if (run.discardsLeft <= 0) return toast("本盲注弃牌次数用完");
    const res = E.discard(run, ids);
    if (!res.ok) return toast("无法弃牌");
    state.selected.clear();
    state.hintCard = null;
    A.play("click");
    renderGame();
    renderHintPanel();
  }

  function showResult(res) {
    const d = res.detail;
    const events = (res.events || [])
      .map((e) => {
        const label = EVENT_CN[e.type] || e.type;
        if (e.type === "shield") return '<div class="small blue">' + esc(e.msg || label) + "</div>";
        if (e.type === "enhanced") return '<div class="small violet">' + esc(label) + "：" + esc(e.word) + "</div>";
        return '<div class="small ' + (e.type === "gold_broken" || e.type === "blurred" ? "red" : e.type === "gold_success" || e.type === "vaulted" ? "green" : "dim") + '">' + esc(label) + "：" + esc(e.word) + "</div>";
      })
      .join("");
    const decl = res.declarationFail ? '<div class="red small">宣言失败：按散牌结算，熟练度归零</div>' : "";
    const html =
      '<h2>' + esc(res.patternName || PATTERN_CN[res.pattern]) + (d.clean ? ' <span class="green small">无瑕</span>' : "") + "</h2>" +
      decl +
      '<div class="statgrid"><span class="k">Chips</span><span>' + fmt(d.chips) + "</span>" +
      '<span class="k">Mult</span><span>× ' + fmt(d.mult) + "</span>" +
      '<span class="k">无瑕加成</span><span>× ' + d.cleanMult + "</span>" +
      '<span class="k">黄金倍率</span><span class="gold">× ' + fmt(d.goldMult) + "</span>" +
      '<span class="k">本手得分</span><span class="green">' + fmt(d.score) + "</span></div>" +
      (events ? '<div style="margin:8px 0">' + events + "</div>" : "") +
      '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="m-ok">继续</button></div>';
    openModal(html, { name: "result", dismissible: false });
    $("#m-ok").onclick = () => {
      closeModal();
      if (state.run.phase === "settle") doSettle();
      else if (state.run.phase === "gameover") showEnd(false);
      else {
        renderGame();
        renderHintPanel();
      }
    };
  }

  function doSettle() {
    const run = state.run;
    if (!run || run.phase !== "settle") return;
    const res = E.settleBlind(run);
    if (!res.ok) return;
    syncProfile();
    saveRun();
    renderGame();
    A.play(run.phase === "victory" ? "win" : "coin");
    const html =
      '<h2>盲注通过</h2><div class="statgrid">' +
      '<span class="k">基础 + 剩余出牌</span><span class="amber">+$' + res.gained + "</span>" +
      '<span class="k">利息</span><span>$' + res.interest + "</span>" +
      '<span class="k">无瑕奖励</span><span>' + (res.clean ? "+$2" : "$0") + "</span>" +
      '<span class="k">结晶</span><span class="amber">✦ +' + res.crystals + "</span>" +
      "</div>" +
      '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="m-ok">' + (run.phase === "victory" ? "查看结局" : "进入商店") + "</button></div>";
    openModal(html, { name: "settle", dismissible: false });
    $("#m-ok").onclick = () => {
      closeModal();
      if (run.phase === "victory") showEnd(true);
      else renderShop();
    };
  }

  function renderShop() {
    const run = state.run;
    if (!run || run.phase !== "shop" || !run.shop) return;
    if (run.phase === "shop" && !run.shop) E.makeShop(run);
    const offers = run.shop.offers
      .map((o, i) => {
        if (o.type === "sold") return '<div class="offer sold"><div><div class="name">已售出</div></div><span class="dim">—</span></div>';
        const btn = o.type === "erase" ? '<button class="btn btn-amber" data-erase="' + i + '">剔除 $' + o.price + "</button>" : '<button class="btn ' + (run.money >= o.price ? "btn-primary" : "") + '" data-buy="' + i + '"' + (run.money < o.price ? " disabled" : "") + ">$" + o.price + "</button>";
        return '<div class="offer"><div><div class="name">' + esc(o.name) + (o.rarity ? ' <span class="tiny dim">' + esc(o.rarity) + "</span>" : "") + '</div><div class="desc">' + esc(o.desc || "") + "</div></div>" + btn + "</div>";
      })
      .join("");
    const relics = run.relics
      .map((id) => {
        const r = C.RELICS.find((x) => x.id === id);
        return r ? '<span class="relic-chip ' + (r.school === "mem" ? "mem" : "") + '" title="' + esc(r.desc) + '">' + esc(r.name) + "</span>" : "";
      })
      .join("");
    openModal(
      '<h2>商店 · <span class="amber">$' + run.money + "</span></h2>" +
        '<div class="tiny dim">圣物上限 5 个，消耗品上限 2 个。刷新 $2，最多 3 次。</div>' +
        offers +
        '<div class="row" style="justify-content:space-between;margin-top:10px"><button class="btn" id="shop-refresh"' + (run.money < 2 ? " disabled" : "") + ">刷新 $" + 2 + "（" + run.shop.refreshes + "/3）</button>" +
        '<div class="row"><button class="btn" id="shop-deck">查看牌堆</button><button class="btn btn-primary" id="shop-next">下一个盲注</button></div></div>' +
        (relics ? '<div style="margin-top:10px"><div class="tiny dim">已持有</div><div class="relic-row">' + relics + "</div></div>" : ""),
      { name: "shop", dismissible: false, onMount: (m) => {
          $$("[data-buy]", m).forEach((b) =>
            b.addEventListener("click", () => {
              const res = E.buy(run, Number(b.dataset.buy));
              if (!res.ok) {
                const map = { NO_MONEY: "金币不足", RELIC_FULL: "圣物已满", OWNED: "已拥有", CONSUMABLE_FULL: "消耗品已满" };
                return toast(map[res.reason] || res.reason);
              }
              A.play("buy");
              syncProfile();
              saveRun();
              renderShop();
            })
          );
          $$("[data-erase]", m).forEach((b) =>
            b.addEventListener("click", () => {
              showErasePicker(Number(b.dataset.erase));
            })
          );
          $("#shop-refresh", m).onclick = () => {
            const r = E.refreshShop(run);
            if (!r.ok) return toast(r.reason === "MAX_REFRESH" ? "刷新次数已用完" : "金币不足");
            A.play("click");
            saveRun();
            renderShop();
          };
          $("#shop-deck", m).onclick = () => showDeck();
          $("#shop-next", m).onclick = () => {
            const r = E.nextBlind(run);
            if (!r.ok) return toast(r.reason || "无法继续");
            A.play("click");
            if (run.blindType === "boss") A.play("boss");
            syncProfile();
            saveRun();
            closeModal();
            renderGame();
          };
        },
      }
    );
  }

  function showErasePicker(offerIdx) {
    const run = state.run;
    const offer = run.shop.offers[offerIdx];
    if (!offer || offer.type !== "erase") return;
    const html =
      '<h2>词库剔除 · $' + offer.price + "</h2><p class=\"small dim\">点击一张卡，本次对局永久移除。</p><div class=\"deck-list\" id=\"erase-list\">" +
      run.deck.map((c) => '<button class="deck-item' + (c.gold ? " gold" : "") + '" data-id="' + esc(c.id) + '">' + esc(c.w) + " R" + (c.rank == null ? "-" : c.rank) + "</button>").join("") +
      '</div><div class="row" style="justify-content:flex-end"><button class="btn" id="m-back">返回商店</button></div>';
    openModal(html, { name: "erase", dismissible: false });
    $("#m-back").onclick = renderShop;
    $$("#erase-list [data-id]").forEach((b) =>
      b.addEventListener("click", () => {
        const res = E.eraseCard(run, b.dataset.id);
        if (!res.ok) return toast("无法剔除");
        A.play("vault");
        toast("已剔除：" + res.card);
        saveRun();
        renderShop();
      })
    );
  }

  function showDeck() {
    const run = state.run;
    const drawn = new Set(run.hand.map((c) => c.id));
    const html =
      '<h2>牌堆 · ' + run.deck.length + ' 张</h2><p class="tiny dim">R = 词频档（R1 最常用，R13 最生僻）。金框为黄金卡。</p><div class="deck-list">' +
      run.deck
        .map((c) => '<span class="deck-item' + (c.gold ? " gold" : "") + (drawn.has(c.id) ? "" : " dim") + '">' + esc(c.w) + " R" + (c.rank == null ? "-" : c.rank) + "</span>")
        .join("") +
      "</div>" +
      '<div class="row" style="justify-content:space-between"><span class="small dim">金库 ' + run.vault.length + " 张</span><button class=\"btn\" id=\"m-close\">关闭</button></div>";
    openModal(html, { name: "deck" });
    $("#m-close").onclick = () => {
      closeModal();
      if (state.run.phase === "shop") renderShop();
    };
  }

  function useConsumable(idx) {
    const run = state.run;
    if (!run) return;
    const id = run.consumables[idx];
    const def = C.CONSUMABLES.find((c) => c.id === id);
    if (!def) return;
    let target = null;
    if (def.kind === "scroll") {
      target = state.hintCard || selectedCards()[0];
      if (!target) return toast("先点选一张手牌作为目标");
    }
    const res = E.useConsumable(run, idx, target && target.id);
    if (!res.ok) {
      const map = { BAD_PHASE: "当前阶段不可使用", BLIND_ONLY: "仅盲注中可使用", PICK_CARD: "请先选择目标卡", NO_SYNONYM: "牌堆中没有同义组可替换词", NO_MULTI_POS: "这张卡只有单一词性" };
      return toast(map[res.reason] || res.reason);
    }
    A.play("vault");
    toast("使用了：" + res.used);
    if (state.hintCard && run.hand.indexOf(state.hintCard) < 0) state.hintCard = null;
    syncProfile();
    saveRun();
    renderGame();
    renderHintPanel();
  }

  function showEnd(victory) {
    const run = state.run;
    if (!run) return;
    syncProfile();
    saveProfile();
    clearRun();
    if (victory) A.play("win");
    else A.play("lose");
    openModal(
      '<h2 class="' + (victory ? "green" : "red") + '">' + (victory ? "通关：Ante 8 三重奏" : "本局结束") + "</h2>" +
        '<div class="statgrid"><span class="k">到达</span><span>Ante ' + run.ante + " · " + BLIND_CN[run.blindType] + "</span>" +
        '<span class="k">本局结晶</span><span class="amber">✦ +' + (run.stats.crystalsEarned || 0) + "</span>" +
        '<span class="k">持有结晶</span><span class="amber">✦ ' + (state.profile.crystals || 0) + "</span>" +
        '<span class="k">历史最高分</span><span>' + fmt(state.profile.bestScore || 0) + "</span></div>" +
        '<p class="small dim">结晶可在主菜单升级词力 / 记忆 / 经济三条成长线，下一局生效。</p>' +
        '<div class="row" style="justify-content:flex-end"><button class="btn" id="m-menu">主菜单</button><button class="btn btn-primary" id="m-again">再来一局</button></div>',
      { name: "end", dismissible: false }
    );
    state.run = null;
    $("#m-menu").onclick = () => {
      closeModal();
      renderMenu();
    };
    $("#m-again").onclick = () => {
      closeModal();
      startRun();
    };
  }

  function showUpgrades() {
    const p = state.profile;
    const lines = Object.keys(C.UPGRADE_LINES)
      .map((key) => {
        const line = C.UPGRADE_LINES[key];
        const lv = p.upgrades[key] || 0;
        const next = lv < 3 ? line.levels[lv] : null;
        return (
          '<div class="upgrade-line"><div class="row spread"><b>' + esc(line.name) + '</b><span class="lv">Lv ' + lv + "/3</span></div>" +
          '<div class="small dim" style="margin:4px 0">' +
          line.levels.map((l, i) => (i < lv ? "✓ " : "") + l.desc + (i < lv ? "" : "（✦" + l.cost + "）")).join(" · ") +
          "</div>" +
          (next ? '<button class="btn btn-amber" data-line="' + key + '">升级：✦ ' + next.cost + " · " + esc(next.desc) + "</button>" : '<span class="small green">已满级</span>') +
          "</div>"
        );
      })
      .join("");
    openModal(
      '<h2>神经元结晶 · <span class="amber">✦ ' + (p.crystals || 0) + "</span></h2>" +
        '<p class="small dim">通关 Boss 与首次通关 Ante 获得结晶。升级在下一局生效。</p>' +
        lines +
        '<div class="row" style="justify-content:flex-end"><button class="btn" id="m-close">关闭</button></div>',
      { name: "upgrades" }
    );
    $("#m-close").onclick = closeModal;
    $$("[data-line]").forEach((b) =>
      b.addEventListener("click", () => {
        const r = E.buyUpgrade(state.profile, b.dataset.line);
        if (!r.ok) return toast(r.reason === "NO_CRYSTALS" ? "结晶不足" : r.reason === "MAX" ? "已满级" : "无法升级");
        A.play("buy");
        saveProfile();
        showUpgrades();
        renderMenu();
      })
    );
  }

  function showHelp() {
    openModal(
      '<h2>玩法速览</h2><div class="small" style="line-height:1.7">' +
        "<p><b>目标</b>：在 4 次出牌内达到盲注目标分，通关 Ante 1-8。</p>" +
        "<p><b>牌型</b>：词性同花（5 张同词性）→ 搭配葫芦（3 张同义 + 2 张反义）→ 语义顺子（5 张词频档 R 递增）→ 语法同花顺（5 张词性符合模板）。牌型越大倍率越高。</p>" +
        "<p><b>链路</b>：相邻两张卡若有共同词性，+2 Mult；前一张词尾 = 后一张词首，该卡 Chips 翻倍。</p>" +
        "<p><b>无瑕</b>：本手不出错（未查看提示）Chips ×1.5。查看提示会让该卡本盲注失效。</p>" +
        "<p><b>黄金卡</b>：无瑕打出 ×10（圣物可提升），之后进入金库，每 3 个盲注重现。</p>" +
        "<p><b>归库</b>：同一张卡连续 3 次无瑕打出后进入金库，暂时离开牌堆。</p>" +
        "<p><b>宣言</b>：出牌前可宣言牌型，成功配合圣物额外加成；宣言失败按散牌结算且熟练度归零。</p>" +
        '<p><b>Boss</b>：全盲（禁提示）/ 记忆衰退（持牌 3 手模糊）/ 潜意识风暴（开幕 3 金卡，失误则黄金倍率失效）。</p>' +
        "</div><div class=\"row\" style=\"justify-content:flex-end;margin-top:10px\"><button class=\"btn\" id=\"m-close\">关闭</button></div>",
      { name: "help" }
    );
    $("#m-close").onclick = closeModal;
  }

  function confirmNewRun() {
    openModal(
      '<h2>开始新局？</h2><p class="dim">当前进度将被放弃。</p><div class="row" style="justify-content:flex-end"><button class="btn" id="m-no">取消</button><button class="btn btn-danger" id="m-yes">放弃并开始</button></div>',
      { name: "confirm" }
    );
    $("#m-no").onclick = closeModal;
    $("#m-yes").onclick = () => {
      clearRun();
      state.run = null;
      closeModal();
      startRun();
    };
  }

  // ---------------- boot ----------------
  function boot() {
    document.addEventListener("click", () => A.unlock(), { once: true });
    $("#btn-start").addEventListener("click", () => {
      A.play("click");
      if (state.run) return confirmNewRun();
      startRun();
    });
    $("#btn-continue").addEventListener("click", () => {
      A.play("click");
      resumeRun();
    });
    $("#btn-upgrades").addEventListener("click", () => {
      A.play("click");
      showUpgrades();
    });
    $("#btn-vocab").addEventListener("click", showVocabSets);
    $("#btn-help").addEventListener("click", () => {
      A.play("click");
      showHelp();
    });
    $("#btn-mute").addEventListener("click", () => {
      const m = A.toggle();
      $("#btn-mute").textContent = m ? "♪ 关" : "♪ 开";
    });
    $("#btn-play").addEventListener("click", onPlay);
    $("#btn-discard").addEventListener("click", onDiscard);
    $("#btn-hint").addEventListener("click", onHint);
    $("#btn-menu").addEventListener("click", () => {
      A.play("click");
      syncProfile();
      saveRun();
      renderMenu();
    });
    $("#btn-endturn").addEventListener("click", () => {
      A.play("click");
      if (state.run && state.run.phase === "shop") renderShop();
    });
    $("#declare").addEventListener("change", () => A.play("click"));

    renderMenu();
    const saved = readSavedRun();
    if (saved) {
      toast("检测到未完成的对局，可点「继续本局」");
    }
    pullCloudSave();
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
