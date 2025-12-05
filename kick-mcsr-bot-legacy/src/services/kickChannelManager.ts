import { chatClient } from './chatClient.js';

function normalize(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase();
}

export async function joinChannel(channelName: string): Promise<void> {
  if (!channelName) return;
  const normalized = normalize(channelName);
  if (!normalized) return;

  if (!chatClient?.join) {
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

export async function leaveChannel(channelName: string): Promise<void> {
  if (!channelName) return;
  const normalized = normalize(channelName);
  if (!normalized) return;

  if (!chatClient?.leave) {
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
