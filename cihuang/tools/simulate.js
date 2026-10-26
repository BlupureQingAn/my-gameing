import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AIPlayer } from "../src/core/ai.js";
import { MAX_PLAY, PLAYER_IDS } from "../src/core/constants.js";
import {
  challenge,
  createGame,
  getAIView,
  play,
  resolveChallenge,
  resolveRoulette,
  startNextRound,
} from "../src/core/engine.js";
import { createStreams } from "../src/core/rng.js";
import { TopicPicker } from "../src/core/topic.js";

function parseArgs(argv) {
  const out = {
    games: 1000,
    band: "hs",
    difficulty: "normal",
    dataDir: path.resolve("cihuang/data"),
    maxSteps: 2000,
    seed: "sim",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--games") out.games = Number(argv[++i]);
    else if (arg === "--band") out.band = argv[++i];
    else if (arg === "--difficulty") out.difficulty = argv[++i];
    else if (arg === "--data") out.dataDir = path.resolve(argv[++i]);
    else if (arg === "--max-steps") out.maxSteps = Number(argv[++i]);
    else if (arg === "--seed") out.seed = argv[++i];
  }
  return out;
}

function loadData({ dataDir, band }) {
  const bankDoc = JSON.parse(fs.readFileSync(path.join(dataDir, "banks", `${band}.json`), "utf8"));
  const topicDoc = JSON.parse(fs.readFileSync(path.join(dataDir, "topics", `${band}.json`), "utf8"));
  const list = bankDoc.items;
  const bankIndex = Array.isArray(list)
    ? Object.fromEntries(list.map((item) => [item.w, item]))
    : list;
  return { bankIndex, topics: topicDoc.topics };
}

function gameSeed(base, index) {
  return `${base}:${index}`;
}

export function simulateGame({ seed, difficulty, bankIndex, topics, maxSteps = 2000 }) {
  const picker = new TopicPicker({
    topics,
    difficulty,
    rng: createStreams(`${seed}:topics`).topics,
  });
  const topic = picker.initial();
  const state = createGame({ seed, difficulty, band: "sim", topic, bankIndex });
  const ais = PLAYER_IDS.map((seat) => new AIPlayer({
    seat,
    difficulty,
    seed,
    bankIndex,
    topic,
  }));
  let steps = 0;
  let challenges = 0;
  let fires = 0;

  while (state.phase !== "game_end") {
    steps += 1;
    if (steps > maxSteps) throw new Error(`step cap at game ${seed}`);
    if (state.phase === "turn") {
      const seat = state.currentPlayer;
      const view = getAIView(state, seat);
      const action = ais[seat].action(view);
      if (action.type === "challenge") {
        challenge(state, seat);
      } else {
        if (action.cardIds.length === 0 || action.cardIds.length > MAX_PLAY) {
          throw new Error(`illegal play ${action.cardIds.length} by ${seat} in ${seed}`);
        }
        play(state, seat, action.cardIds);
      }
    } else if (state.phase === "challenge") {
      const pending = state.pendingChallenge;
      const answers = {};
      for (const id of pending.answerers) {
        if (!state.players[id].alive) continue;
        Object.assign(answers, ais[id].answerCards(pending.answerCards));
      }
      const result = resolveChallenge(state, answers);
      challenges += 1;
      for (const ai of ais) {
        ai.noteChallengeResult({ targetId: pending.targetId, isLie: result.isLie });
      }
    } else if (state.phase === "roulette") {
      const shot = resolveRoulette(state);
      if (shot.fire) fires += 1;
    } else if (state.phase === "round_end") {
      const starter = state.roundEnd.nextStarter ?? Math.max(0, PLAYER_IDS.length - 1);
      const chosen = picker.pickRandom(picker.candidates(3));
      picker.markUsed(chosen);
      for (const ai of ais) ai.setTopic(chosen);
      startNextRound(state, { topic: chosen, starter });
    } else {
      throw new Error(`unexpected phase ${state.phase}`);
    }
  }

  return {
    steps,
    rounds: state.round,
    placement: state.result.placement,
    reason: state.result.reason,
    challenges,
    fires,
    survived: state.human.survived,
    bluffs: state.human.bluffs,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const { bankIndex, topics } = loadData(args);
  const tally = { games: 0, steps: 0, rounds: 0, challenges: 0, fires: 0 };
  const placements = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const reasons = {};
  const started = Date.now();
  let maxSteps = 0;
  let maxRounds = 0;

  for (let i = 0; i < args.games; i += 1) {
    const result = simulateGame({
      seed: gameSeed(args.seed, i),
      difficulty: args.difficulty,
      bankIndex,
      topics,
      maxSteps: args.maxSteps,
    });
    tally.games += 1;
    tally.steps += result.steps;
    tally.rounds += result.rounds;
    tally.challenges += result.challenges;
    tally.fires += result.fires;
    placements[result.placement] += 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    maxSteps = Math.max(maxSteps, result.steps);
    maxRounds = Math.max(maxRounds, result.rounds);
  }

  const elapsed = (Date.now() - started) / 1000;
  const avg = (value) => Math.round((value / tally.games) * 100) / 100;
  console.log(JSON.stringify({
    band: args.band,
    difficulty: args.difficulty,
    games: tally.games,
    avgSteps: avg(tally.steps),
    avgRounds: avg(tally.rounds),
    avgChallenges: avg(tally.challenges),
    avgFires: avg(tally.fires),
    maxSteps,
    maxRounds,
    placements,
    reasons,
    seconds: Math.round(elapsed * 10) / 10,
    gamesPerSecond: Math.round((tally.games / elapsed) * 10) / 10,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
