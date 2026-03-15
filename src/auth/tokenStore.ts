import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

export interface KickTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

const DATA_DIR = path.resolve('data');
const FILE_PATH = path.join(DATA_DIR, 'tokens.json');
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadTokens(): KickTokens | null {
  try {
    if (!fs.existsSync(FILE_PATH)) return null;
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed as KickTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: KickTokens): void {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(tokens, null, 2));
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<KickTokens> {
  const stored = loadTokens();
  if (!stored?.refreshToken) {
    throw new Error('No refresh token stored. Run the login script first.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await axios.post(KICK_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokens: KickTokens = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? stored.refreshToken,
    expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
  };

  saveTokens(tokens);
  return tokens;
}
