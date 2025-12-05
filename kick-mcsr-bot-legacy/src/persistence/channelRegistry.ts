import fs from 'node:fs';
import path from 'node:path';

export interface ChannelEntry {
  channelName: string;
  broadcasterUserId: string | null;
  botEnabled: boolean;
  addedAt: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'channels.json');

let cache: ChannelEntry[] | null = null;

function ensureLoaded(): void {
  if (cache) {
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
}

function persist(): void {
  if (!cache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

export function getEnabledChannels(): ChannelEntry[] {
  ensureLoaded();
  if (!cache) return [];
  const now = Date.now();
  cache = cache.map((entry) => {
    if (typeof (entry as unknown) === 'string') {
      const name = String(entry);
      return {
        channelName: name,
        broadcasterUserId: null,
        botEnabled: true,
        addedAt: now,
      };
    }
    return entry;
  });
  persist();
  return cache.filter((entry) => entry.botEnabled);
}

export function addOrUpdateChannel(channelName: string, broadcasterUserId: string | null = null): boolean {
  if (!channelName) return false;
  const trimmed = channelName.trim();
  if (!trimmed) return false;
  ensureLoaded();
  if (!cache) cache = [];

  const lower = trimmed.toLowerCase();
  const existingIndex = cache.findIndex(
    (entry) => entry.channelName?.toLowerCase?.() === lower,
  );
  const now = Date.now();
  if (existingIndex >= 0) {
    const existing = cache[existingIndex];
    cache[existingIndex] = {
      ...existing,
      channelName: trimmed,
      broadcasterUserId: broadcasterUserId || existing.broadcasterUserId || null,
      botEnabled: true,
      addedAt: now,
    };
  } else {
    cache.push({
      channelName: trimmed,
      broadcasterUserId: broadcasterUserId || null,
      botEnabled: true,
      addedAt: now,
    });
  }
  persist();
  return true;
}

export function removeChannel(channelName: string): boolean {
  if (!channelName) return false;
  const trimmed = channelName.trim();
  if (!trimmed) return false;
  ensureLoaded();
  if (!cache) return false;
  const lower = trimmed.toLowerCase();
  const before = cache.length;
  cache = cache.filter((entry) => entry.channelName?.toLowerCase?.() !== lower);
  const changed = cache.length !== before;
  if (changed) persist();
  return changed;
}
