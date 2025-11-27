const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'channels.json');

let cache = null;

function ensureLoaded() {
  if (cache) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

function getEnabledChannels() {
  ensureLoaded();
  const now = Date.now();
  // Normalize any legacy string entries into objects
  cache = cache.map((c) => {
    if (typeof c === 'string') {
      return {
        channelName: c,
        broadcasterUserId: null,
        botEnabled: true,
        addedAt: now,
      };
    }
    return c;
  });
  persist();
  return cache.filter((c) => c.botEnabled);
}

function addOrUpdateChannel(channelName, broadcasterUserId = null) {
  if (typeof channelName !== 'string') return false;
  const trimmed = channelName.trim();
  if (!trimmed) return false;
  ensureLoaded();

  const lower = trimmed.toLowerCase();
  const idx = cache.findIndex(
    (c) => c && typeof c.channelName === 'string' && c.channelName.toLowerCase() === lower,
  );
  const now = Date.now();
  if (idx >= 0) {
    cache[idx] = {
      ...cache[idx],
      channelName: trimmed,
      broadcasterUserId: broadcasterUserId || cache[idx].broadcasterUserId || null,
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

function removeChannel(channelName) {
  if (typeof channelName !== 'string') return false;
  const trimmed = channelName.trim();
  if (!trimmed) return false;
  ensureLoaded();
  const lower = trimmed.toLowerCase();
  const before = cache.length;
  cache = cache.filter((c) => !(c && typeof c.channelName === 'string' && c.channelName.toLowerCase() === lower));
  const changed = cache.length !== before;
  if (changed) persist();
  return changed;
}

module.exports = {
  getEnabledChannels,
  addOrUpdateChannel,
  removeChannel,
};
