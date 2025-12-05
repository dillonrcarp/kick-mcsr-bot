export interface ChatClient {
  join(channel: string): Promise<void>;
  leave(channel: string): Promise<void>;
}

async function join(channel: string): Promise<void> {
  if (!channel) return;
  const normalized = channel.trim().toLowerCase();
  if (!normalized) return;
  console.log(`[chatClient] join called for ${normalized} (stub; no-op)`);
}

async function leave(channel: string): Promise<void> {
  if (!channel) return;
  const normalized = channel.trim().toLowerCase();
  if (!normalized) return;
  console.log(`[chatClient] leave called for ${normalized} (stub; no-op)`);
}

export const chatClient: ChatClient = {
  join,
  leave,
};
