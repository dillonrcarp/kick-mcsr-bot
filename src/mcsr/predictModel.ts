import type { PlayerFeatureStats } from './predictFeatures.js';

export interface PredictModelCalibration {
  a: number;
  b: number;
}

export interface PredictModelArtifact {
  version: number;
  createdAt: string;
  features: string[];
  intercept: number;
  weights: Record<string, number>;
  calibration?: PredictModelCalibration | null;
  training?: {
    sampleCount: number;
    trainCount: number;
    testCount: number;
    heuristic: {
      testBrier: number;
      testLogLoss: number;
    };
    trained: {
      testBrier: number;
      testLogLoss: number;
    };
  };
}

export interface FeatureDeltaVector {
  winrate_delta: number;
  recency_winrate_delta: number;
  avg_elo_delta: number;
  avg_opponent_elo_delta: number;
  current_streak_delta: number;
  best_streak_delta: number;
  sample_log_ratio: number;
}

export type FeatureName = keyof FeatureDeltaVector;

export function featureNames(): FeatureName[] {
  return [
    'winrate_delta',
    'recency_winrate_delta',
    'avg_elo_delta',
    'avg_opponent_elo_delta',
    'current_streak_delta',
    'best_streak_delta',
    'sample_log_ratio',
  ];
}

export function buildFeatureDeltaVector(
  playerA: PlayerFeatureStats,
  playerB: PlayerFeatureStats,
): FeatureDeltaVector {
  const winA = safeWinRate(playerA);
  const winB = safeWinRate(playerB);
  const recA = safeRecencyWinRate(playerA);
  const recB = safeRecencyWinRate(playerB);
  const avgEloDeltaA = safeAvgEloDelta(playerA);
  const avgEloDeltaB = safeAvgEloDelta(playerB);
  const avgOpponentEloA = playerA.avgOpponentElo ?? 1500;
  const avgOpponentEloB = playerB.avgOpponentElo ?? 1500;
  const currentStreakA = playerA.streak?.current ?? 0;
  const currentStreakB = playerB.streak?.current ?? 0;
  const bestStreakA = playerA.streak?.best ?? 0;
  const bestStreakB = playerB.streak?.best ?? 0;
  const sampleA = Math.max(1, playerA.sample || 1);
  const sampleB = Math.max(1, playerB.sample || 1);

  return {
    winrate_delta: winA - winB,
    recency_winrate_delta: recA - recB,
    avg_elo_delta: (avgEloDeltaA - avgEloDeltaB) / 20,
    avg_opponent_elo_delta: (avgOpponentEloA - avgOpponentEloB) / 400,
    current_streak_delta: (currentStreakA - currentStreakB) / 8,
    best_streak_delta: (bestStreakA - bestStreakB) / 12,
    sample_log_ratio: Math.log(sampleA / sampleB),
  };
}

export function scoreModelProbabilityA(
  model: PredictModelArtifact,
  playerA: PlayerFeatureStats,
  playerB: PlayerFeatureStats,
): number {
  const features = buildFeatureDeltaVector(playerA, playerB);
  let score = Number.isFinite(model.intercept) ? model.intercept : 0;

  for (const feature of model.features) {
    const weight = model.weights?.[feature];
    const value = getFeatureValue(features, feature);
    if (!Number.isFinite(weight) || !Number.isFinite(value)) continue;
    score += Number(weight) * Number(value);
  }

  let probability = sigmoid(score);
  if (model.calibration && Number.isFinite(model.calibration.a) && Number.isFinite(model.calibration.b)) {
    const logit = safeLogit(probability);
    probability = sigmoid(model.calibration.a * logit + model.calibration.b);
  }

  return clamp(probability, 1e-6, 1 - 1e-6);
}

function safeWinRate(player: PlayerFeatureStats): number {
  return clamp(player.winRate ?? 0.5, 0, 1);
}

function safeRecencyWinRate(player: PlayerFeatureStats): number {
  return clamp(player.recencyWinRate ?? player.winRate ?? 0.5, 0, 1);
}

function safeAvgEloDelta(player: PlayerFeatureStats): number {
  if (Number.isFinite(player.avgEloDelta)) return Number(player.avgEloDelta);
  if (player.sample > 0 && Number.isFinite(player.totalEloDelta)) {
    return Number(player.totalEloDelta) / player.sample;
  }
  return 0;
}

function getFeatureValue(vector: FeatureDeltaVector, feature: string): number | undefined {
  if (!isFeatureName(feature)) return undefined;
  return vector[feature];
}

function isFeatureName(value: string): value is FeatureName {
  return (featureNames() as string[]).includes(value);
}

function safeLogit(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
