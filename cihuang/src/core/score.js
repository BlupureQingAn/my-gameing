import {
  PLACEMENT_CRYSTALS,
  PLACEMENT_POINTS,
  SCORE_BLUFF,
  SCORE_CATCH,
  SCORE_SURVIVE,
} from "./constants.js";

export function placementFor(aliveCount) {
  return Math.min(4, Math.max(1, aliveCount));
}

export function crystalsFor(placement) {
  return PLACEMENT_CRYSTALS[placement] || 0;
}

export function scoreBreakdown({ placement, catches = 0, bluffs = 0, survived = 0 }) {
  const placementPoints = placement ? PLACEMENT_POINTS[placement] : 0;
  return {
    placement,
    placementPoints,
    catches,
    catchPoints: catches * SCORE_CATCH,
    bluffs,
    bluffPoints: bluffs * SCORE_BLUFF,
    survived,
    survivePoints: survived * SCORE_SURVIVE,
    total:
      placementPoints +
      catches * SCORE_CATCH +
      bluffs * SCORE_BLUFF +
      survived * SCORE_SURVIVE,
  };
}

export function settlementText(placement) {
  const lines = {
    1: "最后一把椅子是你的。酒保把账本合上了。",
    2: "离活着离开只差一枪。也算没白来。",
    3: "牌桌记得你，大概。下次坐稳一点。",
    4: "第一枪就送客，酒保连杯子都没擦。",
  };
  return lines[placement] || "这一局没有记在账上。";
}
