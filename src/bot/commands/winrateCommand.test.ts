import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WinrateCommand } from './winrateCommand.js';
import type { ChatCommandContext } from './commandRegistry.js';

describe('WinrateCommand', () => {
  it('includes longest win streak when provided by record data', async () => {
    const replies: string[] = [];
    const command = new WinrateCommand({
      getRecord: async () => ({
        displayName: 'Runner',
        wins: 14,
        losses: 6,
        matches: 20,
        ffr: 5,
        longestWinStreak: 7,
      }),
    });

    const ctx: ChatCommandContext = {
      channel: 'owner',
      username: 'sender',
      message: '+winrate Runner',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, ['Runner']);

    assert.equal(replies.length, 1);
    assert.ok(replies[0].includes('Longest Streak 7W'));
  });
});
