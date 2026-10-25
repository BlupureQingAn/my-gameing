export function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = Number(seed) >>> 0;
    this.next = mulberry32(this.seed);
  }

  int(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }

  pick(list) {
    if (!list || !list.length) return undefined;
    return list[this.int(list.length)];
  }

  shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  sample(list, count) {
    return this.shuffle(list).slice(0, count);
  }

  weighted(pairs) {
    const total = pairs.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    if (total <= 0) return pairs.length ? pairs[0][0] : undefined;
    let roll = this.next() * total;
    for (const [value, weight] of pairs) {
      roll -= Math.max(0, weight);
      if (roll <= 0) return value;
    }
    return pairs[pairs.length - 1][0];
  }
}

export function createStreams(seed) {
  const base = hashString(String(seed));
  return {
    setup: new Rng(base ^ 0x1a2b3c4d),
    deck: new Rng(base ^ 0x51ed270b),
    roulette: new Rng(base ^ 0x2f6e2b1c),
    ai: new Rng(base ^ 0x7fffffff),
    topics: new Rng(base ^ 0x0badf00d),
  };
}

export function stableDraw(seed, ...parts) {
  return mulberry32(hashString(parts.join("|")) ^ (Number(seed) >>> 0))();
}
