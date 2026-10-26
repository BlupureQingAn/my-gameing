import {
  HAND_SIZE,
  HUMAN_ID,
  K,
  MAX_PLAY,
  PHASE,
  PLAYER_IDS,
} from "./constants.js";
import { buildRoundDeck } from "./deck.js";
import { createStreams } from "./rng.js";
import {
  crystalsFor,
  placementFor,
  scoreBreakdown,
  settlementText,
} from "./score.js";

const MASK_LABELS = ["你", "面具一", "面具二", "面具三"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function alivePlayers(state) {
  return state.players.filter((player) => player.alive);
}

function nextAlive(state, fromId) {
  for (let step = 1; step <= PLAYER_IDS.length; step += 1) {
    const id = (fromId + step) % PLAYER_IDS.length;
    if (state.players[id].alive) return id;
  }
  return null;
}

function createPlayers() {
  return PLAYER_IDS.map((id) => ({
    id,
    alive: true,
    hand: [],
    pulls: 0,
    hit: false,
    isHuman: id === HUMAN_ID,
    mask: MASK_LABELS[id],
  }));
}

function emptyHumanStats() {
  return {
    catches: 0,
    bluffs: 0,
    survived: 0,
    plays: 0,
    challenges: 0,
    revealedCards: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
  };
}

export function createGame({
  seed,
  difficulty = "normal",
  band = "hs",
  topic,
  bankIndex,
  reviewWords = [],
  starter = null,
}) {
  assert(topic, "topic is required");
  assert(bankIndex, "bankIndex is required");
  const streams = createStreams(seed);
  const state = {
    seed,
    difficulty,
    band,
    bankIndex,
    round: 0,
    phase: PHASE.TURN,
    players: createPlayers(),
    topic: null,
    deck: null,
    chain: [],
    roundSegments: [],
    discard: [],
    revealed: [],
    currentPlayer: null,
    pendingChallenge: null,
    pendingPenalty: null,
    pendingRoulette: null,
    roundEnd: null,
    result: null,
    log: [],
    segmentSeq: 0,
    turnSeq: 0,
    human: emptyHumanStats(),
    injectedReviewWords: [],
    rng: streams,
  };
  startRound(state, { topic, starter, reviewWords });
  return state;
}

export function startRound(state, { topic, starter = null, reviewWords = [] }) {
  assert(topic, "topic is required");
  assert(state.phase !== PHASE.GAME_END, "game already ended");
  state.round += 1;
  const built = buildRoundDeck({
    topic,
    bankIndex: state.bankIndex,
    rng: state.rng.deck,
    reviewWords,
    round: state.round,
  });
  state.topic = topic;
  state.deck = built;
  state.chain = [];
  state.roundSegments = [];
  state.pendingChallenge = null;
  state.pendingPenalty = null;
  state.pendingRoulette = null;
  state.roundEnd = null;
  state.phase = PHASE.TURN;
  state.players.forEach((player, seat) => {
    player.hand = player.alive ? built.hands[seat].slice() : [];
  });
  const alive = alivePlayers(state).map((p) => p.id);
  state.starter = starter !== null && state.players[starter]?.alive
    ? starter
    : state.rng.setup.pick(alive);
  state.currentPlayer = state.starter;
  const injected = reviewWords.filter((w) => built.cards.some((c) => c.w === w && c.review));
  state.injectedReviewWords.push(...injected);
  state.log.push({
    t: "round_start",
    r: state.round,
    p: state.currentPlayer,
    topic: topic.id,
    reviews: injected.length,
  });
  return built;
}

export function play(state, playerId, cardIds) {
  assert(state.phase === PHASE.TURN, "not in turn phase");
  assert(state.currentPlayer === playerId, "not your turn");
  const player = state.players[playerId];
  assert(player && player.alive, "player is not alive");
  assert(Array.isArray(cardIds) && cardIds.length >= 1 && cardIds.length <= MAX_PLAY,
    `must play 1-${MAX_PLAY} cards`);
  assert(new Set(cardIds).size === cardIds.length, "duplicate cards");
  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
  assert(cards.every(Boolean), "card not in hand");

  const handIds = new Set(cardIds);
  player.hand = player.hand.filter((card) => !handIds.has(card.id));
  const segment = {
    id: ++state.segmentSeq,
    player: playerId,
    cards,
    claimed: cards.filter((card) => !card.joker).length,
    challenged: false,
    resolved: false,
    isLie: cards.some((card) => !card.joker && !card.truth),
  };
  state.chain.push(segment);
  state.roundSegments.push(segment);
  state.human.plays += playerId === HUMAN_ID ? 1 : 0;
  state.turnSeq += 1;
  state.log.push({
    t: "play",
    p: playerId,
    n: cards.length,
    c: segment.claimed,
    x: chainTotal(state),
  });

  if (player.hand.length === 0) {
    endRound(state, { reason: "empty", winner: playerId });
    return { type: "play", segment, emptied: true, roundEnd: state.roundEnd };
  }

  state.currentPlayer = nextAlive(state, playerId);
  state.phase = PHASE.TURN;
  return { type: "play", segment, emptied: false };
}

export function challenge(state, playerId) {
  assert(state.phase === PHASE.TURN, "not in turn phase");
  assert(state.currentPlayer === playerId, "not your turn");
  assert(state.chain.length > 0, "nothing to challenge");
  const segment = state.chain[state.chain.length - 1];
  assert(segment.player !== playerId, "cannot challenge yourself");
  const target = state.players[segment.player];
  assert(target.alive, "target is not alive");
  assert(target.hand.length > 0 || segment.cards.length === 0,
    "cannot challenge a player who emptied their hand");

  segment.challenged = true;
  const answerCards = segment.cards.filter((card) => !card.joker);
  const answerers = alivePlayers(state)
    .map((p) => p.id)
    .filter((id) => id !== segment.player);
  state.pendingChallenge = {
    segmentId: segment.id,
    targetId: segment.player,
    challengerId: playerId,
    segment,
    answerCards,
    answerers,
  };
  state.phase = PHASE.CHALLENGE;
  state.human.challenges += playerId === HUMAN_ID ? 1 : 0;
  state.log.push({
    t: "challenge",
    p: playerId,
    target: segment.player,
    n: segment.claimed,
  });
  return {
    targetId: segment.player,
    challengerId: playerId,
    cards: segment.cards.map((card) => ({
      id: card.id,
      w: card.w,
      ipa: card.ipa,
      joker: card.joker,
    })),
    answerers,
  };
}

export function resolveChallenge(state, answers = {}) {
  assert(state.phase === PHASE.CHALLENGE, "not in challenge phase");
  const pending = state.pendingChallenge;
  const segment = pending.segment;
  const isLie = segment.cards.some((card) => !card.joker && !card.truth);
  const penalized = isLie ? pending.targetId : pending.challengerId;
  const results = {};
  const learning = {};

  for (const answererId of pending.answerers) {
    const answerer = state.players[answererId];
    if (!answerer.alive) continue;
    const given = answers[answererId] || {};
    const rows = [];
    const wrong = [];
    let correctCount = 0;
    for (const card of pending.answerCards) {
      const raw = given[card.id];
      const answered = raw === true || raw === false;
      const correct = answered && raw === card.truth;
      if (correct) correctCount += 1;
      else wrong.push(card);
      rows.push({
        cardId: card.id,
        answer: answered ? raw : null,
        truth: card.truth,
        correct,
      });
    }
    results[answererId] = { rows, correctCount, wrongCount: wrong.length };
    learning[answererId] = wrong.map((card) => card.w);
    if (answererId === HUMAN_ID) {
      state.human.correctAnswers += correctCount;
      state.human.wrongAnswers += wrong.length;
    }
  }

  if (isLie && pending.challengerId === HUMAN_ID) {
    state.human.catches += 1;
  }
  for (const card of segment.cards) {
    state.revealed.push({
      w: card.w,
      ipa: card.ipa,
      zh: card.zh,
      def: card.def,
      truth: card.joker ? true : card.truth,
      joker: card.joker,
      round: state.round,
      target: pending.targetId,
    });
  }
  state.human.revealedCards += segment.cards.length;
  segment.resolved = true;
  state.discard.push(...segment.cards);
  state.pendingChallenge = {
    ...pending,
    isLie,
    penalized,
    results,
    learning,
    resolved: true,
  };
  state.pendingPenalty = penalized;
  state.phase = PHASE.ROULETTE;
  state.log.push({
    t: "judge",
    target: pending.targetId,
    challenger: pending.challengerId,
    lie: isLie,
    penalty: penalized,
    answers: Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, r.rows.map((x) => x.answer)]),
    ),
  });
  return {
    isLie,
    penalized,
    results,
    learning,
    cards: segment.cards,
  };
}

export function resolveRoulette(state) {
  assert(state.phase === PHASE.ROULETTE, "not in roulette phase");
  const playerId = state.pendingPenalty;
  const player = state.players[playerId];
  assert(player && player.alive, "penalized player is not alive");
  const before = alivePlayers(state).length;
  const draw = state.rng.roulette.int(6);
  const fire = draw < player.pulls + 1;
  player.pulls += 1;
  const result = {
    playerId,
    fire,
    pulls: player.pulls,
    probability: `${player.pulls}/6`,
    draw,
  };
  state.log.push({ t: "roulette", p: playerId, fire, pulls: player.pulls });
  state.pendingRoulette = result;

  if (!fire) {
    const challengerId = state.pendingChallenge.challengerId;
    state.pendingChallenge = null;
    state.pendingPenalty = null;
    state.chain = [];
    state.currentPlayer = state.players[challengerId]?.alive
      ? challengerId
      : nextAlive(state, playerId);
    state.phase = PHASE.TURN;
    return result;
  }

  player.alive = false;
  player.hit = true;
  player.hand = [];

  if (playerId === HUMAN_ID) {
    finishGame(state, {
      placement: placementFor(before),
      reason: "hit",
    });
    return result;
  }

  const remaining = alivePlayers(state);
  if (remaining.length === 1 && remaining[0].id === HUMAN_ID) {
    finishGame(state, { placement: 1, reason: "last" });
    return result;
  }

  const pending = state.pendingChallenge;
  let chooser = null;
  if (pending) {
    chooser = pending.penalized === pending.challengerId
      ? pending.targetId
      : pending.challengerId;
  }
  if (chooser === null || !state.players[chooser]?.alive) {
    chooser = nextAlive(state, playerId);
  }
  state.pendingChallenge = null;
  state.pendingPenalty = null;
  state.chain = [];
  endRound(state, {
    reason: "elimination",
    eliminated: playerId,
    nextChooser: chooser,
  });
  return result;
}

export function endRound(state, { reason, winner = null, eliminated = null, nextChooser = null }) {
  if (state.roundEnd) return state.roundEnd;
  for (const segment of state.roundSegments) {
    if (segment.challenged) continue;
    if (segment.player === HUMAN_ID && segment.isLie) state.human.bluffs += 1;
  }
  if (state.players[HUMAN_ID].alive) state.human.survived += 1;
  state.roundEnd = {
    reason,
    winner,
    eliminated,
    nextChooser: nextChooser ?? winner,
    round: state.round,
  };
  state.phase = PHASE.ROUND_END;
  state.log.push({ t: "round_end", r: state.round, reason, winner, eliminated });
  return state.roundEnd;
}

export function startNextRound(state, { topic, starter = null, reviewWords = [] }) {
  assert(state.phase === PHASE.ROUND_END, "round is not over");
  assert(!state.result, "game already ended");
  return startRound(state, { topic, starter, reviewWords });
}

export function finishGame(state, { placement, reason }) {
  if (state.result) return state.result;
  const human = state.players[HUMAN_ID];
  if (placement === 1) human.alive = true;
  const breakdown = scoreBreakdown({
    placement,
    catches: state.human.catches,
    bluffs: state.human.bluffs,
    survived: state.human.survived,
  });
  state.result = {
    placement,
    crystals: crystalsFor(placement),
    score: breakdown.total,
    breakdown,
    text: settlementText(placement),
    reason,
    rounds: state.round,
    catches: state.human.catches,
    bluffs: state.human.bluffs,
    survived: state.human.survived,
    revealedCards: state.human.revealedCards,
    correctAnswers: state.human.correctAnswers,
    wrongAnswers: state.human.wrongAnswers,
  };
  state.phase = PHASE.GAME_END;
  state.log.push({ t: "game_end", placement, score: breakdown.total, reason });
  return state.result;
}

export function quitGame(state) {
  if (state.result) return state.result;
  state.result = {
    placement: null,
    crystals: 0,
    score: null,
    breakdown: null,
    text: settlementText(null),
    reason: "quit",
    rounds: state.round,
    catches: state.human.catches,
    bluffs: state.human.bluffs,
    survived: state.human.survived,
    revealedCards: state.human.revealedCards,
    correctAnswers: state.human.correctAnswers,
    wrongAnswers: state.human.wrongAnswers,
  };
  state.phase = PHASE.GAME_END;
  state.log.push({ t: "quit" });
  return state.result;
}

export function chainTotal(state) {
  return state.chain.reduce((sum, segment) => sum + segment.claimed, 0);
}

export function publicState(state) {
  const human = state.players[HUMAN_ID];
  return {
    phase: state.phase,
    round: state.round,
    starter: state.starter ?? null,
    seed: state.seed,
    difficulty: state.difficulty,
    band: state.band,
    topic: state.topic
      ? {
        id: state.topic.id,
        type: state.topic.type,
        prompt: state.topic.prompt,
        promptTokens: state.topic.promptTokens || [],
        level: state.topic.level,
        k: K,
      }
      : null,
    players: state.players.map((player) => ({
      id: player.id,
      alive: player.alive,
      hit: player.hit,
      pulls: player.pulls,
      pullsText: `${player.pulls}/6`,
      handCount: player.hand.length,
      isHuman: player.isHuman,
      mask: player.mask,
      hand: player.isHuman ? player.hand : undefined,
    })),
    currentPlayer: state.currentPlayer,
    chain: state.chain.map((segment) => ({
      id: segment.id,
      player: segment.player,
      claimed: segment.claimed,
      count: segment.cards.length,
      challenged: segment.challenged,
      resolved: segment.resolved,
    })),
    x: chainTotal(state),
    discardCount: state.discard.length,
    pendingChallenge: state.pendingChallenge
      ? {
        targetId: state.pendingChallenge.targetId,
        challengerId: state.pendingChallenge.challengerId,
        cards: state.pendingChallenge.segment.cards.map((card) => ({
          id: card.id,
          w: card.w,
          ipa: card.ipa,
          joker: card.joker,
          truth: state.pendingChallenge.resolved ? card.truth : undefined,
        })),
        answerers: state.pendingChallenge.answerers,
        humanAnswers: state.pendingChallenge.answerers.includes(HUMAN_ID)
          ? state.pendingChallenge.answerCards.map((card) => ({
            id: card.id,
            w: card.w,
            ipa: card.ipa,
          }))
          : [],
        resolved: Boolean(state.pendingChallenge.resolved),
        isLie: state.pendingChallenge.isLie,
        penalized: state.pendingChallenge.penalized,
        results: state.pendingChallenge.results,
      }
      : null,
    pendingPenalty: state.pendingPenalty,
    roulette: state.pendingRoulette,
    roundEnd: state.roundEnd,
    result: state.result,
    humanCardCount: human.hand.length,
    log: state.log,
  };
}

export function getAIView(state, seat) {
  const self = state.players[seat];
  const currentRoundSegments = state.roundSegments.filter((s) => s.player === seat);
  return {
    seat,
    round: state.round,
    difficulty: state.difficulty,
    topic: state.topic
      ? {
        id: state.topic.id,
        type: state.topic.type,
        prompt: state.topic.prompt,
        k: K,
      }
      : null,
    self: {
      hand: self.hand.map((card) => ({
        id: card.id,
        w: card.w,
        ipa: card.ipa,
        joker: card.joker,
      })),
      pulls: self.pulls,
      alive: self.alive,
    },
    players: state.players.map((player) => ({
      id: player.id,
      alive: player.alive,
      handCount: player.hand.length,
      pulls: player.pulls,
      isHuman: player.isHuman,
    })),
    chain: state.chain.map((segment) => ({
      player: segment.player,
      claimed: segment.claimed,
      count: segment.cards.length,
      challenged: segment.challenged,
    })),
    ownSegments: currentRoundSegments.map((segment) => ({
      cards: segment.cards.map((card) => ({
        w: card.w,
        truth: card.joker ? true : card.truth,
        joker: card.joker,
      })),
      challenged: segment.challenged,
      resolved: segment.resolved,
      isLie: segment.isLie,
    })),
    revealed: state.revealed
      .filter((card) => card.round === state.round)
      .map((card) => ({
        w: card.w,
        truth: card.truth,
        joker: card.joker,
      })),
    x: chainTotal(state),
    currentPlayer: state.currentPlayer,
    discardCount: state.discard.length,
    aliveCount: alivePlayers(state).length,
  };
}
