import fs from 'node:fs';
import path from 'node:path';

type LinkMap = Record<string, string>;

const DATA_DIR = path.resolve('data');
const FILE_PATH = path.join(DATA_DIR, 'links.json');

let cache: LinkMap = loadFromDisk();

function normalizeKey(name: string): string {
  return (name || '').trim().toLowerCase();
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromDisk(): LinkMap {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const map: LinkMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      const mc = typeof value === 'string' ? value.trim() : '';
      if (normalized && mc) {
        map[normalized] = mc;
      }
    }
    return map;
  } catch (err) {
    console.error('Failed to read links.json:', err);
    return {};
  }
}

function persist(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(FILE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Failed to write links.json:', err);
  }
}

export function getLinkedMcName(kickName: string): string | undefined {
  const key = normalizeKey(kickName);
  if (!key) return undefined;
  return cache[key];
}

export function setLinkedMcName(kickName: string, mcName: string): void {
  const key = normalizeKey(kickName);
  const value = (mcName || '').trim();
  if (!key || !value) return;
  cache[key] = value;
  persist();
}

export function removeLinkedMcName(kickName: string): void {
  const key = normalizeKey(kickName);
  if (!key) return;
  if (cache[key]) {
    delete cache[key];
    persist();
  }
}
