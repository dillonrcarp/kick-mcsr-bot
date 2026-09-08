import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatCommandContext } from './commandRegistry.js';
import {
  OWNER_LINK_TOOLTIP,
  SELF_LINK_TOOLTIP,
  resolveSinglePlayerTarget,
  isValidPlayerName,
  INVALID_NAME_MESSAGE,
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

  it('ignores a malformed owner link instead of echoing it (read-side validation)', async () => {
    // Simulates a links.json entry that predates the write-time guard.
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      [],
      {
        getLinkedMcName: (name) => (name === 'owner' ? 'http://evil.example' : undefined),
        getPlayerSummary: async (name) => (name === 'owner' ? { username: 'owner' } : null),
      },
    );
    // The bad link is dropped; resolution falls through to the owner username.
    assert.deepEqual(resolved, { ok: true, name: 'owner', source: 'owner_username' });
  });

  it('ignores a malformed sender link on "me" instead of echoing it', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['me'],
      {
        getLinkedMcName: (name) => (name === 'sender' ? '@everyone' : undefined),
        getPlayerSummary: async () => null,
      },
    );
    assert.deepEqual(resolved, { ok: false, message: SELF_LINK_TOOLTIP });
  });

  it('rejects an invalid explicit target instead of echoing it', async () => {
    const resolved = await resolveSinglePlayerTarget(
      makeCtx('owner', 'sender'),
      ['http://evil.example'],
      {
        getLinkedMcName: () => undefined,
        getPlayerSummary: async () => null,
      },
    );
    assert.deepEqual(resolved, { ok: false, message: INVALID_NAME_MESSAGE });
  });
});

describe('isValidPlayerName', () => {
  it('accepts valid Minecraft-style usernames', () => {
    for (const name of ['Feinberg', 'k4de_', 'a', 'ABC123', 'sixteen_chars_16']) {
      assert.equal(isValidPlayerName(name), true, name);
    }
  });

  it('rejects names that would let a viewer echo arbitrary strings', () => {
    for (const bad of [
      'http://evil.example',
      '@everyone',
      'has space',
      'a'.repeat(17),
      'na<script>',
      'ni🎉ce',
      '',
    ]) {
      assert.equal(isValidPlayerName(bad), false, JSON.stringify(bad));
    }
  });
});
