import { DIFFICULTY, K, MAX_PLAY } from "./constants.js";
import { createStreams, stableDraw } from "./rng.js";

const FREQ_HIGH = 30;
const FREQ_MID = 5;
const KNOW_P = { high: 0.92, mid: 0.76, low: 0.5 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bucketOf(item) {
  const freq = item && typeof item.freq === "number" ? item.freq : 0;
  if (freq >= FREQ_HIGH) return "high";
  if (freq >= FREQ_MID) return "mid";
  return "low";
}

function difficultyParams(difficulty) {
  return DIFFICULTY[difficulty] || DIFFICULTY.normal;
}

export class AIPlayer {
  constructor({ seat, difficulty = "normal", seed = "ai", bankIndex, topic = null, rng }) {
    this.seat = seat;
    this.difficulty = difficultyParams(difficulty);
    this.difficultyKey = difficulty;
    this.seed = String(seed);
    this.bankIndex = bankIndex || {};
    this.topic = topic;
    this.rng = rng || createStreams(`${this.seed}:ai:${seat}`).ai;
    this.beliefs = new Map();
    this.memory = { challenges: {}, lies: {} };
  }

  setTopic(topic) {
    this.topic = topic;
  }

  item(word) {
    return this.bankIndex[word];
  }

  knows(word) {
    if (!word || word === "JOKER") return true;
    const item = this.item(word);
    const p = KNOW_P[bucketOf(item)];
    return stableDraw(this.seed, "knows", this.seat, word) < p;
  }

  accuracy(word) {
    const item = this.item(word);
    const bonus = this.difficulty.frequencyBonus[bucketOf(item) === "high"
      ? 0
      : bucketOf(item) === "mid" ? 1 : 2];
    return clamp(this.difficulty.accuracy + bonus, 0.35, 0.98);
  }

  judge(word, target = this.topic?.target, compliant = this.topic?.compliant || []) {
    if (word === "JOKER") return true;
    const key = `${target || ""}|${word}`;
    if (this.beliefs.has(key)) return this.beliefs.get(key);
    const truth = compliant.includes(word);
    let belief;
    if (this.knows(word) && this.knows(target)) {
      belief = truth;
    } else {
      const correct = stableDraw(this.seed, "judge", this.seat, target || "", word)
        < this.accuracy(word);
      belief = correct ? truth : !truth;
    }
    this.beliefs.set(key, belief);
    return belief;
  }

  answerCards(cards) {
    const answers = {};
    for (const card of cards) {
      if (card.joker) continue;
      answers[card.id] = this.judge(card.w);
    }
    return answers;
  }

  believedCompliant(hand) {
    return hand.filter((card) => card.joker || this.judge(card.w));
  }

  choosePlay(view) {
    const hand = view.self.hand;
    const handN = hand.length;
    if (!handN) throw new Error("AI has no cards to play");

    if (handN <= MAX_PLAY) {
      return { type: "play", cardIds: hand.map((card) => card.id) };
    }

    const believed = this.believedCompliant(hand);
    const key = this.difficultyKey;
    let count;
    if (key === "easy") {
      count = 1 + this.rng.int(2);
    } else {
      count = 1;
      if (key === "hard" && view.x + 1 <= K + 1 && believed.length >= 3
        && this.rng.next() < 0.35) {
        count = 2;
      }
      if (handN === 4 && believed.length >= 2 && this.rng.next() < 0.5) count = 2;
    }
    count = clamp(count, 1, Math.min(MAX_PLAY, handN));

    if (believed.length) {
      const chosen = believed.slice(0, Math.min(count, believed.length));
      return { type: "play", cardIds: chosen.map((card) => card.id) };
    }

    const lieCount = key === "easy"
      ? 1 + this.rng.int(2)
      : Math.min(handN, 1 + (this.rng.next() < 0.4 ? 1 : 0));
    const chosen = hand.slice(0, clamp(lieCount, 1, Math.min(MAX_PLAY, handN)));
    return { type: "play", cardIds: chosen.map((card) => card.id) };
  }

  estimateLie(view, last = view.chain[view.chain.length - 1]) {
    if (!last) return 0;
    const n = last.claimed;
    if (!n) return 0.02;
    const target = view.players[last.player];
    const ownHand = view.self.hand;
    const ownTruth = ownHand.filter((card) => !card.joker && this.judge(card.w)).length;
    const revealed = view.revealed || [];
    const truthSeen = revealed.filter((card) => card.truth && !card.joker).length;
    const jokerSeen = revealed.some((card) => card.joker);
    const capacity = K + (jokerSeen ? 0 : 1);
    const truthLeft = Math.max(0, capacity - truthSeen - ownTruth);
    const alive = view.players.filter((player) => player.alive);
    const unknownCards = Math.max(
      1,
      alive.reduce((sum, player) => sum + player.handCount, 0) - ownHand.length,
    );
    const perCard = Math.min(0.8, truthLeft / unknownCards);
    let p = 1 - Math.pow(1 - perCard, n);
    if (view.x > truthLeft + n) p = Math.max(p, 0.85);
    p += Math.min(0.25, Math.max(0, view.x - K) * 0.05);
    if (target && target.handCount <= 2) p += 0.06;
    const challenges = this.memory.challenges[last.player] || 0;
    if (challenges) {
      p += Math.min(0.2, 0.2 * ((this.memory.lies[last.player] || 0) / challenges));
    }
    return clamp(p, 0.02, 0.97);
  }

  chooseChallenge(view) {
    const last = view.chain[view.chain.length - 1];
    if (!last || last.player === this.seat) return false;
    if (!last.claimed) return false;
    if (view.self.hand.length <= MAX_PLAY) return false;
    const target = view.players[last.player];
    if (!target || !target.alive) return false;

    if (this.difficultyKey === "easy") {
      if (view.x >= K) return this.rng.next() < 0.85;
      if (view.x >= K - 1) return this.rng.next() < 0.45;
      return this.rng.next() < 0.1;
    }

    const p = this.estimateLie(view, last);
    const believed = this.believedCompliant(view.self.hand).length;
    let threshold = (this.difficultyKey === "hard" ? 0.43 : 0.48)
      + Math.min(0.2, (view.self.pulls || 0) * 0.03);
    if (believed >= 3 && view.x < K) threshold += 0.08;
    if (this.difficultyKey === "hard" && last.claimed >= 3) threshold -= 0.04;
    return p > threshold;
  }

  chooseTopic(candidates) {
    let bestScore = -Infinity;
    let pool = [];
    for (const topic of candidates) {
      const compliant = topic.compliant || [];
      const known = compliant.filter(
        (word) => this.judge(word, topic.target, compliant),
      ).length / 6;
      const score = known;
      if (score > bestScore + 1e-6) {
        bestScore = score;
        pool = [topic];
      } else if (Math.abs(score - bestScore) <= 1e-6) {
        pool.push(topic);
      }
    }
    return this.rng.pick(pool);
  }

  noteChallengeResult({ targetId, isLie }) {
    this.memory.challenges[targetId] = (this.memory.challenges[targetId] || 0) + 1;
    if (isLie) this.memory.lies[targetId] = (this.memory.lies[targetId] || 0) + 1;
  }

  action(view) {
    if (view.chain.length && this.chooseChallenge(view)) {
      return { type: "challenge" };
    }
    return this.choosePlay(view);
  }
}
