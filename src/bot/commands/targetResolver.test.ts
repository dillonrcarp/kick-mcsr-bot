import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatCommandContext } from './commandRegistry.js';
import {
  OWNER_LINK_TOOLTIP,
  SELF_LINK_TOOLTIP,
  resolveSinglePlayerTarget,
} from './targetResolver.js';

function makeCtx(channel: string, username: string): ChatCommandContext {
  return {
    channel,
    username,
    message: '',
    reply: async () => {},
  };
}

describe('resolveSinglePlayerTarget', () => {
  it('uses explicit player argument directly', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['Notch'],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async () => null,
      },
    );

    assert.deepEqual(resolved, { ok: true, name: 'Notch', source: 'explicit' });
  });

  it('prefers channel owner linked account for no-arg lookups', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      [],
      {
        getLinkedMcName: (name) => (name === 'owner' ? 'OwnerMC' : undefined),
        getPlayerSummary: async () => null,
      },
    );

    assert.deepEqual(resolved, { ok: true, name: 'OwnerMC', source: 'owner_linked' });
  });

  it('falls back to owner username when owner is valid and unlinked', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      [],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async (name) => (name === 'owner' ? { username: 'owner' } : null),
      },
    );

    assert.deepEqual(resolved, { ok: true, name: 'owner', source: 'owner_username' });
  });

  it('returns owner link tooltip when owner lookup fails', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      [],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async () => null,
      },
    );

    assert.deepEqual(resolved, { ok: false, message: OWNER_LINK_TOOLTIP });
  });

  it('resolves "me" using sender linked/validated flow', async () => {
    const linked = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['me'],
      {
        getLinkedMcName: (name) => (name === 'sender' ? 'SenderMC' : undefined),
        getPlayerSummary: async () => null,
      },
    );
    assert.deepEqual(linked, { ok: true, name: 'SenderMC', source: 'self_linked' });

    const validated = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['me'],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async (name) => (name === 'sender' ? { username: 'sender' } : null),
      },
    );
    assert.deepEqual(validated, { ok: true, name: 'sender', source: 'self_username' });

    const missing = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['me'],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async () => null,
      },
    );
    assert.deepEqual(missing, { ok: false, message: SELF_LINK_TOOLTIP });
  });
});
