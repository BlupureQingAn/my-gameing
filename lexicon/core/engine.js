/* Lexicon Rush - core engine (pure logic, no DOM) */
(function (root) {
  "use strict";

  const C = typeof require === "function" ? require("./content.js") : root.LexiconContent;
  const { HANDS, GRAMMAR_TEMPLATES, ANTES, BOSSES, RELICS, CONSUMABLES, ENHANCEMENTS, UPGRADE_LINES, STOPWORDS } = C;

  const VERSION = 1;
  const POS_ALIAS = { n: "n", noun: "n", v: "v", verb: "v", adj: "adj", adjective: "adj", adv: "adv", adverb: "adv", prep: "prep", preposition: "prep", pron: "pron", pronoun: "pron", conj: "conj", conjunction: "conj", det: "det", art: "det", article: "det", num: "num", interj: "interj", aux: "aux", auxiliary: "aux" };
  const VOWELS = new Set(["a", "e", "i", "o", "u"]);

  function normPos(list) {
    const out = [];
    (list || []).forEach((p) => {
      const k = POS_ALIAS[String(p).toLowerCase()] || String(p).toLowerCase();
      if (k && !out.includes(k)) out.push(k);
    });
    return out;
  }

  function rnd(run) {
    let a = run.rngState >>> 0;
    a = (a + 0x6d2b79f5) | 0;
    run.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rndInt = (run, n) => Math.floor(rnd(run) * n);
  function shuffle(run, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rndInt(run, i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function cardFromWord(item, idx) {
    const pos = normPos(item.pos);
    return {
      id: String(item.w) + "#" + idx,
      w: String(item.w),
      pos,
      posPlayable: pos.slice(),
      syl: Number(item.syl) || 1,
      ipa: item.ipa || "",
      affixes: Array.isArray(item.affixes) ? item.affixes.slice() : [],
      zh: item.zh || "",
      def: item.def || item.zh || "",
      syn: Array.isArray(item.syn) ? item.syn.map((s) => String(s).toLowerCase()) : [],
      ant: Array.isArray(item.ant) ? item.ant.map((s) => String(s).toLowerCase()) : [],
      topic: item.topic || null,
      synGroup: item.synGroup == null ? null : item.synGroup,
      rank: Number.isFinite(item.rank) ? item.rank : null,
      enhancement: item.enhancement || "None",
      mastery: 0,
      cleanStreak: 0,
      gold: false,
      blurred: false,
      heldHands: 0,
      hintedThisBlind: false,
      freeHintThisBlind: false,
      hintBlockedClean: false,
      wrongBookChips: 0,
      vaultSkips: 0,
      firstSeen: false,
    };
  }

  function isStopword(w) {
    return STOPWORDS.has(String(w).toLowerCase());
  }

  function eligible(item) {
    if (!item || !item.w) return false;
    const w = String(item.w).toLowerCase();
    if (isStopword(w)) return false;
    if (item.proper) return false;
    if (!/^[a-z][a-z'-]{1,}$/.test(w)) return false;
    if (!Array.isArray(item.pos) || !normPos(item.pos).length) return false;
    return true;
  }

  function buildDeck(run, bank, profile) {
    const meta = Array.isArray(bank) ? { items: bank } : bank || {};
    const seen = (profile && profile.seenWords) || {};
    const errors = new Set(((profile && profile.highErrorWords) || []).map((w) => String(w).toLowerCase()));
    const uniq = new Map();
    for (const it of meta.items || []) {
      if (!eligible(it)) continue;
      const w = String(it.w).toLowerCase();
      if (!uniq.has(w)) uniq.set(w, it);
    }
    const picked = [];
    const pickedWords = new Set();
    const take = (it) => {
      if (!it || picked.length >= 80) return false;
      const w = String(it.w).toLowerCase();
      if (pickedWords.has(w)) return false;
      pickedWords.add(w);
      picked.push(it);
      return true;
    };
    // 1) 错题词优先
    const errList = [];
    for (const w of errors) if (uniq.has(w)) errList.push(uniq.get(w));
    for (const it of shuffle(run, errList).slice(0, 24)) take(it);
    // 2) 同义组：保证 3 张同组词可凑出搭配葫芦的三元组
    const groups = new Map();
    for (const [w, it] of uniq) {
      if (it.synGroup == null) continue;
      if (!groups.has(it.synGroup)) groups.set(it.synGroup, []);
      groups.get(it.synGroup).push(it);
    }
    for (const gid of shuffle(run, [...groups.keys()])) {
      if (picked.length >= 48) break;
      const arr = groups.get(gid);
      if (arr.length < 3) continue;
      for (const it of shuffle(run, arr).slice(0, 8)) {
        if (picked.length >= 48) break;
        take(it);
      }
    }
    // 3) 反义对：成对入堆，保证对比词同时在场
    for (const p of shuffle(run, meta.antPairs || [])) {
      if (picked.length >= 56) break;
      const a = uniq.get(String(p[0]).toLowerCase());
      const b = uniq.get(String(p[1]).toLowerCase());
      if (!a || !b) continue;
      const hasA = pickedWords.has(String(a.w).toLowerCase());
      const hasB = pickedWords.has(String(b.w).toLowerCase());
      if (hasA && hasB) continue;
      if (hasA) take(b);
      else if (hasB) take(a);
      else {
        take(a);
        take(b);
      }
    }
    // 4) 余量按频率档 1-13 分层补足，新词优先
    const buckets = new Map();
    for (const [w, it] of uniq) {
      if (pickedWords.has(w)) continue;
      const r = Math.min(13, Math.max(1, Number(it.rank) || 7));
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r).push(it);
    }
    const rankOrder = shuffle(run, [...buckets.keys()]);
    rankOrder.forEach((r, idx) => {
      const arr = buckets.get(r);
      const fresh = arr.filter((it) => !seen[String(it.w).toLowerCase()]);
      const old = arr.filter((it) => seen[String(it.w).toLowerCase()]);
      const want = Math.ceil((80 - picked.length) / Math.max(1, rankOrder.length - idx));
      for (const it of shuffle(run, fresh).concat(shuffle(run, old)).slice(0, want)) take(it);
    });
    for (const it of shuffle(run, [...uniq.values()])) {
      if (picked.length >= 80) break;
      take(it);
    }
    return picked.slice(0, 80).map((it, i) => cardFromWord(it, i));
  }

  function defaultProfile() {
    return { crystals: 0, upgrades: { power: 0, memory: 0, economy: 0 }, bestAnte: 0, bestScore: 0, runs: 0, unlockedBosses: [], seenWords: {}, highErrorWords: [] };
  }

  function upgradeEffects(profile) {
    const out = { startChips: 0, handChipsPct: 0, goldMultBonus: 0, vaultThreshold: 0, firstHintFree: 0, goldFailSafe: 0, startMoney: 0, interestCap: 0, shopDiscount: 0 };
    const up = (profile && profile.upgrades) || {};
    Object.keys(UPGRADE_LINES).forEach((line) => {
      const lv = Number(up[line]) || 0;
      for (let i = 0; i < lv && i < 3; i++) {
        const eff = UPGRADE_LINES[line].levels[i].effect;
        if (eff.type === "startChips") out.startChips += eff.value;
        else if (eff.type === "handChipsPct") out.handChipsPct += eff.value;
        else if (eff.type === "goldMultBonus") out.goldMultBonus += eff.value;
        else if (eff.type === "vaultThreshold") out.vaultThreshold += eff.value;
        else if (eff.type === "firstHintFree") out.firstHintFree = 1;
        else if (eff.type === "goldFailSafe") out.goldFailSafe = 1;
        else if (eff.type === "startMoney") out.startMoney += eff.value;
        else if (eff.type === "interestCap") out.interestCap += eff.value;
        else if (eff.type === "shopDiscount") out.shopDiscount += eff.value;
      }
    });
    return out;
  }

  function createRun(opts) {
    const seed = (opts.seed >>> 0) || 20261025;
    const profile = Object.assign(defaultProfile(), opts.profile || {});
    const run = {
      version: VERSION,
      seed,
      rngState: seed,
      band: opts.band || "hs",
      profile,
      ante: 1,
      blindType: "small",
      blindCount: 0,
      target: ANTES[1].small,
      score: 0,
      money: 4,
      handsLeft: 4,
      discardsLeft: 3,
      handLimit: 8,
      relics: [],
      consumables: [],
      levels: { high: 1, posFlush: 1, collocation: 1, ladder: 1, grammar: 1 },
      deck: [],
      drawPile: [],
      discardPile: [],
      hand: [],
      vault: [],
      stats: { handsPlayed: 0, discards: 0, maxChain: 0, wordsSeen: {}, crystalsEarned: 0 },
      phase: "blind",
      shop: null,
      blind: null,
      flags: { goldFailUsed: false, extraHandUsed: false },
      upgradeEff: upgradeEffects(profile),
    };
    run.deck = buildDeck(run, opts.bank || [], profile);
    run.drawPile = shuffle(run, run.deck);
    run.money = 4 + run.upgradeEff.startMoney;
    run.handLimit = 8;
    startBlind(run);
    return run;
  }

  function anteConf(run) {
    return ANTES[run.ante] || ANTES[8];
  }

  function startBlind(run) {
    const conf = anteConf(run);
    const type = run.blindType;
    run.target = conf[type];
    run.score = 0;
    run.handsLeft = 4;
    run.discardsLeft = 3 + relicSum(run, "discards");
    run.handLimit = 8 + relicSum(run, "handSize");
    if (run.hand.length) run.discardPile.push(...run.hand);
    run.hand = [];
    run.phase = "blind";
    run.blind = {
      bossType: type === "boss" ? conf.bossType : null,
      handsPlayed: 0,
      hintsUsed: 0,
      freeHintUsed: false,
      surgeVoid: false,
      flowStreak: 0,
      firstHandDone: false,
      goldPulled: 0,
    };
    for (const c of run.deck) {
      c.hintedThisBlind = false;
      c.freeHintThisBlind = false;
      c.blurred = false;
      c.heldHands = 0;
    }
    // 黄金卡到期抽回：每 3 个盲注一张
    const goldInterval = Math.max(1, 3 - relicSum(run, "goldEngine"));
    const due = run.vault.filter((c) => c.gold && c.vaultSkips + 1 >= goldInterval);
    if (due.length) {
      const card = due[0];
      run.vault = run.vault.filter((c) => c !== card);
      card.vaultSkips = 0;
      card.gold = true;
      card.mastery = 4;
      card.blurred = false;
      run.hand.push(card);
      run.blind.goldPulled++;
    }
    for (const c of run.vault) if (c.gold) c.vaultSkips++;
    drawToLimit(run);
    // 圣物：每 N 个盲注第一张手牌强制黄金
    const brandN = relicSum(run, "goldEveryNBlinds");
    if (brandN > 0 && run.blindCount > 0 && run.blindCount % brandN === 0) {
      let card = null;
      if (run.vault.some((c) => c.gold)) {
        card = run.vault.find((c) => c.gold);
        run.vault = run.vault.filter((c) => c !== card);
        card.vaultSkips = 0;
      } else if (run.hand.length) {
        card = run.hand[0];
        card.gold = true;
        card.mastery = 4;
      }
      if (card) run.blind.goldPulled++;
    }
    // Boss 潜意识风暴：开幕 3 张黄金卡
    if (bossActive(run, "surge")) {
      for (let i = 0; i < Math.min(3, run.hand.length); i++) {
        run.hand[i].gold = true;
        run.hand[i].mastery = 4;
      }
    }
  }

  function bossActive(run, type) {
    if (run.blindType !== "boss" || !run.blind) return false;
    if (run.blind.bossType === type) return true;
    return run.blind.bossType === "final";
  }

  function hasRelic(run, id) {
    return run.relics.includes(id);
  }

  function relicEffect(run, type) {
    return RELICS.filter((r) => run.relics.includes(r.id) && r.effect.type === type);
  }

  function relicSum(run, type) {
    return relicEffect(run, type).reduce((s, r) => s + (Number(r.effect.value) || 0), 0);
  }

  function drawToLimit(run) {
    while (run.hand.length < run.handLimit) {
      if (!run.drawPile.length) {
        if (!run.discardPile.length) break;
        run.drawPile = shuffle(run, run.discardPile);
        run.discardPile = [];
      }
      run.hand.push(run.drawPile.pop());
    }
  }

  function findCard(run, id) {
    return run.hand.find((c) => c.id === id) || run.deck.find((c) => c.id === id) || null;
  }

  function useHint(run, cardId) {
    if (bossActive(run, "blackout")) return { ok: false, reason: "BLACKOUT" };
    const card = run.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, reason: "NOT_IN_HAND" };
    if (card.hintedThisBlind) return { ok: true, card, already: true };
    card.hintedThisBlind = true;
    run.blind.hintsUsed++;
    const freeBudget = run.blind.freeHintUsed ? 0 : relicSum(run, "firstHintFree") + (run.upgradeEff.firstHintFree || 0);
    if (freeBudget > 0) {
      run.blind.freeHintUsed = true;
      card.freeHintThisBlind = true;
    } else {
      card.hintBlockedClean = true;
    }
    return { ok: true, card, free: card.freeHintThisBlind };
  }

  function discard(run, ids) {
    if (run.phase !== "blind") return { ok: false, reason: "NOT_BLIND" };
    const list = (ids || []).filter((id) => run.hand.some((c) => c.id === id));
    if (!list.length) return { ok: false, reason: "EMPTY" };
    if (run.discardsLeft <= 0) return { ok: false, reason: "NO_DISCARDS" };
    const removed = [];
    run.hand = run.hand.filter((c) => {
      if (list.includes(c.id)) {
        removed.push(c);
        return false;
      }
      return true;
    });
    run.discardPile.push(...removed);
    run.discardsLeft--;
    run.stats.discards += removed.length;
    drawToLimit(run);
    return { ok: true, discarded: removed.map((c) => c.id) };
  }

  function posOverlap(a, b) {
    return a.posPlayable.some((p) => b.posPlayable.includes(p));
  }

  function posIntersection(cards) {
    if (!cards.length) return [];
    let inter = cards[0].posPlayable.slice();
    for (let i = 1; i < cards.length; i++) inter = inter.filter((p) => cards[i].posPlayable.includes(p));
    return inter;
  }

  function synEdge(a, b) {
    if (a.synGroup != null && a.synGroup === b.synGroup) return true;
    return a.syn.includes(b.w) || b.syn.includes(a.w);
  }

  function antEdge(a, b) {
    return a.ant.includes(b.w) || b.ant.includes(a.w);
  }

  function findSynTrio(cards) {
    const idx = cards.map((_, i) => i);
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++) {
          if (synEdge(cards[i], cards[j]) && synEdge(cards[j], cards[k]) && synEdge(cards[i], cards[k])) return [i, j, k];
        }
    return null;
  }

  function collocationOk(cards) {
    if (cards.length !== 5) return null;
    const trio = findSynTrio(cards);
    if (!trio) return null;
    const rest = [0, 1, 2, 3, 4].filter((i) => !trio.includes(i));
    if (!antEdge(cards[rest[0]], cards[rest[1]])) return null;
    return { trio, pair: rest };
  }

  function ladderOk(cards) {
    if (cards.length !== 5) return null;
    if (cards.some((c) => c.rank == null)) return null;
    for (let i = 1; i < 5; i++) if (cards[i].rank <= cards[i - 1].rank) return null;
    return { ranks: cards.map((c) => c.rank) };
  }

  function lcs(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[a.length][b.length];
  }

  function bestPosSeq(cards) {
    // 每张卡选一个词性，穷举上限 4^5=1024
    const opts = cards.map((c) => (c.posPlayable.length ? c.posPlayable : ["n"]));
    let best = null;
    const rec = (i, cur) => {
      if (i === opts.length) {
        for (const tpl of GRAMMAR_TEMPLATES) {
          let match = 0;
          for (let k = 0; k < tpl.length; k++) if (tpl[k] === cur[k]) match++;
          if (match === 5) {
            best = { seq: cur.slice(), tpl, match: 5 };
            return true;
          }
          if (match >= 4 && (!best || match > best.match)) best = { seq: cur.slice(), tpl, match };
        }
        return false;
      }
      for (const p of opts[i]) {
        cur.push(p);
        if (rec(i + 1, cur)) return true;
        cur.pop();
      }
      return false;
    };
    rec(0, []);
    return best;
  }

  function detectPattern(cards, opts) {
    opts = opts || {};
    if (cards.length === 1) return { pattern: "high", detail: {} };
    if (cards.length !== 5) return { pattern: "high", detail: { reason: "COUNT" } };
    const relax = Number(opts.relax) || 0;
    const g = bestPosSeq(cards);
    if (g && (g.match === 5 || (relax >= 1 && g.match >= 4))) return { pattern: "grammar", detail: { seq: g.seq, tpl: g.tpl, match: g.match } };
    const ladder = ladderOk(cards);
    if (ladder) return { pattern: "ladder", detail: ladder };
    const coll = collocationOk(cards);
    if (coll) return { pattern: "collocation", detail: coll };
    const inter = posIntersection(cards);
    if (inter.length) return { pattern: "posFlush", detail: { pos: inter } };
    return { pattern: "high", detail: { reason: "NONE" } };
  }

  function cardChips(card) {
    const len = card.w.length;
    let base = 5;
    if (len >= 13) base = 20;
    else if (len >= 11) base = 17;
    else if (len >= 9) base = 14;
    else if (len >= 7) base = 11;
    else if (len >= 5) base = 8;
    if (card.enhancement === "highFreq") base += 100;
    return base;
  }

  function vowels(w) {
    let n = 0;
    for (const ch of w) if (VOWELS.has(ch)) n++;
    return n;
  }

  function matchCard(effect, card) {
    const m = effect.match || {};
    if (m.prefix && !m.prefix.some((p) => card.w.startsWith(p))) return false;
    if (m.minSyl && card.syl < m.minSyl) return false;
    if (m.endsIn && !m.endsIn.includes(card.w[card.w.length - 1])) return false;
    if (m.minVowels && vowels(card.w) < m.minVowels) return false;
    if (m.hasAffix && !(card.affixes && card.affixes.length)) return false;
    return true;
  }

  function hasClean(cards) {
    return !cards.some((c) => c.hintedThisBlind && !c.freeHintThisBlind);
  }

  function scoreHand(run, cards, patternInfo, opts) {
    opts = opts || {};
    const pid = patternInfo.pattern;
    const base = HANDS[pid];
    const levelRelic = relicEffect(run, "handLevel")
      .filter((r) => r.effect.hand === pid)
      .reduce((s, r) => s + (Number(r.effect.value) || 0), 0);
    const level = Math.max(1, (Number(run.levels[pid]) || 1) + levelRelic);
    const per = base.perLevel || { chips: 0, mult: 0 };
    let chips = base.chips + (level - 1) * per.chips;
    let mult = base.mult + (level - 1) * per.mult;
    const detail = { pattern: pid, patternName: base.name, level, chain: 0, letterChain: 0, goldMult: 1, clean: true, chips, mult };

    chips += run.upgradeEff.startChips;
    if (run.upgradeEff.handChipsPct) chips = Math.round(chips * (1 + run.upgradeEff.handChipsPct));

    const clean = hasClean(cards);
    if (clean && opts.declare) mult += relicSum(run, "declareMult");

    // 出牌顺序：词性连击 + 首尾接龙 + 前缀强化
    const prefixBoost = cards.length > 1 && cards[0].enhancement === "prefixBoost";
    let prev = null;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      let add = c.hintedThisBlind ? 0 : cardChips(c);
      if (c.blurred) add = 0;
      if (i > 0 && prev && posOverlap(prev, c)) {
        mult += 2;
        detail.chain++;
      }
      if (i > 0 && prev && prev.w[prev.w.length - 1] === c.w[0]) {
        add *= 2;
        mult += relicSum(run, "chainMult");
        detail.letterChain++;
      }
      if (prefixBoost && i > 0) add *= 2;
      chips += add;
      prev = c;
    }
    // 圣物：逐卡
    for (const c of cards) {
      if (c.blurred) continue;
      for (const r of relicEffect(run, "chipsPerCard")) if (matchCard(r.effect, c)) chips += r.effect.value;
      for (const r of relicEffect(run, "multPerCard")) if (matchCard(r.effect, c)) mult += r.effect.value;
    }
    if (clean) chips += cards.length * relicSum(run, "cleanChipsPerCard");
    chips += cards.reduce((s, c) => s + (c.wrongBookChips || 0), 0);
    const firstSeenBonus = relicSum(run, "chipsOnFirstSeen");
    if (firstSeenBonus) chips += firstSeenBonus * cards.filter((c) => !run.stats.wordsSeen[c.w]).length;
    if (pid === "collocation" && patternInfo.detail && patternInfo.detail.trio)
      chips += patternInfo.detail.trio.length * relicSum(run, "synChipsPerCard");

    // 条件圣物
    for (const r of relicEffect(run, "condChips")) {
      const e = r.effect;
      if (e.cond === "allSylDistinct" && cards.length >= 5 && new Set(cards.map((c) => c.syl)).size === cards.length) chips += e.value;
      if (e.cond === "posTypes3" && new Set(cards.map((c) => (c.posPlayable[0] || "n"))).size >= 3) chips += e.value;
    }
    for (const r of relicEffect(run, "condMultX")) {
      const e = r.effect;
      if (e.cond === "sameRoot2") {
        const roots = {};
        let hit = false;
        for (const c of cards)
          for (const a of c.affixes || []) {
            const k = a.replace(/^-|-$/g, "");
            roots[k] = (roots[k] || 0) + 1;
            if (roots[k] >= 2) hit = true;
          }
        if (hit) mult *= e.value;
      }
      if (e.cond === "lenSpread3") {
        const lens = cards.map((c) => c.w.length);
        if (Math.max(...lens) - Math.min(...lens) <= 3) mult *= e.value;
      }
    }
    for (const r of relicEffect(run, "patternMultX")) if (r.effect.hand === pid) mult *= r.effect.value;
    for (const r of relicEffect(run, "patternMult")) if (r.effect.hand === pid) mult += r.effect.value;
    if (pid === "ladder") mult += (cards.length - 1) * relicSum(run, "ladderMultPerStep");

    if (run.blind.handsPlayed === 0) chips += relicSum(run, "firstHandChips");
    if (run.blind.handsPlayed === 3) mult += relicSum(run, "lastHandMult");
    const flowN = relicSum(run, "flowMultX");
    if (run.blind.flowStreak >= 2 && flowN > 1) mult *= flowN;

    let cleanMult = 1;
    if (clean) cleanMult = 1.5;
    else {
      const keep = relicSum(run, "hintKeepHalfClean");
      if (keep > 0 && cards.some((c) => c.hintedThisBlind && !c.freeHintThisBlind)) cleanMult = Math.max(1, 1.5 - keep);
    }

    let goldMult = 1;
    const golds = cards.filter((c) => c.gold);
    const goldBase = 10 + relicSum(run, "goldEngine") * 5 + run.upgradeEff.goldMultBonus;
    for (const g of golds) {
      if (!g.hintedThisBlind && !opts.declarationFail) {
        goldMult *= bossActive(run, "surge") ? 1000 : goldBase;
        if (bossActive(run, "surge")) run.blind.goldSuccess = true;
      }
    }
    if (run.blind.surgeVoid) goldMult = 1;

    const score = Math.floor(chips * mult * cleanMult * goldMult);
    detail.chips = chips;
    detail.mult = mult;
    detail.cleanMult = cleanMult;
    detail.goldMult = goldMult;
    detail.score = score;
    detail.clean = clean;
    return detail;
  }

  function playHand(run, ids, declare) {
    if (run.phase !== "blind") return { ok: false, reason: "NOT_BLIND" };
    const idsArr = (ids || []).slice(0, 5);
    if (!idsArr.length) return { ok: false, reason: "EMPTY" };
    const cards = idsArr.map((id) => run.hand.find((c) => c.id === id)).filter(Boolean);
    if (cards.length !== idsArr.length) return { ok: false, reason: "NOT_IN_HAND" };
    if (cards.some((c) => c.blurred)) return { ok: false, reason: "BLURRED" };
    if (run.handsLeft <= 0) return { ok: false, reason: "NO_HANDS" };

    const relaxed = relicSum(run, "grammarRelax");
    const detected = detectPattern(cards, { relax: relaxed });
    let declarationFail = false;
    let patternInfo = detected;
    if (declare && declare !== "auto") {
      if (detected.pattern !== declare) {
        declarationFail = true;
        patternInfo = { pattern: "high", detail: { reason: "DECLARE_FAIL", intended: declare } };
      }
    }
    // 潜意识风暴：黄金卡失误判定
    if (bossActive(run, "surge")) {
      const goldFails = cards.some((c) => c.gold && (c.hintedThisBlind || declarationFail));
      if (goldFails) run.blind.surgeVoid = true;
    }

    const info = scoreHand(run, cards, patternInfo, { declare: declare && declare !== "auto", declarationFail });

    // 移除手牌并记录
    run.hand = run.hand.filter((c) => !cards.includes(c));
    run.handsLeft--;
    run.stats.handsPlayed++;
    run.blind.handsPlayed++;
    run.blind.firstHandDone = true;

    const events = [];
    // 熟练度 / 归库 / 黄金结算
    for (const c of cards) {
      const cleanThis = !c.hintedThisBlind && !declarationFail;
      if (declarationFail) {
        c.cleanStreak = 0;
        if (relicSum(run, "wrongBookChips") > 0) c.wrongBookChips = relicSum(run, "wrongBookChips");
        if (!run.profile.highErrorWords.includes(c.w)) {
          run.profile.highErrorWords.push(c.w);
          if (run.profile.highErrorWords.length > 100) run.profile.highErrorWords.shift();
        }
      } else if (cleanThis && c.enhancement !== "highFreq") {
        c.cleanStreak++;
      } else if (!cleanThis) c.cleanStreak = 0;

      if (c.gold) {
        if (!c.hintedThisBlind && !declarationFail) {
          c.mastery = 4;
          c.vaultSkips = 0;
          run.vault.push(c);
          events.push({ type: "gold_success", word: c.w });
        } else {
          const safe = run.upgradeEff.goldFailSafe || relicSum(run, "goldFailSafe");
          if (safe && !run.flags.goldFailUsed) {
            run.flags.goldFailUsed = true;
            c.mastery = 4;
            c.vaultSkips = 0;
            run.vault.push(c);
            events.push({ type: "gold_saved", word: c.w });
          } else {
            c.gold = false;
            c.mastery = 0;
            c.cleanStreak = 0;
            run.discardPile.push(c);
            events.push({ type: "gold_broken", word: c.w });
          }
        }
      } else {
        const threshold = Math.max(1, 3 + relicSum(run, "vaultThreshold") + run.upgradeEff.vaultThreshold);
        if (c.cleanStreak >= threshold && c.enhancement !== "highFreq") {
          c.mastery = 3;
          c.vaultSkips = 0;
          run.vault.push(c);
          run.money += relicSum(run, "onVaultMoney");
          events.push({ type: "vaulted", word: c.w });
        } else {
          run.discardPile.push(c);
        }
      }
      if (!declarationFail && c.wrongBookChips) c.wrongBookChips = 0;
      if (!run.stats.wordsSeen[c.w]) run.stats.wordsSeen[c.w] = 1;
    }
    const chainMoney = relicSum(run, "chainMoney");
    if (chainMoney && info.letterChain) run.money += chainMoney * info.letterChain;

    // 记忆衰退：仍未打出的手牌计数
    if (bossActive(run, "decay")) {
      for (const c of run.hand) {
        c.heldHands++;
        if (c.heldHands > 2) {
          c.blurred = true;
          events.push({ type: "blurred", word: c.w });
        }
      }
    }
    // 心流连续无瑕
    if (!declarationFail && hasClean(cards)) run.blind.flowStreak++;
    else run.blind.flowStreak = 0;

    const cleared = run.score + info.score >= run.target;
    run.score += info.score;
    if (cleared) {
      run.phase = "settle";
    } else if (run.handsLeft <= 0) {
      if (relicSum(run, "extraHand") > 0 && !run.flags.extraHandUsed) {
        run.flags.extraHandUsed = true;
        run.handsLeft = 1;
        events.push({ type: "shield", msg: "神经元护盾补充 1 次出牌" });
      } else {
        run.phase = "gameover";
        const oldBest = run.profile.bestScore || 0;
        if (run.score > oldBest) run.profile.bestScore = run.score;
        if (run.ante - 1 > (run.profile.bestAnte || 0)) run.profile.bestAnte = run.ante - 1;
        commitProfile(run);
      }
    }
    if (run.phase === "blind") drawToLimit(run);

    return { ok: true, pattern: patternInfo.pattern, patternName: HANDS[patternInfo.pattern].name, detail: info, declarationFail, events, cleared };
  }

  function commitProfile(run) {
    if (run.flags.committed) return;
    run.flags.committed = true;
    for (const w of Object.keys(run.stats.wordsSeen)) run.profile.seenWords[w] = 1;
    run.profile.runs = (run.profile.runs || 0) + 1;
  }

  function settleBlind(run) {
    if (run.phase !== "settle") return { ok: false, reason: "NOT_SETTLED" };
    const base = run.blindType === "small" ? 4 : run.blindType === "big" ? 6 : 8;
    let gained = base + run.handsLeft;
    const interestCap = 5 + run.upgradeEff.interestCap;
    const interest = Math.min(interestCap, Math.floor(run.money / 5));
    gained += interest;
    const clean = run.blind.hintsUsed === 0;
    if (clean) gained += 2;
    run.money += gained;
    const events = [];
    let crystals = 0;
    if (run.blindType === "boss") {
      crystals += 2;
      const key = "ante" + run.ante;
      if (!run.profile.firstClears || !run.profile.firstClears[key]) {
        crystals += 3;
        run.profile.firstClears = run.profile.firstClears || {};
        run.profile.firstClears[key] = true;
      }
      if (run.ante === 8) {
        crystals += 20;
        run.phase = "victory";
      }
      if (BOSSES[run.blind.bossType] && !run.profile.unlockedBosses.includes(run.blind.bossType)) run.profile.unlockedBosses.push(run.blind.bossType);
      const enhN = relicSum(run, "bossEnhancement");
      for (let i = 0; i < enhN; i++) {
        const pool = run.deck.filter((c) => c.enhancement === "None");
        if (!pool.length) break;
        const card = pool[rndInt(run, pool.length)];
        card.enhancement = ENHANCEMENTS[rndInt(run, ENHANCEMENTS.length)].id;
        events.push({ type: "enhanced", word: card.w, enhancement: card.enhancement });
      }
    }
    const keepRatio = relicSum(run, "keepHalfStreak");
    if (keepRatio > 0) {
      const ratio = keepRatio <= 1 ? keepRatio : 0.5;
      for (const c of run.hand) c.cleanStreak = Math.floor(c.cleanStreak * ratio);
    }
    run.profile.crystals = (run.profile.crystals || 0) + crystals;
    run.stats.crystalsEarned += crystals;
    if (run.phase !== "victory") {
      run.phase = "shop";
      makeShop(run);
    } else {
      commitProfile(run);
    }
    return { ok: true, gained, interest, clean, crystals, events, phase: run.phase };
  }

  function relicPrice(run, r) {
    return Math.max(1, Math.round(r.price * (1 - run.upgradeEff.shopDiscount)));
  }

  function makeShop(run) {
    const owned = new Set(run.relics);
    const relicPool = shuffle(run, RELICS.filter((r) => !owned.has(r.id))).slice(0, 2);
    const cons = shuffle(run, CONSUMABLES).slice(0, 1);
    const offers = [];
    offers.push(...relicPool.map((r) => ({ type: "relic", id: r.id, name: r.name, desc: r.desc, price: relicPrice(run, r), rarity: r.rarity })));
    offers.push(...cons.map((c) => ({ type: "consumable", id: c.id, name: c.name, desc: c.desc, price: c.price })));
    offers.push({ type: "erase", id: "erase", name: "词库剔除", desc: "从本局牌堆永久移除 1 张卡", price: 3 });
    run.shop = { offers, refreshes: 0 };
    return run.shop;
  }

  function buy(run, slot) {
    if (run.phase !== "shop" || !run.shop) return { ok: false, reason: "NOT_SHOP" };
    const offer = run.shop.offers[slot];
    if (!offer) return { ok: false, reason: "NO_OFFER" };
    if (offer.type === "erase") return { ok: false, reason: "NEED_CARD", offer };
    if (run.money < offer.price) return { ok: false, reason: "NO_MONEY" };
    if (offer.type === "relic") {
      if (run.relics.length >= 5) return { ok: false, reason: "RELIC_FULL" };
      if (run.relics.includes(offer.id)) return { ok: false, reason: "OWNED" };
      run.relics.push(offer.id);
    } else if (offer.type === "consumable") {
      if (run.consumables.length >= 2) return { ok: false, reason: "CONSUMABLE_FULL" };
      run.consumables.push(offer.id);
    }
    run.money -= offer.price;
    run.shop.offers[slot] = { type: "sold", id: offer.id, name: offer.name, price: 0 };
    return { ok: true, offer };
  }

  function eraseCard(run, cardId) {
    if (run.phase !== "shop") return { ok: false, reason: "NOT_SHOP" };
    const offerIdx = run.shop.offers.findIndex((o) => o.type === "erase");
    if (offerIdx < 0) return { ok: false, reason: "NO_ERASE" };
    if (run.money < run.shop.offers[offerIdx].price) return { ok: false, reason: "NO_MONEY" };
    const card = run.deck.find((c) => c.id === cardId);
    if (!card) return { ok: false, reason: "NOT_FOUND" };
    run.deck = run.deck.filter((c) => c !== card);
    run.drawPile = run.drawPile.filter((c) => c !== card);
    run.discardPile = run.discardPile.filter((c) => c !== card);
    run.hand = run.hand.filter((c) => c !== card);
    run.money -= run.shop.offers[offerIdx].price;
    run.shop.offers[offerIdx] = { type: "sold", id: "erase", name: "词库剔除", price: 0 };
    return { ok: true, card: card.w };
  }

  function refreshShop(run) {
    if (run.phase !== "shop" || !run.shop) return { ok: false, reason: "NOT_SHOP" };
    if (run.shop.refreshes >= 3) return { ok: false, reason: "MAX_REFRESH" };
    if (run.money < 2) return { ok: false, reason: "NO_MONEY" };
    run.money -= 2;
    const refreshes = run.shop.refreshes + 1;
    makeShop(run);
    run.shop.refreshes = refreshes;
    return { ok: true, refreshes };
  }

  function nextBlind(run) {
    if (run.phase !== "shop") return { ok: false, reason: "NOT_SHOP" };
    if (run.blindType === "boss") {
      run.ante++;
      run.blindType = "small";
      if (run.ante > 8) return { ok: false, reason: "VICTORY" };
    } else if (run.blindType === "small") run.blindType = "big";
    else run.blindType = "boss";
    run.blindCount++;
    startBlind(run);
    run.phase = "blind";
    return { ok: true, ante: run.ante, blindType: run.blindType, target: run.target };
  }

  function useConsumable(run, idx, targetCardId) {
    if (run.phase !== "blind" && run.phase !== "shop") return { ok: false, reason: "BAD_PHASE" };
    const id = run.consumables[idx];
    const def = CONSUMABLES.find((c) => c.id === id);
    if (!def) return { ok: false, reason: "NONE" };
    if (run.phase === "shop" && def.kind !== "manual") return { ok: false, reason: "BLIND_ONLY" };
    let card = null;
    if (def.kind === "scroll") {
      card = run.hand.find((c) => c.id === targetCardId);
      if (!card) return { ok: false, reason: "PICK_CARD" };
    }
    if (id === "derive-scroll") {
      if (card.posPlayable.length < 2) return { ok: false, reason: "NO_MULTI_POS" };
      const cur = card.posPlayable[0];
      card.posPlayable = card.posPlayable.slice(1).concat([cur]);
      card.pos = card.posPlayable.slice();
    } else if (id === "gold-foil") {
      run.hand = run.hand.filter((c) => c !== card);
      card.gold = true;
      card.mastery = 4;
      card.vaultSkips = 999;
      run.vault.push(card);
      drawToLimit(run);
    } else if (id === "affix-graft") {
      card.enhancement = "prefixBoost";
    } else if (id === "synonym-scroll") {
      const sameGroup = (c) =>
        c.id !== card.id &&
        ((card.synGroup != null && c.synGroup === card.synGroup) ||
          (card.syn || []).indexOf(c.w) >= 0 ||
          (c.syn || []).indexOf(card.w) >= 0);
      const cands = run.drawPile.concat(run.discardPile).filter(sameGroup);
      const pick = cands.length ? cands[rndInt(run, cands.length)] : null;
      if (!pick) return { ok: false, reason: "NO_SYNONYM" };
      run.hand = run.hand.filter((c) => c !== card);
      run.drawPile = run.drawPile.filter((c) => c !== pick);
      run.discardPile = run.discardPile.filter((c) => c !== pick);
      pick.hintedThisBlind = false;
      run.hand.push(pick);
      run.discardPile.push(card);
    } else if (id === "flush-manual") run.levels.posFlush++;
    else if (id === "grammar-manual") run.levels.grammar++;
    else if (id === "ladder-manual") run.levels.ladder++;
    else if (id === "collocation-manual") run.levels.collocation++;
    run.consumables.splice(idx, 1);
    return { ok: true, used: def.name };
  }

  function buyUpgrade(profile, line) {
    if (!profile) return { ok: false, reason: "NO_PROFILE" };
    if (!profile.upgrades) profile.upgrades = { power: 0, memory: 0, economy: 0 };
    const conf = UPGRADE_LINES[line];
    if (!conf) return { ok: false, reason: "BAD_LINE" };
    const lv = Number(profile.upgrades[line]) || 0;
    if (lv >= 3) return { ok: false, reason: "MAX" };
    const cost = conf.levels[lv].cost;
    if ((profile.crystals || 0) < cost) return { ok: false, reason: "NO_CRYSTALS" };
    profile.crystals -= cost;
    profile.upgrades[line] = lv + 1;
    return { ok: true, level: lv + 1, cost };
  }

  const api = {
    VERSION,
    defaultProfile,
    createRun,
    startBlind,
    drawToLimit,
    useHint,
    discard,
    detectPattern,
    scoreHand,
    playHand,
    settleBlind,
    makeShop,
    buy,
    eraseCard,
    refreshShop,
    nextBlind,
    useConsumable,
    buyUpgrade,
    buildDeck,
    cardFromWord,
    normPos,
    upgradeEffects,
    hasRelic,
    bossActive,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LexiconEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
