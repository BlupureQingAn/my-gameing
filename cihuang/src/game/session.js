import {
  createGame,
  startNextRound,
  play,
  challenge,
  resolveChallenge,
  resolveRoulette,
  quitGame,
  publicState,
  getAIView,
  chainTotal,
} from "../core/engine.js";
import { AIPlayer } from "../core/ai.js";
import { TopicPicker } from "../core/topic.js";
import { createStreams } from "../core/rng.js";
import { HUMAN_ID, MAX_PLAY, PHASE } from "../core/constants.js";

export function buildBankIndex(rows, extraItems = []) {
  const index = {};
  for (const row of rows || []) {
    const [w, ipa, pos, zh, def, freq] = row;
    index[w] = { w, ipa, pos: pos ? String(pos).split(",").filter(Boolean) : [], zh, def, freq: Number(freq) || 0 };
  }
  for (const item of extraItems) {
    if (item && item.w) index[item.w] = { ...index[item.w], ...item };
  }
  return index;
}

export class GameSession {
  constructor({ data, band, difficulty, seed, reviewWords = [], extraItems = [] }) {
    this.band = band;
    this.difficulty = difficulty;
    this.seed = String(seed || `local-${Date.now()}`);
    this.bankIndex = buildBankIndex(data.words, extraItems);
    this.picker = new TopicPicker({
      topics: data.topics,
      difficulty,
      rng: createStreams(this.seed).topics,
    });
    const topic = this.picker.initial();
    this.ais = [1, 2, 3].map((seat) => new AIPlayer({
      seat,
      difficulty,
      seed: this.seed,
      bankIndex: this.bankIndex,
      topic,
    }));
    this.state = createGame({
      seed: this.seed,
      difficulty,
      band,
      topic,
      bankIndex: this.bankIndex,
      reviewWords,
    });
    this.reviewWords = reviewWords;
  }

  view() {
    return publicState(this.state);
  }

  get phase() {
    return this.state.phase;
  }

  get over() {
    return !!this.state.result;
  }

  get result() {
    return this.state.result;
  }

  humanCards() {
    return this.state.players[HUMAN_ID].hand.slice();
  }

  humanTurn() {
    return this.state.phase === PHASE.TURN
      && this.state.currentPlayer === HUMAN_ID
      && !this.state.result;
  }

  requireHumanTurn() {
    if (!this.humanTurn()) throw new Error("还没轮到你");
  }

  playHuman(cardIds) {
    this.requireHumanTurn();
    if (!Array.isArray(cardIds) || !cardIds.length || cardIds.length > MAX_PLAY) {
      throw new Error(`请选择 1-${MAX_PLAY} 张牌`);
    }
    return play(this.state, HUMAN_ID, cardIds);
  }

  challengeHuman() {
    this.requireHumanTurn();
    const view = this.view();
    const chain = view.chain;
    if (!chain.length) throw new Error("当前没有可质疑的出牌");
    const last = chain[chain.length - 1];
    if (last.player === HUMAN_ID) throw new Error("不能质疑自己");
    const target = view.players[last.player];
    if (!target || !target.alive) throw new Error("对方已出局");
    return challenge(this.state, HUMAN_ID);
  }

  // AI 决策并执行；返回本次动作，供 UI 播放动画
  aiAct() {
    const playerId = this.state.currentPlayer;
    if (playerId == null || playerId === HUMAN_ID || this.state.result) return null;
    const ai = this.ais[playerId - 1];
    const view = getAIView(this.state, playerId);
    const action = ai.action(view);
    if (action.type === "challenge") {
      challenge(this.state, playerId);
      return { playerId, type: "challenge" };
    }
    const result = play(this.state, playerId, action.cardIds);
    return {
      playerId,
      type: "play",
      cardIds: action.cardIds,
      words: result.segment.cards.map((card) => card.w),
      emptied: result.emptied,
    };
  }

  pendingAnswerCards() {
    const pending = this.view().pendingChallenge;
    if (!pending) return [];
    return pending.humanAnswers || [];
  }

  humanMustAnswer() {
    const pending = this.view().pendingChallenge;
    if (!pending || pending.resolved) return false;
    if (!pending.answerers.includes(HUMAN_ID)) return false;
    return pending.humanAnswers.length > 0;
  }

  // answers: { cardId: true|false }；未作答的卡按错处理
  resolveAnswers(humanAnswers = {}) {
    const pending = this.state.pendingChallenge;
    if (!pending) throw new Error("没有待判定的质疑");
    const answers = {};
    for (const answererId of pending.answerers) {
      if (answererId === HUMAN_ID) {
        answers[HUMAN_ID] = {};
        for (const card of pending.answerCards) {
          const value = humanAnswers[card.id];
          if (value === true || value === false) answers[HUMAN_ID][card.id] = value;
        }
      } else {
        answers[answererId] = this.ais[answererId - 1].answerCards(pending.answerCards);
      }
    }
    const outcome = resolveChallenge(this.state, answers);
    // AI 记住“这名玩家上一次出牌是否说谎”
    const segmentPlayer = pending.segment.player;
    for (const ai of this.ais) {
      if (segmentPlayer !== ai.seat) {
        ai.noteChallengeResult({ targetId: segmentPlayer, isLie: outcome.isLie });
      }
    }
    return outcome;
  }

  spinRoulette() {
    return resolveRoulette(this.state);
  }

  // 新一轮：系统随机主题，上一轮受罚者先手（受罚者出局时由质疑对局另一方先手）。
  beginRandomNextRound() {
    const end = this.state.roundEnd;
    if (!end) return null;
    const topic = this.picker.pickRandom(this.picker.candidates(3));
    if (!topic) return null;
    this.beginNextRound(topic, end.nextStarter);
    return { topic, starter: end.nextStarter };
  }

  beginNextRound(topic, starter) {
    this.picker.markUsed(topic);
    for (const ai of this.ais) ai.setTopic(topic);
    startNextRound(this.state, {
      topic,
      starter,
      reviewWords: this.reviewWords,
    });
  }

  chainTotal() {
    return chainTotal(this.state);
  }

  quit() {
    return quitGame(this.state);
  }

  serverPayload(runId) {
    const state = this.state;
    const result = state.result;
    return {
      run_id: runId,
      log: state.log,
      placement: result?.placement,
      catches: state.human.catches,
      bluffs: state.human.bluffs,
      survived: state.human.survived,
      score: result?.score,
    };
  }
}
