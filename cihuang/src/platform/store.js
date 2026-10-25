// 本地存档：档案、生词本、设置、装扮。会员登录后由 main.js 负责与云端合并。

const K_PROFILE = "cihuang_profile_v1";
const K_VOCAB = "cihuang_vocab_v1";
const K_STATS = "cihuang_stats_v1";

export const COSMETICS = {
  cardback: {
    label: "牌背",
    items: [
      { id: "cb_default", name: "酒红罗盘", price: 0, color: 0x5b1f2a, accent: 0xc9a227 },
      { id: "cb_moss", name: "青苔暗纹", price: 150, color: 0x24402e, accent: 0x8fae7a },
      { id: "cb_gold", name: "烫金残页", price: 300, color: 0x3b2a12, accent: 0xe6c15c },
    ],
  },
  mask: {
    label: "面具",
    items: [
      { id: "mask_default", name: "无名白面", price: 0, color: 0xcfc7b4, accent: 0x8a7f6a },
      { id: "mask_fox", name: "裂痕狐面", price: 200, color: 0xe7ded0, accent: 0xb03a3a },
      { id: "mask_plague", name: "疫医鸟喙", price: 350, color: 0x2a2724, accent: 0xd6a54a },
    ],
  },
  felt: {
    label: "桌布",
    items: [
      { id: "felt_default", name: "旧酒馆绿", price: 0, color: 0x1f4a3a, accent: 0x2d6a52 },
      { id: "felt_ink", name: "深海墨蓝", price: 150, color: 0x173447, accent: 0x2a5c77 },
      { id: "felt_oxblood", name: "牛血红绒", price: 250, color: 0x4a1e22, accent: 0x7a3038 },
    ],
  },
  roulette: {
    label: "轮盘",
    items: [
      { id: "rl_brass", name: "黄铜旧铳", price: 0, color: 0x9a7b3f, accent: 0xe2c477 },
      { id: "rl_steel", name: "冷钢新铳", price: 180, color: 0x6f7a82, accent: 0xc7d2d9 },
      { id: "rl_obsidian", name: "黑曜刻纹", price: 320, color: 0x211f28, accent: 0xb06bc9 },
    ],
  },
};

export const COSMETIC_INDEX = Object.fromEntries(
  Object.values(COSMETICS).flatMap((group) => group.items.map((item) => [item.id, item])),
);

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value == null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 隐私模式或配额满时静默失败，游戏仍可进行
  }
}

export function defaultProfile() {
  return {
    crystals: 0,
    cosmetics: ["cb_default", "mask_default", "felt_default", "rl_brass"],
    equipped: {
      cardback: "cb_default",
      mask: "mask_default",
      felt: "felt_default",
      roulette: "rl_brass",
    },
    settings: { sound: true, music: true, ambient: true, reducedMotion: false, confirmedRules: false },
  };
}

export function loadProfile() {
  const saved = readJSON(K_PROFILE, null);
  if (!saved || typeof saved !== "object") return defaultProfile();
  const base = defaultProfile();
  return {
    crystals: Math.max(0, Math.trunc(Number(saved.crystals) || 0)),
    cosmetics: Array.isArray(saved.cosmetics)
      ? Array.from(new Set([...base.cosmetics, ...saved.cosmetics.filter((id) => COSMETIC_INDEX[id])]))
      : base.cosmetics,
    equipped: { ...base.equipped, ...(saved.equipped || {}) },
    settings: { ...base.settings, ...(saved.settings || {}) },
  };
}

export function saveProfile(profile) {
  writeJSON(K_PROFILE, profile);
}

export function loadStats() {
  return {
    games: 0,
    wins: 0,
    best: { easy: 0, normal: 0, hard: 0 },
    ...readJSON(K_STATS, {}),
  };
}

export function saveStats(stats) {
  writeJSON(K_STATS, stats);
}

export function recordStats({ difficulty, placement, score }) {
  const stats = loadStats();
  stats.games += 1;
  if (placement === 1) stats.wins += 1;
  if (!stats.best) stats.best = { easy: 0, normal: 0, hard: 0 };
  stats.best[difficulty] = Math.max(Number(stats.best[difficulty]) || 0, Number(score) || 0);
  saveStats(stats);
  return stats;
}

function normalizeWord(word) {
  return String(word || "").trim();
}

function vocabKey(word) {
  return normalizeWord(word).toLowerCase();
}

export function loadVocab() {
  const list = readJSON(K_VOCAB, []);
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && item.w).map((item) => ({
    ...item,
    w: normalizeWord(item.w),
    streak: Math.max(0, Math.trunc(Number(item.streak) || 0)),
    reviews: Math.max(0, Math.trunc(Number(item.reviews) || 0)),
    lastResult: item.lastResult === true,
    deleted: item.deleted === true,
  }));
}

export function saveVocab(list) {
  writeJSON(K_VOCAB, list.filter((item) => !item.deleted));
}

export function upsertVocab(entry) {
  const list = loadVocab();
  const key = vocabKey(entry.w);
  const idx = list.findIndex((item) => vocabKey(item.w) === key);
  const now = new Date().toISOString();
  const base = {
    w: normalizeWord(entry.w),
    band: entry.band || "hs",
    ipa: entry.ipa || "",
    pos: Array.isArray(entry.pos) ? entry.pos : [],
    glossZh: entry.glossZh || "",
    glossEn: entry.glossEn || "",
    topicType: entry.topicType || "definition",
    topicPrompt: entry.topicPrompt || "",
    source: entry.source || "auto",
    streak: Math.max(0, Math.trunc(Number(entry.streak) || 0)),
    reviews: Math.max(0, Math.trunc(Number(entry.reviews) || 0)),
    lastResult: entry.lastResult === true,
    createdAt: now,
    updatedAt: now,
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...base, createdAt: list[idx].createdAt || now, updatedAt: now };
  } else {
    list.push(base);
  }
  saveVocab(list);
  return idx >= 0 ? list[idx] : list[list.length - 1];
}

export function addWordFromCard(card, { band, topic, source = "auto" } = {}) {
  return upsertVocab({
    w: card.w,
    band,
    ipa: card.ipa,
    pos: card.pos,
    glossZh: card.zh,
    glossEn: card.def,
    topicType: topic?.type,
    topicPrompt: topic?.prompt,
    source,
    streak: 0,
    reviews: 0,
    lastResult: false,
  });
}

export function markAnswer(word, correct) {
  const list = loadVocab();
  const key = vocabKey(word);
  const idx = list.findIndex((item) => vocabKey(item.w) === key);
  if (idx < 0) return null;
  const item = list[idx];
  item.reviews += 1;
  item.lastResult = !!correct;
  item.streak = correct ? item.streak + 1 : 0;
  item.updatedAt = new Date().toISOString();
  saveVocab(list);
  return item;
}

export function dueReviewWords(band, limit = 5) {
  return loadVocab()
    .filter((item) => !item.deleted && item.band === band && item.streak < 2 && item.reviews > 0)
    .sort((a, b) => Number(a.lastResult) - Number(b.lastResult) || b.reviews - a.reviews)
    .slice(0, limit)
    .map((item) => item.w);
}

export function deleteWord(word) {
  const list = loadVocab().filter((item) => vocabKey(item.w) !== vocabKey(word));
  saveVocab(list);
}

export function setCloudId(word, cloudId) {
  const list = loadVocab();
  const key = vocabKey(word);
  const idx = list.findIndex((item) => vocabKey(item.w) === key);
  if (idx < 0) return;
  list[idx].cloudId = cloudId;
  saveVocab(list);
}

export function mergeCloudVocab(items) {
  if (!Array.isArray(items)) return loadVocab();
  const local = loadVocab();
  const map = new Map(local.map((item) => [vocabKey(item.w), item]));
  for (const raw of items) {
    if (!raw || !raw.w) continue;
    const key = vocabKey(raw.w);
    const mine = map.get(key);
    const incoming = {
      w: raw.w,
      band: raw.band || "hs",
      ipa: raw.ipa || "",
      pos: Array.isArray(raw.pos) ? raw.pos : [],
      glossZh: raw.glossZh || "",
      glossEn: raw.glossEn || "",
      topicType: raw.topicType || "definition",
      topicPrompt: raw.topicPrompt || "",
      source: raw.source || "auto",
      streak: Number(raw.streak) || 0,
      reviews: Number(raw.reviews) || 0,
      lastResult: raw.lastResult === true,
      createdAt: raw.createdAt || "",
      updatedAt: raw.updatedAt || "",
      cloudId: raw.id || "",
    };
    if (!mine || Date.parse(incoming.updatedAt || 0) > Date.parse(mine.updatedAt || 0)) {
      map.set(key, { ...mine, ...incoming });
    }
  }
  const merged = Array.from(map.values());
  saveVocab(merged);
  return merged;
}

export function profileEquipped(profile) {
  return {
    cardback: COSMETIC_INDEX[profile.equipped.cardback] || COSMETIC_INDEX.cb_default,
    mask: COSMETIC_INDEX[profile.equipped.mask] || COSMETIC_INDEX.mask_default,
    felt: COSMETIC_INDEX[profile.equipped.felt] || COSMETIC_INDEX.felt_default,
    roulette: COSMETIC_INDEX[profile.equipped.roulette] || COSMETIC_INDEX.rl_brass,
  };
}
