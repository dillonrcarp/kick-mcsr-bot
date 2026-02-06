import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractPlayerWinStreaks } from './api.js';

describe('extractPlayerWinStreaks', () => {
  it('prefers season streak values over total values', () => {
    const streaks = extractPlayerWinStreaks({
      statistics: {
        season: {
          highestWinStreak: { ranked: 4 },
          currentWinStreak: { ranked: 2 },
        },
        total: {
          highestWinStreak: { ranked: 9 },
          currentWinStreak: { ranked: 6 },
        },
      },
    });

    assert.equal(streaks.longest, 4);
    assert.equal(streaks.current, 2);
  });

  it('falls back to achievements when statistics are unavailable', () => {
    const streaks = extractPlayerWinStreaks({
      achievements: {
        total: [
          { id: 'highestWinStreak', value: '12' },
          { id: 'currentWinStreak', value: 3 },
        ],
      },
    });

    assert.equal(streaks.longest, 12);
    assert.equal(streaks.current, 3);
  });

  it('supports alternate streak field names', () => {
    const streaks = extractPlayerWinStreaks({
      statistics: {
        season: {
          longestWinStreak: 7,
          currentStreak: 1,
        },
      },
    });

    assert.equal(streaks.longest, 7);
    assert.equal(streaks.current, 1);
  });
});
