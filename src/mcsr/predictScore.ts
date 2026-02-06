import type { PlayerFeatureStats } from './predictFeatures.js';
import { scoreModelProbabilityA } from './predictModel.js';
import { getPredictModel } from './predictModelStore.js';

export interface PredictionInput {
  playerA: PlayerFeatureStats;
  playerB: PlayerFeatureStats;
  targetSample?: number;
  anchorMs?: number;
}

export interface PredictionOutcome {
  winner: 'A' | 'B';
  probability: number; // probability for winner
  confidence: number; // 0-1
  factors: string[];
  probabilityA: number;
  probabilityB: number;
}

const DEFAULT_TARGET_SAMPLE = 10;
const DEFAULT_ANCHOR_MS = () => Date.now();

export function predictOutcome(input: PredictionInput): PredictionOutcome | null {
  const model = getPredictModel();
  if (model) {
    return predictOutcomeWithProbability(input, (playerA, playerB) =>
      scoreModelProbabilityA(model, playerA, playerB),
    );
  }
  return predictOutcomeHeuristic(input);
}

export function predictOutcomeHeuristic(input: PredictionInput): PredictionOutcome | null {
  return predictOutcomeWithProbability(input, (playerA, playerB) => {
    const scoreA = computeFormScore(playerA);
    const scoreB = computeFormScore(playerB);
    const delta = scoreA - scoreB;
    return clamp(probFromDelta(delta), 0.05, 0.95);
  });
}

function predictOutcomeWithProbability(
  input: PredictionInput,
  probabilityForA: (playerA: PlayerFeatureStats, playerB: PlayerFeatureStats) => number,
): PredictionOutcome | null {
  const targetSample = Math.max(1, input.targetSample ?? DEFAULT_TARGET_SAMPLE);
  const anchor = input.anchorMs ?? DEFAULT_ANCHOR_MS();
  const { playerA, playerB } = input;
  if (!playerA || !playerB) return null;

  const probabilityA = clamp(probabilityForA(playerA, playerB), 0.05, 0.95);
  const probabilityB = 1 - probabilityA;
  const winner = probabilityA >= 0.5 ? 'A' : 'B';
  const probability = winner === 'A' ? probabilityA : probabilityB;

  const confidence = computeConfidence(playerA, playerB, targetSample, anchor);
  const factors = deriveFactors(playerA, playerB);

  return {
    winner,
    probability,
    confidence,
    factors,
    probabilityA,
    probabilityB,
  };
}

function computeFormScore(player: PlayerFeatureStats): number {
  const winRate = clamp(
    player.recencyWinRate !== undefined ? player.recencyWinRate : player.winRate,
    0,
    1,
  );
  const winComponent = (winRate - 0.5) * 1.1; // -0.55..0.55

  const avgOpponentElo = player.avgOpponentElo ?? 1500;
  const oppComponent = clamp((avgOpponentElo - 1500) / 400, -1, 1) * 0.5;

  const avgEloDelta =
    player.avgEloDelta !== undefined
      ? player.avgEloDelta
      : player.sample > 0
        ? player.totalEloDelta / player.sample
        : 0;
  const eloComponent = clamp(avgEloDelta / 15, -1, 1) * 0.5;

  const streakComponent = clamp(player.streak.current / 6, 0, 1) * 0.3;

  return winComponent + oppComponent + eloComponent + streakComponent;
}

function computeConfidence(
  a: PlayerFeatureStats,
  b: PlayerFeatureStats,
  targetSample: number,
  anchorMs: number,
): number {
  const minSample = Math.min(a.sample, b.sample);
  const sampleFactor = clamp(minSample / targetSample, 0, 1);

  const oldest = Math.min(a.oldestMatchAt ?? anchorMs, b.oldestMatchAt ?? anchorMs);
  const ageMs = Math.max(0, anchorMs - oldest);
  const recencyFactor = computeRecencyFactor(ageMs);

  const winRateGap = Math.abs(
    (a.recencyWinRate ?? a.winRate) - (b.recencyWinRate ?? b.winRate),
  );
  const varianceFactor = 0.6 + 0.4 * clamp(winRateGap * 2, 0, 1); // 0.6..1

  const blended = sampleFactor * recencyFactor * varianceFactor;
  return clamp(0.35 + blended * 0.65, 0.1, 0.95);
}

function computeRecencyFactor(ageMs: number): number {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const scaled = 1 - ageMs / (sevenDaysMs * 2); // half confidence after ~14d
  return clamp(scaled, 0.35, 1);
}

function probFromDelta(delta: number): number {
  const k = 1.2;
  return 1 / (1 + Math.exp(-k * delta));
}

function deriveFactors(a: PlayerFeatureStats, b: PlayerFeatureStats): string[] {
  const factors: string[] = [];

  const winA = a.recencyWinRate ?? a.winRate;
  const winB = b.recencyWinRate ?? b.winRate;
  if (Math.abs(winA - winB) >= 0.05) {
    factors.push(
      `Recency winrate ${formatPercent(winA)} vs ${formatPercent(winB)}`,
    );
  }

  if (a.avgOpponentElo !== undefined && b.avgOpponentElo !== undefined) {
    const diff = a.avgOpponentElo - b.avgOpponentElo;
    if (Math.abs(diff) >= 30) {
      factors.push(
        diff > 0
          ? `Faced tougher opponents (${Math.round(a.avgOpponentElo)} vs ${Math.round(b.avgOpponentElo)})`
          : `Faced tougher opponents (${Math.round(b.avgOpponentElo)} vs ${Math.round(a.avgOpponentElo)})`,
      );
    }
  }

  const eloA = a.avgEloDelta ?? (a.sample ? a.totalEloDelta / a.sample : undefined);
  const eloB = b.avgEloDelta ?? (b.sample ? b.totalEloDelta / b.sample : undefined);
  if (eloA !== undefined && eloB !== undefined && Math.abs(eloA - eloB) >= 5) {
    factors.push(
      eloA > eloB
        ? `Momentum: +${eloA.toFixed(1)} ΔElo vs ${eloB.toFixed(1)}`
        : `Momentum: +${eloB.toFixed(1)} ΔElo vs ${eloA.toFixed(1)}`,
    );
  }

  if (a.streak.current > b.streak.current + 1) {
    factors.push(`Streak: ${a.streak.current}W`);
  } else if (b.streak.current > a.streak.current + 1) {
    factors.push(`Streak: ${b.streak.current}W`);
  }

  return factors.slice(0, 4);
}

function formatPercent(value: number): string {
  return `${(clamp(value, 0, 1) * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
