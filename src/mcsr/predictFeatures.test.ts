import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computePlayerFeatures } from './predictFeatures.js';

function makeMatch(params: {
  id: number;
  winner: 'A' | 'B' | null;
  playedAt: number;
  durationMs?: number;
  deltaA?: number;
  deltaB?: number;
  eloA?: number;
  eloB?: number;
}): any {
  const playerAUuid = `pa-${params.id}`;
  const playerBUuid = `pb-${params.id}`;
  const winnerUuid = params.winner === 'A' ? playerAUuid : params.winner === 'B' ? playerBUuid : undefined;
  return {
    id: params.id,
    players: [
      { uuid: playerAUuid, nickname: 'Alpha', eloRate: params.eloA },
      { uuid: playerBUuid, nickname: 'Beta', eloRate: params.eloB },
    ],
    result: winnerUuid ? { uuid: winnerUuid, time: params.durationMs } : undefined,
    changes: [
      { uuid: playerAUuid, change: params.deltaA },
      { uuid: playerBUuid, change: params.deltaB },
    ],
    timestamp: params.playedAt,
  };
}

describe('computePlayerFeatures', () => {
  it('computes aggregates, streaks, and averages from matches', () => {
    const now = 1_700_000_000_000;
    const matches = [
      makeMatch({ id: 1, winner: 'A', playedAt: now, durationMs: 600_000, deltaA: 12, deltaB: -12, eloA: 1500, eloB: 1550 }),
      makeMatch({ id: 2, winner: 'A', playedAt: now - 10_000, durationMs: 620_000, deltaA: 8, deltaB: -8, eloA: 1520, eloB: 1500 }),
      makeMatch({ id: 3, winner: 'B', playedAt: now - 20_000, durationMs: 700_000, deltaA: -15, deltaB: 15, eloA: 1490, eloB: 1600 }),
    ];

    const stats = computePlayerFeatures(matches, 'Alpha', { anchorMs: now })!;

    assert.equal(stats.sample, 3);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 1);
    assert.ok(Math.abs(stats.winRate - 2 / 3) < 1e-6);
    assert.equal(stats.totalEloDelta, 5);
    assert.ok(stats.avgEloDelta && Math.abs(stats.avgEloDelta - 5 / 3) < 1e-6);
    assert.equal(stats.avgOpponentElo, 1550);
    assert.equal(stats.durations?.bestWin, 600_000);
    assert.equal(stats.durations?.averageWin, 610_000);
    assert.equal(stats.streak.current, 2);
    assert.equal(stats.streak.best, 2);
    assert.equal(stats.newestMatchAt, now);
    assert.equal(stats.oldestMatchAt, now - 20_000);
  });

  it('computes recency-weighted win rate with decay', () => {
    const anchor = 2_000_000_000_000;
    const matches = [
      makeMatch({ id: 1, winner: 'A', playedAt: anchor, deltaA: 5, deltaB: -5 }),
      makeMatch({ id: 2, winner: 'B', playedAt: anchor - 1_000, deltaA: -5, deltaB: 5 }),
    ];

    const stats = computePlayerFeatures(matches, 'Alpha', { anchorMs: anchor, decayMs: 1_000 })!;

    // weight1 = 1, weight2 = 0.5 => weighted winrate = 1 / 1.5 = 0.666...
    assert.ok(stats.recencyWinRate !== undefined);
    assert.ok(Math.abs(stats.recencyWinRate - 2 / 3) < 1e-6);
    assert.equal(stats.streak.current, 1);
    assert.equal(stats.streak.best, 1);
  });

  it('infers win/loss from Elo delta when winner is missing', () => {
    const now = 3_000;
    const match = {
      id: 10,
      players: [
        { uuid: 'x', nickname: 'Alpha', eloRate: 1500 },
        { uuid: 'y', nickname: 'Beta', eloRate: 1500 },
      ],
      changes: [
        { uuid: 'x', change: -12 },
        { uuid: 'y', change: 12 },
      ],
      timestamp: now,
    };

    const stats = computePlayerFeatures([match], 'Alpha', { anchorMs: now });

    assert.ok(stats);
    assert.equal(stats?.wins, 0);
    assert.equal(stats?.losses, 1);
    assert.equal(stats?.winRate, 0);
  });

  it('respects the limit option when trimming matches', () => {
    const base = 5_000;
    const matches = [
      makeMatch({ id: 1, winner: 'A', playedAt: base, deltaA: 1, deltaB: -1 }),
      makeMatch({ id: 2, winner: 'B', playedAt: base - 1_000, deltaA: -2, deltaB: 2 }),
      makeMatch({ id: 3, winner: 'A', playedAt: base - 2_000, deltaA: 3, deltaB: -3 }),
    ];

    const stats = computePlayerFeatures(matches, 'Alpha', { anchorMs: base, limit: 2 })!;

    assert.equal(stats.sample, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 1);
  });
});
