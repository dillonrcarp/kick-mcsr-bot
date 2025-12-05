import dotenv from 'dotenv';

dotenv.config();

export interface ChannelMapping {
  channel: string;
  chatroomId: number;
}

export interface EnvConfig {
  token: string;
  channel: string;
  botUsername: string;
  debugChat: boolean;
  logChatEvents: boolean;
  pusherKey?: string;
  pusherCluster?: string;
  xsrfToken?: string;
  sessionCookie?: string;
  extraCookies?: string;
  channels: ChannelMapping[];
}

function requireEnv(name: string, value?: string | null): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseBool(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseChannels(raw?: string | null): ChannelMapping[] {
  if (!raw) return [];
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const mappings: ChannelMapping[] = [];
  for (const entry of entries) {
    const [channel, idStr] = entry.split(':');
    if (!channel || !idStr) continue;
    const chatroomId = Number(idStr.trim());
    if (!Number.isFinite(chatroomId)) continue;
    mappings.push({
      channel: channel.trim(),
      chatroomId,
    });
  }
  return mappings;
}

export function loadEnv(): EnvConfig {
  return {
    token: requireEnv('KICK_TOKEN', process.env.KICK_TOKEN),
    channel: requireEnv('KICK_CHANNEL', process.env.KICK_CHANNEL),
    botUsername: requireEnv('KICK_BOT_USERNAME', process.env.KICK_BOT_USERNAME),
    debugChat: parseBool(process.env.DEBUG_CHAT),
    logChatEvents: parseBool(process.env.LOG_CHAT_EVENTS),
    pusherKey: process.env.KICK_PUSHER_KEY?.trim(),
    pusherCluster: process.env.KICK_PUSHER_CLUSTER?.trim(),
    xsrfToken: process.env.KICK_XSRF_TOKEN?.trim(),
    sessionCookie: process.env.KICK_SESSION_COOKIE?.trim(),
    extraCookies: process.env.KICK_EXTRA_COOKIES?.trim(),
    channels: parseChannels(process.env.KICK_CHANNELS),
  };
}
