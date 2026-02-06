import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildFeatureDeltaVector,
  featureNames,
  scoreModelProbabilityA,
  type PredictModelArtifact,
} from './predictModel.js';
import type { PlayerFeatureStats } from './predictFeatures.js';

function makeStats(overrides: Partial<PlayerFeatureStats> = {}): PlayerFeatureStats {
  return {
    player: overrides.player ?? 'player',
    sample: overrides.sample ?? 10,
    wins: overrides.wins ?? 6,
    losses: overrides.losses ?? 4,
    winRate: overrides.winRate ?? 0.6,
    recencyWinRate: overrides.recencyWinRate ?? 0.62,
    totalEloDelta: overrides.totalEloDelta ?? 30,
    avgEloDelta: overrides.avgEloDelta ?? 3,
    avgOpponentElo: overrides.avgOpponentElo ?? 1520,
    streak: overrides.streak ?? { current: 2, best: 4 },
    newestMatchAt: overrides.newestMatchAt,
    oldestMatchAt: overrides.oldestMatchAt,
    durations: overrides.durations,
  };
}

describe('predictModel', () => {
  it('builds deltas with expected directionality', () => {
    const a = makeStats({ winRate: 0.7, recencyWinRate: 0.72, avgEloDelta: 6, avgOpponentElo: 1600 });
    const b = makeStats({ player: 'b', winRate: 0.5, recencyWinRate: 0.52, avgEloDelta: 1, avgOpponentElo: 1500 });
    const vec = buildFeatureDeltaVector(a, b);

    assert.ok(vec.winrate_delta > 0);
    assert.ok(vec.recency_winrate_delta > 0);
    assert.ok(vec.avg_elo_delta > 0);
    assert.ok(vec.avg_opponent_elo_delta > 0);
  });

  it('scores probability in [0,1] and responds to stronger features', () => {
    const model: PredictModelArtifact = {
      version: 1,
      createdAt: new Date().toISOString(),
      features: featureNames().map((name) => String(name)),
      intercept: 0,
      weights: {
        winrate_delta: 2.0,
        recency_winrate_delta: 2.0,
        avg_elo_delta: 1.5,
        avg_opponent_elo_delta: 1.0,
        current_streak_delta: 0.5,
        best_streak_delta: 0.2,
        sample_log_ratio: 0.1,
      },
      calibration: null,
    };

    const strong = makeStats({ winRate: 0.72, recencyWinRate: 0.74, avgEloDelta: 7, avgOpponentElo: 1600 });
    const weak = makeStats({ player: 'weak', winRate: 0.48, recencyWinRate: 0.46, avgEloDelta: -3, avgOpponentElo: 1480 });

    const pStrong = scoreModelProbabilityA(model, strong, weak);
    const pWeak = scoreModelProbabilityA(model, weak, strong);

    assert.ok(pStrong > 0.5);
    assert.ok(pWeak < 0.5);
    assert.ok(pStrong > pWeak);
  });
});
