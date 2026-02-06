import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildStatsMessage } from './eloCommand.js';

describe('buildStatsMessage', () => {
  it('includes longest win streak when available', () => {
    const message = buildStatsMessage(
      {
        nickname: 'Runner',
        eloRate: 1500,
        eloRank: 30,
        statistics: {
          season: {
            wins: { ranked: 10 },
            loses: { ranked: 5 },
            highestWinStreak: { ranked: 6 },
          },
        },
      },
      'Runner',
    );

    assert.ok(message.includes('Longest Streak 6W'));
  });
});
