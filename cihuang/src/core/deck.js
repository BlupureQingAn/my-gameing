import {
  BURY_SIZE,
  DECK_SIZE,
  DEAL_SIZE,
  HAND_SIZE,
  MAX_REVIEW_WORDS,
} from "./constants.js";

function makeCard(item, truth, id, extra = {}) {
  return {
    id,
    w: item.w,
    ipa: item.ipa || "",
    pos: item.pos || [],
    zh: item.zh || "",
    def: item.def || item.en || "",
    truth,
    joker: false,
    review: false,
    ...extra,
  };
}

function jokerCard(id) {
  return {
    id,
    w: "JOKER",
    ipa: "",
    pos: [],
    zh: "万能牌",
    def: "Always compliant",
    truth: true,
    joker: true,
    review: false,
  };
}

export function buildRoundDeck({
  topic,
  bankIndex,
  rng,
  reviewWords = [],
  round = 1,
}) {
  const compliant = Array.from(new Set(topic.compliant || []));
  if (compliant.length !== 6) {
    throw new Error(`topic ${topic.id} must have exactly 6 compliant words`);
  }
  const distractors = (topic.distractors || []).filter(
    (w) => !compliant.includes(w) && w !== topic.target,
  );
  if (distractors.length < 17) {
    throw new Error(`topic ${topic.id} has only ${distractors.length} distractors`);
  }

  const pickItem = (word, fallbackTruth) => {
    const item = bankIndex[word];
    if (!item) throw new Error(`bank missing word: ${word}`);
    return item;
  };

  let seq = 0;
  const nextId = () => `r${round}-c${seq++}`;

  const cards = compliant.map((word) =>
    makeCard(pickItem(word, true), true, nextId()),
  );
  const distractorSample = rng.sample(distractors, 17);
  for (const word of distractorSample) {
    cards.push(makeCard(pickItem(word, false), false, nextId()));
  }
  cards.push(jokerCard(nextId()));

  if (cards.length !== DECK_SIZE) {
    throw new Error(`deck size ${cards.length}`);
  }

  // 每轮最多带一张复习词，且必须是本轮主题的合规词（真话），不占用额外手牌位。
  const wanted = Array.from(new Set(reviewWords))
    .filter((w) => w && w !== topic.target && w !== "JOKER" && compliant.includes(w))
    .slice(0, 1);

  for (const word of wanted) {
    const existing = cards.find((c) => c.w === word);
    if (existing) existing.review = true;
  }

  const held = rng.sample(
    cards.filter((c) => !c.joker && !c.review),
    BURY_SIZE,
  );
  const heldIds = new Set(held.map((c) => c.id));
  let remaining = rng.shuffle(cards.filter((c) => !heldIds.has(c.id)));

  if (remaining.length !== DEAL_SIZE) {
    throw new Error(`deal size ${remaining.length}`);
  }
  if (!remaining.some((c) => c.joker)) {
    throw new Error("joker must be dealt");
  }

  const prioritized = remaining.filter((c) => c.review).slice(0, MAX_REVIEW_WORDS);
  const prioritizedIds = new Set(prioritized.map((c) => c.id));
  const rest = remaining.filter((c) => !prioritizedIds.has(c.id));

  const hands = [[], [], [], []];
  hands[0].push(...prioritized);
  for (const card of rest) {
    let seat = 0;
    if (hands[0].length >= HAND_SIZE) {
      seat = [1, 2, 3].find((s) => hands[s].length < HAND_SIZE);
    }
    if (seat === undefined) break;
    hands[seat].push(card);
  }

  hands.forEach((hand, seat) => {
    if (hand.length !== HAND_SIZE) {
      throw new Error(`seat ${seat} has ${hand.length} cards`);
    }
    hands[seat] = rng.shuffle(hand);
  });

  return {
    cards,
    held,
    hands,
    jokerDealt: true,
  };
}
