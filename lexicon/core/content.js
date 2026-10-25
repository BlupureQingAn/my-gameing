/* Lexicon Rush - static content (relics, consumables, antes, bosses) */
(function (root) {
  "use strict";

  const HANDS = {
    high: { id: "high", name: "散牌", chips: 5, mult: 1, perLevel: null, priority: 0 },
    posFlush: { id: "posFlush", name: "词性同花", chips: 30, mult: 4, perLevel: { chips: 15, mult: 2 }, priority: 2 },
    collocation: { id: "collocation", name: "搭配葫芦", chips: 40, mult: 5, perLevel: { chips: 20, mult: 3 }, priority: 3 },
    ladder: { id: "ladder", name: "语义顺子", chips: 50, mult: 7, perLevel: { chips: 25, mult: 4 }, priority: 4 },
    grammar: { id: "grammar", name: "语法同花顺", chips: 100, mult: 10, perLevel: { chips: 30, mult: 5 }, priority: 5 },
  };

  const GRAMMAR_TEMPLATES = [
    ["adj", "n", "v", "adv", "n"],
    ["n", "v", "adj", "n", "adv"],
    ["adv", "adj", "n", "v", "n"],
    ["adj", "adj", "n", "v", "n"],
    ["n", "v", "n", "adv", "adj"],
    ["v", "adv", "adj", "n", "n"],
    ["adj", "n", "adv", "v", "n"],
    ["n", "adj", "n", "v", "adv"],
    ["adv", "v", "adj", "n", "n"],
    ["adj", "v", "adv", "n", "n"],
  ];

  const ANTES = {
    1: { small: 300, big: 450, boss: 600, bossType: "blackout" },
    2: { small: 800, big: 1200, boss: 1600, bossType: "blackout" },
    3: { small: 2000, big: 3000, boss: 4000, bossType: "decay" },
    4: { small: 5000, big: 7500, boss: 10000, bossType: "decay" },
    5: { small: 12000, big: 18000, boss: 25000, bossType: "surge" },
    6: { small: 30000, big: 45000, boss: 60000, bossType: "surge" },
    7: { small: 70000, big: 105000, boss: 150000, bossType: "decay" },
    8: { small: 150000, big: 225000, boss: 350000, bossType: "final" },
  };

  const BOSSES = {
    blackout: { id: "blackout", name: "全盲考验", desc: "本盲注禁用「查看提示」" },
    decay: { id: "decay", name: "记忆衰退", desc: "手牌超过 2 次出牌未打出会模糊成废牌" },
    surge: { id: "surge", name: "潜意识风暴", desc: "开幕 3 张黄金卡；无瑕打出 ×1000，任一张失误则本盲注黄金倍率失效" },
    final: { id: "final", name: "三重奏", desc: "全盲考验 + 记忆衰退 + 潜意识风暴同时生效" },
  };

  const RELICS = [
    { id: "prefix-medal", name: "前缀勋章", school: "ling", rarity: "C", price: 5, desc: "带 un-/dis-/re-/pre-/anti- 前缀的卡 +50 Chips", effect: { type: "chipsPerCard", match: { prefix: ["un", "dis", "re", "pre", "anti"] }, value: 50 } },
    { id: "multi-syllable", name: "多音节重炮", school: "ling", rarity: "R", price: 7, desc: "3 音节及以上的卡 +15 Mult", effect: { type: "multPerCard", match: { minSyl: 3 }, value: 15 } },
    { id: "flush-tutor", name: "同花导师", school: "ling", rarity: "C", price: 5, desc: "词性同花等级 +1", effect: { type: "handLevel", hand: "posFlush", value: 1 } },
    { id: "root-resonance", name: "词根共鸣", school: "ling", rarity: "R", price: 7, desc: "本手 ≥2 张同词根卡时 Mult ×2", effect: { type: "condMultX", cond: "sameRoot2", value: 2 } },
    { id: "grammar-scholar", name: "语法学者", school: "ling", rarity: "L", price: 9, desc: "语法同花顺判定放宽一个位置", effect: { type: "grammarRelax", value: 1 } },
    { id: "chain-link", name: "接龙链条", school: "ling", rarity: "C", price: 4, desc: "首尾接龙触发时额外 +3 Mult", effect: { type: "chainMult", value: 3 } },
    { id: "syllable-metronome", name: "音节节拍器", school: "ling", rarity: "C", price: 5, desc: "5 张卡音节数互不相同 → +40 Chips", effect: { type: "condChips", cond: "allSylDistinct", value: 40 } },
    { id: "initial-hunter", name: "首字母猎手", school: "ling", rarity: "C", price: 4, desc: "每次首尾接龙 +$1", effect: { type: "chainMoney", value: 1 } },
    { id: "synonym-lens", name: "同义放大镜", school: "ling", rarity: "R", price: 6, desc: "搭配葫芦中每张同义卡 +10 Chips", effect: { type: "synChipsPerCard", value: 10 } },
    { id: "antonym-seesaw", name: "反义跷跷板", school: "ling", rarity: "R", price: 7, desc: "搭配葫芦成立时 Mult ×1.5", effect: { type: "patternMultX", hand: "collocation", value: 1.5 } },
    { id: "topic-scholar", name: "主题学者", school: "ling", rarity: "R", price: 7, desc: "语义顺子每级额外 +1 Mult", effect: { type: "ladderMultPerStep", value: 1 } },
    { id: "syntax-master", name: "句法大师", school: "ling", rarity: "L", price: 9, desc: "语法同花顺基础 Mult +3", effect: { type: "patternMult", hand: "grammar", value: 3 } },
    { id: "vowel-resonance", name: "元音共鸣", school: "ling", rarity: "C", price: 4, desc: "含 ≥3 个元音字母的卡 +8 Chips", effect: { type: "chipsPerCard", match: { minVowels: 3 }, value: 8 } },
    { id: "consonant-wall", name: "辅音壁垒", school: "ling", rarity: "C", price: 5, desc: "词尾为 t/d/k/p/b/g 的卡 +4 Mult", effect: { type: "multPerCard", match: { endsIn: ["t", "d", "k", "p", "b", "g"] }, value: 4 } },
    { id: "length-balance", name: "长短平衡", school: "ling", rarity: "R", price: 6, desc: "最短与最长词长度差 ≤3 时 Mult ×1.5", effect: { type: "condMultX", cond: "lenSpread3", value: 1.5 } },
    { id: "pos-chameleon", name: "词性变色龙", school: "ling", rarity: "R", price: 6, desc: "本手 ≥3 种词性时 +30 Chips", effect: { type: "condChips", cond: "posTypes3", value: 30 } },
    { id: "affix-collector", name: "词缀收藏家", school: "ling", rarity: "C", price: 5, desc: "每张带词缀的卡 +6 Chips", effect: { type: "chipsPerCard", match: { hasAffix: true }, value: 6 } },
    { id: "lexicographer", name: "词典编纂者", school: "ling", rarity: "L", price: 9, desc: "本局首次出现的词每张 +15 Chips", effect: { type: "chipsOnFirstSeen", value: 15 } },

    { id: "ebbinghaus", name: "艾宾浩斯引擎", school: "mem", rarity: "L", price: 9, desc: "黄金卡重现间隔 -1，黄金倍率 +5", effect: { type: "goldEngine", value: 1 } },
    { id: "subconscious-gold", name: "潜意识淘金", school: "mem", rarity: "R", price: 7, desc: "卡牌归库时 +$15", effect: { type: "onVaultMoney", value: 15 } },
    { id: "forget-resist", name: "遗忘抵抗", school: "mem", rarity: "R", price: 6, desc: "每盲注首次查看提示不取消无瑕加成", effect: { type: "firstHintFree", value: 1 } },
    { id: "gold-brand", name: "黄金烙铁", school: "mem", rarity: "L", price: 8, desc: "每 3 个盲注开始，第一张手牌强制为黄金卡", effect: { type: "goldEveryNBlinds", value: 3 } },
    { id: "spaced-repeater", name: "间隔重复器", school: "mem", rarity: "R", price: 7, desc: "归库所需连击 -1", effect: { type: "vaultThreshold", value: -1 } },
    { id: "memory-palace", name: "记忆宫殿", school: "mem", rarity: "L", price: 9, desc: "手牌上限 +2", effect: { type: "handSize", value: 2 } },
    { id: "hippocampus", name: "海马体加速", school: "mem", rarity: "C", price: 4, desc: "每盲注 +1 弃牌", effect: { type: "discards", value: 1 } },
    { id: "synapse", name: "突触火花", school: "mem", rarity: "C", price: 5, desc: "无瑕手每张卡 +5 Chips", effect: { type: "cleanChipsPerCard", value: 5 } },
    { id: "sleep-consolidate", name: "睡眠巩固", school: "mem", rarity: "R", price: 6, desc: "盲注结算时手牌未打出的卡保留 50% 连击", effect: { type: "keepHalfStreak", value: 0.5 } },
    { id: "retrieval-practice", name: "检索练习", school: "mem", rarity: "C", price: 5, desc: "宣言成功额外 +2 Mult", effect: { type: "declareMult", value: 2 } },
    { id: "interference-resist", name: "干扰抵抗", school: "mem", rarity: "R", price: 6, desc: "查看提示后本手其他卡保留一半无瑕加成", effect: { type: "hintKeepHalfClean", value: 0.25 } },
    { id: "gold-memory", name: "黄金记忆", school: "mem", rarity: "L", price: 9, desc: "每局首次黄金卡失败不降级", effect: { type: "goldFailSafe", value: 1 } },
    { id: "wrong-book", name: "错题本", school: "mem", rarity: "C", price: 4, desc: "宣言失败后该词下次出现 +50 Chips", effect: { type: "wrongBookChips", value: 50 } },
    { id: "primacy", name: "首因效应", school: "mem", rarity: "C", price: 4, desc: "每盲注第一手 +30 Chips", effect: { type: "firstHandChips", value: 30 } },
    { id: "recency", name: "近因效应", school: "mem", rarity: "C", price: 4, desc: "每盲注第 4 手 +5 Mult", effect: { type: "lastHandMult", value: 5 } },
    { id: "flow-state", name: "心流状态", school: "mem", rarity: "R", price: 7, desc: "连续 2 手无瑕后，第 3 手 Mult ×2", effect: { type: "flowMultX", value: 2 } },
    { id: "memory-crystal", name: "记忆晶体", school: "mem", rarity: "L", price: 10, desc: "每通关一个 Boss 获得 1 个随机印记", effect: { type: "bossEnhancement", value: 1 } },
    { id: "neuron-shield", name: "神经元护盾", school: "mem", rarity: "L", price: 9, desc: "每局 1 次：分数不足时自动补 1 次出牌", effect: { type: "extraHand", value: 1 } },
  ];

  const CONSUMABLES = [
    { id: "derive-scroll", name: "派生卷轴", kind: "scroll", price: 3, desc: "将 1 张多义词卡切换到它的另一词性" },
    { id: "gold-foil", name: "镀金箔纸", kind: "scroll", price: 3, desc: "将 1 张手牌点化为黄金卡，下个盲注强制抽入" },
    { id: "affix-graft", name: "词缀嫁接", kind: "scroll", price: 3, desc: "给 1 张卡附加 Prefix Boost 印记" },
    { id: "synonym-scroll", name: "同义词卷轴", kind: "scroll", price: 3, desc: "将 1 张手牌替换为同义组的另一张词卡" },
    { id: "flush-manual", name: "词性同花指南", kind: "manual", price: 3, desc: "本局词性同花等级 +1" },
    { id: "grammar-manual", name: "语法图解", kind: "manual", price: 3, desc: "本局语法同花顺等级 +1" },
    { id: "ladder-manual", name: "语义阶梯图", kind: "manual", price: 3, desc: "本局语义顺子等级 +1" },
    { id: "collocation-manual", name: "搭配辞典", kind: "manual", price: 3, desc: "本局搭配葫芦等级 +1" },
  ];

  const ENHANCEMENTS = [
    { id: "polysemy", name: "多义词", desc: "可充当任一所属词性" },
    { id: "highFreq", name: "高频词", desc: "打出时 +100 Chips，永不归库" },
    { id: "prefixBoost", name: "前缀强化", desc: "作为本手第一张牌时，后续卡牌 Chips ×2" },
  ];

  const UPGRADE_LINES = {
    power: {
      name: "词力",
      levels: [
        { cost: 3, desc: "起始 +20 Chips", effect: { type: "startChips", value: 20 } },
        { cost: 6, desc: "牌型基础 Chips +10%", effect: { type: "handChipsPct", value: 0.1 } },
        { cost: 10, desc: "黄金倍率 +2", effect: { type: "goldMultBonus", value: 2 } },
      ],
    },
    memory: {
      name: "记忆",
      levels: [
        { cost: 3, desc: "归库连击 -1", effect: { type: "vaultThreshold", value: -1 } },
        { cost: 6, desc: "每局首次提示免费", effect: { type: "firstHintFree", value: 1 } },
        { cost: 10, desc: "黄金失败不降级（每局一次）", effect: { type: "goldFailSafe", value: 1 } },
      ],
    },
    economy: {
      name: "经济",
      levels: [
        { cost: 3, desc: "起始金币 +2", effect: { type: "startMoney", value: 2 } },
        { cost: 6, desc: "利息上限 +2", effect: { type: "interestCap", value: 2 } },
        { cost: 10, desc: "商店 9 折", effect: { type: "shopDiscount", value: 0.1 } },
      ],
    },
  };

  const STOPWORDS = new Set(
    "a an the of to in on at by for with and or but if is are was were be been being have has had do does did will would can could shall should may might must not no yes i you he she it we they me him her us them my your his its our their this that these those there here as so than then too very just also only up down out off over under again further once all any both each few more most other some such own same s t don now".split(
      " "
    )
  );

  const api = { HANDS, GRAMMAR_TEMPLATES, ANTES, BOSSES, RELICS, CONSUMABLES, ENHANCEMENTS, UPGRADE_LINES, STOPWORDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LexiconContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
