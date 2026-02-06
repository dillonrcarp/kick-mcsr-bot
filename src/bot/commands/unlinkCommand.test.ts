import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UnlinkCommand } from './unlinkCommand.js';
import type { ChatCommandContext } from './commandRegistry.js';

describe('UnlinkCommand', () => {
  it('removes only the sender link when no args are provided', async () => {
    const removed: string[] = [];
    const replies: string[] = [];
    const command = new UnlinkCommand({
      removeLinkedMcName: (kickName: string) => {
        removed.push(kickName);
      },
    });

    const ctx: ChatCommandContext = {
      channel: 'owner',
      username: 'sender',
      message: '+unlink',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, []);

    assert.deepEqual(removed, ['sender']);
    assert.equal(replies[0], 'Removed linked Minecraft user for sender.');
  });

  it('rejects username args to enforce self-only unlinking', async () => {
    const removed: string[] = [];
    const replies: string[] = [];
    const command = new UnlinkCommand({
      removeLinkedMcName: (kickName: string) => {
        removed.push(kickName);
      },
    });

    const ctx: ChatCommandContext = {
      channel: 'owner',
      username: 'sender',
      message: '+unlink otheruser',
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    await command.execute(ctx, ['otheruser']);

    assert.equal(removed.length, 0);
    assert.ok(replies[0].startsWith('Usage: +unlink'));
  });
});
