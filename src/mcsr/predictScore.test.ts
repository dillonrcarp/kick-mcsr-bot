import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { predictOutcome } from './predictScore.js';
import type { PlayerFeatureStats } from './predictFeatures.js';

function makeStats(overrides: Partial<PlayerFeatureStats> = {}): PlayerFeatureStats {
  return {
    player: overrides.player ?? 'Player',
    sample: overrides.sample ?? 10,
    wins: overrides.wins ?? 6,
    losses: overrides.losses ?? 4,
    winRate: overrides.winRate ?? 0.6,
    recencyWinRate: overrides.recencyWinRate ?? 0.6,
    totalEloDelta: overrides.totalEloDelta ?? 30,
    avgEloDelta: overrides.avgEloDelta ?? 3,
    avgOpponentElo: overrides.avgOpponentElo ?? 1520,
    durations: overrides.durations,
    streak: overrides.streak ?? { current: 2, best: 3 },
    newestMatchAt: overrides.newestMatchAt ?? 1_700_000_000_000,
    oldestMatchAt: overrides.oldestMatchAt ?? 1_699_900_000_000,
  };
}

describe('predictOutcome', () => {
  it('favors the stronger form and produces >50% probability', () => {
    const a = makeStats({ recencyWinRate: 0.75, avgOpponentElo: 1600, streak: { current: 4, best: 5 } });
    const b = makeStats({ player: 'B', recencyWinRate: 0.45, avgOpponentElo: 1500, streak: { current: 1, best: 2 } });

    const result = predictOutcome({ playerA: a, playerB: b, anchorMs: a.newestMatchAt })!;

    assert.ok(result);
    assert.equal(result.winner, 'A');
    assert.ok(result.probability > 0.55);
    assert.ok(result.probabilityA > result.probabilityB);
  });

  it('scales confidence down with small samples and stale data', () => {
    const anchor = 2_000_000_000_000;
    const stale = makeStats({
      player: 'stale',
      sample: 2,
      wins: 1,
      losses: 1,
      winRate: 0.5,
      recencyWinRate: 0.5,
      newestMatchAt: anchor - 20 * 24 * 60 * 60 * 1000, // 20 days ago
      oldestMatchAt: anchor - 20 * 24 * 60 * 60 * 1000,
    });
    const fresh = makeStats({ player: 'fresh', sample: 12, newestMatchAt: anchor, oldestMatchAt: anchor - 1000 });

    const result = predictOutcome({ playerA: stale, playerB: fresh, anchorMs: anchor, targetSample: 10 })!;

    assert.ok(result.confidence < 0.6, 'confidence should be reduced for stale/small samples');
  });

  it('returns null when inputs are missing', () => {
    // @ts-expect-error testing missing input
    const result = predictOutcome({ playerA: null, playerB: makeStats() });
    assert.equal(result, null);
  });
});
