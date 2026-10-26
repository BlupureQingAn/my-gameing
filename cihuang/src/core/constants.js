export const K = 6;
export const DECK_SIZE = 24;
export const DEAL_SIZE = 20;
export const BURY_SIZE = 4;
export const HAND_SIZE = 5;
export const MAX_PLAY = 3;
export const MAX_REVIEW_WORDS = 5;
export const ANSWER_MS = 10000;
export const REVEAL_MS = 450;
export const ROULETTE_SLOTS = 6;

export const HUMAN_ID = 0;
export const AI_IDS = [1, 2, 3];
export const PLAYER_IDS = [0, 1, 2, 3];

export const PLACEMENT_POINTS = { 1: 1000, 2: 600, 3: 300, 4: 100 };
export const PLACEMENT_CRYSTALS = { 1: 100, 2: 60, 3: 40, 4: 20 };
export const LOOKUP_COST = 10;
export const SCORE_CATCH = 50;
export const SCORE_BLUFF = 50;
export const SCORE_SURVIVE = 10;

export const TOPIC_RATIO = {
  easy: { definition: 0.7, synonym: 0.3 },
  normal: { definition: 0.5, synonym: 0.5 },
  hard: { definition: 0.3, synonym: 0.7 },
};

export const DIFFICULTY = {
  easy: {
    accuracy: 0.55,
    frequencyBonus: [0.1, 0.05, 0],
    challengeSkill: 0,
    bluffSkill: 0,
    memorySegments: 0,
  },
  normal: {
    accuracy: 0.7,
    frequencyBonus: [0.1, 0.05, 0],
    challengeSkill: 1,
    bluffSkill: 1,
    memorySegments: 3,
  },
  hard: {
    accuracy: 0.85,
    frequencyBonus: [0.1, 0.05, 0],
    challengeSkill: 2,
    bluffSkill: 2,
    memorySegments: 99,
  },
};

export const PHASE = {
  TURN: "turn",
  CHALLENGE: "challenge",
  ROULETTE: "roulette",
  ROUND_END: "round_end",
  GAME_END: "game_end",
};
