import {
  BURY_SIZE,
  DECK_SIZE,
  DEAL_SIZE,
  HAND_SIZE,
  MAX_REVIEW_WORDS,
} from "../src/core/constants.js";

const COMPLIANT = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const DISTRACTORS = Array.from({ length: 20 }, (_, i) => `d${String(i + 1).padStart(2, "0")}`);
const EXTRA_REVIEW = ["reviewone", "reviewtwo", "reviewthree"];

export function makeBank() {
  const index = {};
  for (const word of [...COMPLIANT, ...DISTRACTORS, ...EXTRA_REVIEW]) {
    index[word] = {
      w: word,
      ipa: `/${word}/`,
      pos: ["n"],
      zh: `释义-${word}`,
      def: `definition of ${word}`,
    };
  }
  return index;
}

export function makeTopic(id = "topic-1") {
  return {
    id,
    type: "synonym",
    prompt: "测试题面",
    promptTokens: [],
    level: 1,
    target: "alpha",
    compliant: COMPLIANT.slice(),
    distractors: DISTRACTORS.slice(),
  };
}

export const sizes = {
  DECK_SIZE,
  DEAL_SIZE,
  BURY_SIZE,
  HAND_SIZE,
  MAX_REVIEW_WORDS,
};

export function card(id, { truth = true, joker = false, w = id } = {}) {
  return {
    id,
    w,
    ipa: "",
    pos: [],
    zh: "",
    def: "",
    truth: joker ? true : truth,
    joker,
    review: false,
  };
}

export function stubRoulette(state, draws) {
  const queue = draws.slice();
  state.rng.roulette = {
    int() {
      if (!queue.length) throw new Error("roulette draws exhausted");
      return queue.shift();
    },
  };
}
