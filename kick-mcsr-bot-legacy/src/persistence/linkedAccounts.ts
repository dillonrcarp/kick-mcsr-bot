import fs from 'node:fs';
import path from 'node:path';

type AccountMap = Record<string, string>;

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'linkedAccounts.json');

let cache: AccountMap | null = null;

function ensureLoaded(): void {
  if (cache) {
    return;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    cache = JSON.parse(raw) as AccountMap;
  } catch {
    cache = {};
  }
}

function persist(): void {
  if (!cache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

export function getLinkedAccount(kickUsername: string | undefined | null): string | null {
  if (!kickUsername) return null;
  ensureLoaded();
  return cache?.[kickUsername.toLowerCase()] ?? null;
}

export function setLinkedAccount(kickUsername: string, mcsrUsername: string): boolean {
  if (!kickUsername || !mcsrUsername) return false;
  ensureLoaded();
  if (!cache) cache = {};
  cache[kickUsername.toLowerCase()] = mcsrUsername;
  persist();
  return true;
}

export function removeLinkedAccount(kickUsername: string): boolean {
  if (!kickUsername) return false;
  ensureLoaded();
  if (!cache) return false;
  const key = kickUsername.toLowerCase();
  if (!cache[key]) return false;
  delete cache[key];
  persist();
  return true;
}
