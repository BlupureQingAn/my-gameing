const POS_RE = /(?:^|\s)(?:a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|num|art|int|aux)\.\s*/g;

export function splitSenses(zh) {
  const out = [];
  for (const raw of String(zh || "").split(/[；;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const starts = Array.from(part.matchAll(POS_RE), (match) => match.index);
    if (starts.length <= 1) {
      out.push(part);
      continue;
    }
    const bounds = [...new Set([0, ...starts, part.length])].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const seg = part.slice(bounds[i], bounds[i + 1]).trim();
      if (seg) out.push(seg);
    }
  }
  return out.length ? out : [String(zh || "")];
}

export function matchedSenseIndices(topic, word) {
  const list = topic?.senseMatch?.[word];
  return Array.isArray(list) ? list : [];
}

export function explainFor(topic, word) {
  const entry = topic?.explain?.[word];
  if (!entry || !entry.note || entry.kind === "none") return null;
  return entry;
}

export function isNearMiss(topic, word) {
  return Array.isArray(topic?.nearMiss) && topic.nearMiss.includes(word);
}

export function nearMissExplainFor(topic, word) {
  if (!isNearMiss(topic, word)) return null;
  const entry = topic?.nearMissExplain?.[word];
  if (!entry || !entry.note || entry.kind === "none") return null;
  return entry;
}

export function topicSensesText(topic, limit = 20) {
  const list = Array.isArray(topic?.topicSenses) ? topic.topicSenses.filter(Boolean) : [];
  const text = list.join(" / ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function topicDisplay(topic) {
  const label = String(topic?.topicLabel || "").trim();
  return label || topicFullText(topic);
}

export function topicFullText(topic) {
  const zh = String(topic?.targetZh || "").trim();
  const def = String(topic?.prompt || "").trim();
  const isEnglish = /^[A-Za-z][A-Za-z\s'.-]*$/.test(def);
  if (!def || isEnglish) return zh || def;
  // 释义主题的 prompt 与 targetZh 常互为重复，取信息量更大的那条，避免同一义项出现两遍。
  if (topic?.type === "definition") return def.length > zh.length ? def : zh || def;
  return zh || def;
}
