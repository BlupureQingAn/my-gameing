import { MAX_REVIEW_WORDS } from "./constants.js";

export function emptyBook() {
  return {};
}

export function addWord(book, item, meta = {}, now = Date.now()) {
  const w = item.w;
  const existing = book[w];
  if (existing) {
    existing.streak = 0;
    existing.updatedAt = now;
    if (meta.source && meta.source !== existing.source) existing.source = meta.source;
    return { added: false, reset: true, entry: existing };
  }
  const entry = {
    w,
    band: meta.band || item.band || "",
    ipa: item.ipa || "",
    pos: item.pos || [],
    glossZh: item.zh || "",
    glossEn: item.def || item.en || "",
    topicType: meta.topicType || "",
    topicPrompt: meta.topicPrompt || "",
    streak: 0,
    reviews: 0,
    lastResult: null,
    source: meta.source || "auto",
    createdAt: now,
    updatedAt: now,
  };
  book[w] = entry;
  return { added: true, reset: false, entry };
}

export function addAuto(book, item, meta = {}, now = Date.now()) {
  return addWord(book, item, { ...meta, source: "auto" }, now);
}

export function addManual(book, item, meta = {}, now = Date.now()) {
  return addWord(book, item, { ...meta, source: "manual" }, now);
}

export function recordAnswer(book, word, correct, now = Date.now()) {
  const entry = book[word];
  if (!entry) return { tracked: false, mastered: false };
  entry.reviews += 1;
  entry.lastResult = Boolean(correct);
  entry.updatedAt = now;
  if (correct) {
    entry.streak += 1;
  } else {
    entry.streak = 0;
  }
  if (entry.streak >= 2) {
    delete book[word];
    return { tracked: true, mastered: true, entry };
  }
  return { tracked: true, mastered: false, entry };
}

export function removeWord(book, word) {
  const existed = Boolean(book[word]);
  delete book[word];
  return existed;
}

export function pickReviewWords(book, max = MAX_REVIEW_WORDS, exclude = new Set()) {
  return Object.values(book)
    .filter((entry) => !exclude.has(entry.w))
    .sort((a, b) => {
      if (a.reviews !== b.reviews) return a.reviews - b.reviews;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.w.localeCompare(b.w);
    })
    .slice(0, Math.min(max, MAX_REVIEW_WORDS))
    .map((entry) => entry.w);
}

export function pickManualReviewWords(entries, band, max = MAX_REVIEW_WORDS) {
  const limit = Math.min(max, MAX_REVIEW_WORDS);
  return entries
    .filter((entry) => !entry.deleted && entry.band === band && entry.source === "manual" && Number(entry.streak) < 2)
    .sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0))
    .slice(0, limit)
    .map((entry) => entry.w);
}

export function mergeReviewWords(manual = [], due = [], max = MAX_REVIEW_WORDS) {
  const limit = Math.min(max, MAX_REVIEW_WORDS);
  const words = [];
  for (const raw of [...manual, ...due]) {
    const word = String(raw || "").trim();
    if (!word || words.includes(word)) continue;
    words.push(word);
    if (words.length >= limit) break;
  }
  return words;
}

export function vocabStats(book) {
  const entries = Object.values(book);
  return {
    total: entries.length,
    due: entries.filter((entry) => entry.streak < 2).length,
    mastered: 0,
    byBand: entries.reduce((acc, entry) => {
      acc[entry.band] = (acc[entry.band] || 0) + 1;
      return acc;
    }, {}),
  };
}
