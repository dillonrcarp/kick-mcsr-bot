import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PredictCommand } from './predictCommand.js';
import type { PlayerFeatureStats } from '../../mcsr/predictFeatures.js';
import type { PredictionOutcome } from '../../mcsr/predictScore.js';
import type { ChatCommandContext } from './commandRegistry.js';

function makeFeatures(player: string): PlayerFeatureStats {
  return {
    player,
    sample: 8,
    wins: 5,
    losses: 3,
    winRate: 0.625,
    recencyWinRate: 0.7,
    totalEloDelta: 40,
    avgEloDelta: 5,
    avgOpponentElo: 1550,
    streak: { current: 3, best: 4 },
    newestMatchAt: 1_700_000_000_000,
    oldestMatchAt: 1_699_999_000_000,
  };
}

describe('PredictCommand', () => {
  it('formats prediction output using injected deps', async () => {
    const features: Record<string, PlayerFeatureStats> = {
      Alpha: makeFeatures('Alpha'),
      Beta: makeFeatures('Beta'),
    };
    features.Beta.recencyWinRate = 0.4;

    const replies: string[] = [];
    const command = new PredictCommand({
      fetchMatches: async () => [],
      computeFeatures: (_matches, player) => features[player] ?? null,
      predict: ({ playerA, playerB }) =>
        ({
          winner: 'A',
          probability: 0.62,
          probabilityA: 0.62,
          probabilityB: 0.38,
          confidence: 0.7,
          factors: ['Recency winrate 70.0% vs 40.0%'],
        }) as PredictionOutcome,
      now: () => 1_700_000_000_000,
    });

    const ctx: ChatCommandContext = {
      channel: 'chan',
      username: 'sender',
      message: '+predict Alpha Beta 5',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, ['Alpha', 'Beta', '5']);

    assert.equal(replies.length, 1);
    const response = replies[0];
    assert.ok(response.includes('Predicted: Alpha'));
    assert.ok(response.includes('~62.0%'));
    assert.ok(response.includes('confidence 70%'));
    assert.ok(response.includes('Sample: Alpha 8 vs Beta 8'));
  });

  it('rejects when missing players', async () => {
    const replies: string[] = [];
    const command = new PredictCommand({
      fetchMatches: async () => [],
      computeFeatures: () => null,
      predict: () => null as any,
      now: () => Date.now(),
    });

    const ctx: ChatCommandContext = {
      channel: 'chan',
      username: 'sender',
      message: '+predict',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, []);
    assert.equal(replies.length, 1);
    assert.ok(replies[0].toLowerCase().includes('usage'));
  });

  it('fills playerA from channel when only one opponent is provided', async () => {
    const features: Record<string, PlayerFeatureStats> = {
      chan: makeFeatures('chan'),
      Opp: makeFeatures('Opp'),
    };
    const replies: string[] = [];
    const command = new PredictCommand({
      fetchMatches: async () => [],
      computeFeatures: (_matches, player) => features[player] ?? null,
      predict: () =>
        ({
          winner: 'A',
          probability: 0.55,
          probabilityA: 0.55,
          probabilityB: 0.45,
          confidence: 0.6,
          factors: [],
        }) as PredictionOutcome,
      now: () => 1_700_000_000_000,
    });

    const ctx: ChatCommandContext = {
      channel: 'chan',
      username: 'sender',
      message: '+predict Opp',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, ['Opp']);

    assert.equal(replies.length, 1);
    const response = replies[0];
    assert.ok(response.includes('chan'));
    assert.ok(response.includes('Opp'));
  });
});
