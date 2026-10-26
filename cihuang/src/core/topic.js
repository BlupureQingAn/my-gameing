import { TOPIC_RATIO } from "./constants.js";

function typeDistribution(count, ratio) {
  const raw = [
    ["definition", ratio.definition * count],
    ["synonym", ratio.synonym * count],
  ];
  const out = raw.map(([type, value]) => [type, Math.floor(value), value]);
  let used = out.reduce((sum, [, n]) => sum + n, 0);
  out.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]));
  let i = 0;
  while (used < count) {
    out[i % out.length][1] += 1;
    used += 1;
    i += 1;
  }
  const types = [];
  for (const [type, n] of out) {
    for (let k = 0; k < n; k += 1) types.push(type);
  }
  return types;
}

export class TopicPicker {
  constructor({ topics, difficulty = "normal", rng, recentLimit = 6 }) {
    this.topics = topics.filter(
      (t) => t && t.id && (t.type === "definition" || t.type === "synonym")
        && Array.isArray(t.compliant) && t.compliant.length === 6,
    );
    this.difficulty = difficulty;
    this.rng = rng;
    this.recentLimit = recentLimit;
    this.recent = [];
    this.byType = { definition: [], synonym: [] };
    for (const topic of this.topics) {
      if (this.byType[topic.type]) this.byType[topic.type].push(topic);
    }
  }

  isRecent(topic) {
    return this.recent.some(
      (entry) => entry.id === topic.id || entry.groupId === topic.groupId
        || entry.prompt === topic.prompt,
    );
  }

  markUsed(topic) {
    if (!topic) return;
    this.recent.push({ id: topic.id, groupId: topic.groupId, prompt: topic.prompt });
    while (this.recent.length > this.recentLimit) this.recent.shift();
  }

  chooseType() {
    const ratio = TOPIC_RATIO[this.difficulty] || TOPIC_RATIO.normal;
    return this.rng.weighted([["definition", ratio.definition], ["synonym", ratio.synonym]]);
  }

  pickType(type, usedIds = new Set()) {
    const pool = this.byType[type] || [];
    const fresh = pool.filter((t) => !usedIds.has(t.id) && !this.isRecent(t));
    const fallback = pool.filter((t) => !usedIds.has(t.id));
    const source = fresh.length ? fresh : fallback.length ? fallback : pool;
    if (!source.length) return null;
    return this.rng.pick(source);
  }

  initial() {
    let type = this.chooseType();
    let topic = this.pickType(type);
    if (!topic) {
      type = type === "definition" ? "synonym" : "definition";
      topic = this.pickType(type);
    }
    if (!topic) topic = this.rng.pick(this.topics);
    this.markUsed(topic);
    return topic;
  }

  candidates(count = 3) {
    const ratio = TOPIC_RATIO[this.difficulty] || TOPIC_RATIO.normal;
    const types = typeDistribution(count, ratio);
    const used = new Set();
    const out = [];
    for (const type of types) {
      let topic = this.pickType(type, used);
      if (!topic) topic = this.pickType(type === "definition" ? "synonym" : "definition", used);
      if (!topic) topic = this.rng.pick(this.topics.filter((t) => !used.has(t.id)));
      if (topic) {
        used.add(topic.id);
        out.push(topic);
      }
    }
    for (const topic of this.rng.shuffle(this.topics)) {
      if (out.length >= count) break;
      if (used.has(topic.id)) continue;
      used.add(topic.id);
      out.push(topic);
    }
    return out.slice(0, count);
  }

  pickRandom(candidates) {
    return candidates.length ? this.rng.pick(candidates) : null;
  }

  pickForAI(candidates, scoreFn) {
    let best = null;
    let bestScore = -Infinity;
    for (const topic of candidates) {
      const score = scoreFn(topic);
      if (score > bestScore) {
        bestScore = score;
        best = topic;
      }
    }
    return best;
  }
}
