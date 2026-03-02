import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractChatEvent, parseChatroomFromChannel } from './kickBot.js';

describe('extractChatEvent', () => {
  it('accepts alternate Kick payload fields used by legacy events', () => {
    const extracted = extractChatEvent({
      event: 'App\\Events\\WhisperEvent',
      channel: 'chatrooms.12345.v2',
      data: JSON.stringify({
        text: '!ping',
        sender: {
          slug: 'RunnerOne',
        },
        chatroom: {
          id: 12345,
        },
      }),
    });

    assert.equal(extracted.content, '!ping');
    assert.equal(extracted.contentField, 'text');
    assert.equal(extracted.sender, 'RunnerOne');
    assert.equal(extracted.senderField, 'sender.slug');
    assert.equal(extracted.chatroomId, 12345);
    assert.equal(extracted.chatroomField, 'chatroom.id');
  });

  it('falls back to channel-derived chatroom ids and body/msg fields', () => {
    const extracted = extractChatEvent({
      event: 'App\\Events\\ChatMessageEvent',
      channel: 'chatroom_67890',
      data: {
        body: '+ping',
        senderUsername: 'Speedrunner',
      },
    });

    assert.equal(extracted.content, '+ping');
    assert.equal(extracted.contentField, 'body');
    assert.equal(extracted.sender, 'Speedrunner');
    assert.equal(extracted.senderField, 'senderUsername');
    assert.equal(extracted.chatroomId, 67890);
    assert.equal(extracted.chatroomField, 'channel');
  });
});

describe('parseChatroomFromChannel', () => {
  it('parses both Kick channel naming formats', () => {
    assert.equal(parseChatroomFromChannel('chatrooms.86176434.v2'), 86176434);
    assert.equal(parseChatroomFromChannel('chatroom_86176434'), 86176434);
  });
});
