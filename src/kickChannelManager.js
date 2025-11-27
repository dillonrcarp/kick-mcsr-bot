// Simple wrapper around the existing chat client to join/leave Kick channels.
// If the client module is missing or lacks join/leave, we log and no-op.

let chatClient = null;
try {
  // Adjust this import if your chat client lives elsewhere.
  // It should expose async join(channel) and leave(channel) methods.
  // eslint-disable-next-line global-require
  chatClient = require('./chatClient').chatClient || require('./chatClient');
} catch (err) {
  console.warn('[KickChannelManager] chatClient not found; join/leave will no-op until provided.');
}

function normalize(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/^@/, '').toLowerCase();
}

async function joinChannel(channelName) {
  const normalized = normalize(channelName);
  if (!normalized) return;

  if (!chatClient || typeof chatClient.join !== 'function') {
    console.warn(`[KickChannelManager] join() unavailable; cannot join ${normalized}`);
    return;
  }

  try {
    await chatClient.join(normalized);
    console.log(`[KickChannelManager] Joined channel: ${normalized}`);
  } catch (err) {
    console.error(`[KickChannelManager] Failed to join ${normalized}`, err);
  }
}

async function leaveChannel(channelName) {
  const normalized = normalize(channelName);
  if (!normalized) return;

  if (!chatClient || typeof chatClient.leave !== 'function') {
    console.warn(`[KickChannelManager] leave() unavailable; cannot leave ${normalized}`);
    return;
  }

  try {
    await chatClient.leave(normalized);
    console.log(`[KickChannelManager] Left channel: ${normalized}`);
  } catch (err) {
    console.error(`[KickChannelManager] Failed to leave ${normalized}`, err);
  }
}

module.exports = {
  joinChannel,
  leaveChannel,
};
