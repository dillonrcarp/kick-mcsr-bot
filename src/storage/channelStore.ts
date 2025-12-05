import fs from 'node:fs';
import path from 'node:path';

export interface StoredChannel {
  channel: string;
  chatroomId: number;
}

const DATA_DIR = path.resolve('data');
const FILE_PATH = path.join(DATA_DIR, 'channels.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadStoredChannels(): StoredChannel[] {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        channel: typeof entry.channel === 'string' ? entry.channel : '',
        chatroomId: Number(entry.chatroomId),
      }))
      .filter((entry) => entry.channel && Number.isFinite(entry.chatroomId));
  } catch (err) {
    console.error('Failed to read channels.json:', err);
    return [];
  }
}

export function saveStoredChannels(channels: StoredChannel[]): void {
  ensureDataDir();
  const unique = dedupeChannels(channels);
  fs.writeFileSync(FILE_PATH, JSON.stringify(unique, null, 2));
}

export function dedupeChannels(channels: StoredChannel[]): StoredChannel[] {
  const seen = new Map<string, StoredChannel>();
  for (const entry of channels) {
    if (!entry.channel || !Number.isFinite(entry.chatroomId)) continue;
    const key = `${entry.channel.toLowerCase()}::${entry.chatroomId}`;
    if (!seen.has(key)) {
      seen.set(key, {
        channel: entry.channel,
        chatroomId: entry.chatroomId,
      });
    }
  }
  return Array.from(seen.values());
}
