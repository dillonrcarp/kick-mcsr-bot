import dotenv from 'dotenv';

dotenv.config();

export interface BotEnvConfig {
  token: string;
  channel: string;
  botUsername: string;
  debugChat: boolean;
  pusherKey?: string;
  pusherCluster?: string;
  pusherHost?: string;
  xsrfToken?: string;
  sessionCookie?: string;
  extraCookies?: string;
  cookieHeader?: string;
}

function toBoolean(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function requireEnv(name: string, value?: string | null): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function loadConfig(): BotEnvConfig {
  const token = requireEnv('KICK_TOKEN', process.env.KICK_TOKEN);
  const channel = requireEnv('KICK_CHANNEL', process.env.KICK_CHANNEL);
  const botUsername = requireEnv('KICK_BOT_USERNAME', process.env.KICK_BOT_USERNAME);

  return {
    token,
    channel,
    botUsername,
    debugChat: toBoolean(process.env.DEBUG_CHAT),
    pusherKey: process.env.KICK_PUSHER_KEY?.trim(),
    pusherCluster: process.env.KICK_PUSHER_CLUSTER?.trim(),
    pusherHost: process.env.KICK_PUSHER_HOST?.trim(),
    xsrfToken: process.env.KICK_XSRF_TOKEN?.trim(),
    sessionCookie: process.env.KICK_SESSION_COOKIE?.trim(),
    extraCookies: process.env.KICK_EXTRA_COOKIES?.trim(),
    cookieHeader: process.env.KICK_COOKIE_HEADER?.trim(),
  };
}
