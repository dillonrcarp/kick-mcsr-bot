const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'linkedAccounts.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');

let cache = null;
let channelsCache = null;

function ensureLoaded() {
  if (cache) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    cache = {};
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

function ensureChannelsLoaded() {
  if (channelsCache) return;
  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf-8');
    channelsCache = JSON.parse(raw);
    if (!Array.isArray(channelsCache)) channelsCache = [];
  } catch {
    channelsCache = [];
  }
}

function persistChannels() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channelsCache, null, 2), 'utf-8');
}

function getLinkedAccount(kickUsername) {
  if (!kickUsername) return null;
  ensureLoaded();
  return cache[kickUsername.toLowerCase()] || null;
}

function setLinkedAccount(kickUsername, mcsrUsername) {
  if (!kickUsername || !mcsrUsername) return false;
  ensureLoaded();
  cache[kickUsername.toLowerCase()] = mcsrUsername;
  persist();
  return true;
}

function removeLinkedAccount(kickUsername) {
  if (!kickUsername) return false;
  ensureLoaded();
  const key = kickUsername.toLowerCase();
  if (!cache[key]) return false;
  delete cache[key];
  persist();
  return true;
}

function getChannels() {
  ensureChannelsLoaded();
  return [...channelsCache];
}

function addChannel(name) {
  if (!name) return false;
  ensureChannelsLoaded();
  const lower = name.toLowerCase();
  if (channelsCache.some((c) => c.toLowerCase() === lower)) return false;
  channelsCache.push(name);
  persistChannels();
  return true;
}

function removeChannel(name) {
  if (!name) return false;
  ensureChannelsLoaded();
  const lower = name.toLowerCase();
  const before = channelsCache.length;
  channelsCache = channelsCache.filter((c) => c.toLowerCase() !== lower);
  const changed = channelsCache.length !== before;
  if (changed) persistChannels();
  return changed;
}

module.exports = {
  getLinkedAccount,
  setLinkedAccount,
  removeLinkedAccount,
  getChannels,
  addChannel,
  removeChannel,
};
