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
