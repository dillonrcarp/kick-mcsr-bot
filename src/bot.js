require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const { parseCommand, handleCommand } = require('./commands');
const { getEnabledChannels, addOrUpdateChannel, removeChannel } = require('./channelRegistry');

const {
  KICK_TOKEN,
  KICK_CHANNEL,
  KICK_BOT_USERNAME,
  DEBUG_CHAT,
  KICK_PUSHER_CLUSTER,
  KICK_PUSHER_KEY,
  KICK_PUSHER_HOST,
  KICK_XSRF_TOKEN,
  KICK_SESSION_COOKIE,
  KICK_EXTRA_COOKIES,
  KICK_COOKIE_HEADER,
} = process.env;

// Pusher constants that Kick exposes in the web client
const PUSHER_APP_KEY = KICK_PUSHER_KEY || 'eb707e3b98eae06e0046';
const PUSHER_CLIENT = 'js';
const PUSHER_VERSION = '8.4.0';
const PUSHER_PROTOCOL = '7';
const BOT_HOME = (KICK_BOT_USERNAME || '').toLowerCase();

if (!KICK_TOKEN || !KICK_CHANNEL || !KICK_BOT_USERNAME) {
  console.error('Missing env vars. Set KICK_TOKEN, KICK_CHANNEL, and KICK_BOT_USERNAME in .env');
  process.exit(1);
}

// Build cookie header similar to the browser. The session_token is required.
let cookieHeader;
if (KICK_COOKIE_HEADER) {
  cookieHeader = KICK_COOKIE_HEADER;
} else {
  cookieHeader = `session_token=${KICK_TOKEN}`;
  if (KICK_SESSION_COOKIE) {
    cookieHeader += `; kick_session=${KICK_SESSION_COOKIE}`;
  }
  if (KICK_XSRF_TOKEN) {
    cookieHeader += `; XSRF-TOKEN=${KICK_XSRF_TOKEN}`;
  }
  if (KICK_EXTRA_COOKIES) {
    cookieHeader += `; ${KICK_EXTRA_COOKIES}`;
  }
}

const baseHeaders = {
  'User-Agent': 'kick-mcsr-bot/phase1',
  Authorization: `Bearer ${decodeURIComponent(KICK_TOKEN)}`,
  Origin: 'https://kick.com',
  Referer: `https://kick.com/${encodeURIComponent(KICK_CHANNEL)}`,
  Cookie: cookieHeader,
  Accept: 'application/json, text/plain, */*',
  Vary: 'Accept-Encoding',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

if (KICK_XSRF_TOKEN) {
  try {
    baseHeaders['X-XSRF-TOKEN'] = decodeURIComponent(KICK_XSRF_TOKEN);
  } catch {
    baseHeaders['X-XSRF-TOKEN'] = KICK_XSRF_TOKEN;
  }
}

async function fetchChatroomInfo(channel) {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`;
  const { data } = await axios.get(url, { headers: baseHeaders });
  const chatroom = data?.chatroom || {};
  return {
    id: chatroom.id,
    pusherCluster: chatroom.pusher_cluster || chatroom.pusherCluster,
    pusherAppKey: chatroom.pusher_app_key || chatroom.pusherAppKey,
    pusherHost: chatroom.pusher_host || chatroom.pusherHost,
  };
}

function buildWsUrl({ cluster, appKey, host }) {
  if (host) {
    const normalizedHost = host.startsWith('ws') ? host : `wss://${host}`;
    return `${normalizedHost}/app/${appKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
  }
  return `wss://ws-${cluster}.pusher.com/app/${appKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
}

async function sendChatMessage(chatroomId, message) {
  const url = `https://kick.com/api/v2/messages/send/${chatroomId}`;
  await axios.post(
    url,
    {
      content: message,
      type: 'message',
    },
    {
      headers: baseHeaders,
      withCredentials: true,
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN',
    },
  );
}

function subscribeToChat(ws, chatroomId) {
  const channels = [`chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`];

  channels.forEach((channel) => {
    ws.send(
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel, auth: '' },
      }),
    );
    if (DEBUG) {
      console.log('Sent subscription for channel:', channel);
    }
  });
}

function unsubscribeFromChat(ws, chatroomId) {
  const channels = [`chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`];

  channels.forEach((channel) => {
    ws.send(
      JSON.stringify({
        event: 'pusher:unsubscribe',
        data: { channel },
      }),
    );
    if (DEBUG) {
      console.log('Sent unsubscribe for channel:', channel);
    }
  });
}

function unsubscribeFromChat(ws, chatroomId) {
  const channels = [`chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`];

  channels.forEach((channel) => {
    ws.send(
      JSON.stringify({
        event: 'pusher:unsubscribe',
        data: { channel },
      }),
    );
    if (DEBUG) {
      console.log('Sent unsubscribe for channel:', channel);
    }
  });
}

function handlePusherPing(ws) {
  ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
}

const DEBUG = DEBUG_CHAT === '1';
const CLUSTERS = (KICK_PUSHER_CLUSTER || 'us3,us2,us1,mt1,eu1,eu2,ap1,sa1')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const channelMapById = {};
const channelIdByName = {};
const allowedChatroomIds = new Set();
const modState = new Map(); // channelName (lowercase) -> boolean (bot is mod)
const modSyncErrors = new Map(); // channelName (lowercase) -> last error status

function parseChatroomId(channelName) {
  if (!channelName || typeof channelName !== 'string') return null;
  const match = channelName.match(/chatrooms\.(\d+)/);
  return match ? match[1] : null;
}

async function isBotModded(channelName) {
  if (!channelName) return false;
  const url = `https://kick.com/api/internal/v1/channels/${encodeURIComponent(channelName)}/community/moderators`;
  try {
    const { data } = await axios.post(url, {}, { headers: baseHeaders, timeout: 8000 });
    const mods =
      data?.data?.moderators ||
      data?.moderators ||
      data?.data ||
      data?.items ||
      (Array.isArray(data) ? data : []);
    if (!Array.isArray(mods)) return false;
    const botLower = KICK_BOT_USERNAME.toLowerCase();
    return mods.some(
      (m) =>
        m?.username?.toLowerCase?.() === botLower ||
        m?.slug?.toLowerCase?.() === botLower ||
        m?.name?.toLowerCase?.() === botLower,
    );
  } catch (err) {
    const status = err.response?.status || err.code || 'error';
    // 403 is expected when the bot account is not allowed to view mods for that channel; don't spam logs.
    if (status === 403) return false;
    const key = channelName.toLowerCase();
    const prev = modSyncErrors.get(key);
    if (prev !== status) {
      console.log(`[MOD SYNC] Failed to fetch moderators for ${channelName}: ${status}`);
      modSyncErrors.set(key, status);
    }
    return false;
  }
}

async function loadAndSubscribeChannel(channelName, ws) {
  if (!channelName) return;
  const lower = channelName.toLowerCase();
  if (channelIdByName[lower]) {
    const existingId = channelIdByName[lower];
    allowedChatroomIds.add(existingId);
    subscribeToChat(ws, existingId);
    if (DEBUG) {
      console.log(`[JOIN LIVE] Already tracking ${channelName} (${existingId}), resubscribed.`);
    }
    return;
  }
  try {
    const info = await fetchChatroomInfo(lower);
    if (info?.id) {
      channelMapById[info.id] = channelName;
      channelIdByName[lower] = info.id;
      allowedChatroomIds.add(info.id);
      subscribeToChat(ws, info.id);
      console.log(`[JOIN LIVE] Subscribed to channel "${channelName}" (chatroom ${info.id}).`);
    } else {
      console.warn(`[JOIN LIVE] Could not resolve chatroom id for ${channelName}.`);
    }
  } catch (err) {
    console.error(`[JOIN LIVE] Failed to load channel ${channelName}:`, err.response?.status || err.message);
  }
}

function listenForMessages(ws) {
  ws.on('message', async (payload) => {
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }

    if (DEBUG && !message.event) {
      console.log('WS message without event:', message);
    }

    // Log all non-ping/pong events to discover mod/unmod signals
    if (DEBUG && message.event && !['pusher:ping', 'pusher:pong'].includes(message.event)) {
      console.log('WS event:', message.event, 'dataType:', typeof message.data);
      console.log('WS raw message:', JSON.stringify(message));
    }

    if (message.event === 'pusher:connection_established') {
      // subscriptions are sent separately after connection
      return;
    }

    if (message.event === 'pusher:ping') {
      handlePusherPing(ws);
      return;
    }

    if (message.event === 'pusher:error') {
      console.error('Pusher error event:', message.data);
      ws.close(4001, 'pusher:error');
      return;
    }

    if (
      message.event === 'App\\Events\\ChatMessageEvent' ||
      message.event === 'App\\Events\\MessageSentEvent' ||
      message.event === 'App\\Events\\WhisperEvent'
    ) {
      const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
      const sender = data?.sender?.username || data?.senderUsername;
      const content = data?.content ?? data?.message ?? data?.text ?? data?.body ?? data?.msg;
      const chatroomId = data?.chatroom_id || parseChatroomId(message.channel);
      const isBroadcaster = Array.isArray(data?.sender?.identity?.badges)
        ? data.sender.identity.badges.some((b) => b?.type === 'broadcaster')
        : false;
      const channelName = chatroomId ? channelMapById[chatroomId] || KICK_CHANNEL : KICK_CHANNEL;

      if (DEBUG) {
        console.log('Chat payload:', { event: message.event, sender, content, commandPreview: parseCommand(content) });
      }

      if (!content || !sender) return;
      if (sender.toLowerCase() === KICK_BOT_USERNAME.toLowerCase()) return;

      const lowerContent = content.toLowerCase();
      const botNameLower = KICK_BOT_USERNAME.toLowerCase();

      // Log any possible mod/unmod message that mentions the bot
      const modIntent =
        lowerContent.includes('mod') || lowerContent.includes('moderator') || lowerContent.includes('unmod');
      if (DEBUG && modIntent && lowerContent.includes(botNameLower)) {
        console.log(
          `[MOD DEBUG] Possible mod/unmod message in #${channelName}: sender=${sender}, content="${content}", chatroomId=${chatroomId}`,
        );
      }

      // Auto-enroll channel when bot is modded
      if (chatroomId && lowerContent.includes('moderator') && lowerContent.includes(botNameLower)) {
        const alreadyRegistered = getEnabledChannels().some((c) => {
          const name = typeof c === 'string' ? c : c.channelName;
          return name && name.toLowerCase() === channelName.toLowerCase();
        });
        const added = addOrUpdateChannel(channelName);
        if (added) {
          channelMapById[chatroomId] = channelName;
          allowedChatroomIds.add(chatroomId);
          subscribeToChat(ws, chatroomId);
          console.log(`Enrolled channel via mod event: ${channelName} (${chatroomId})`);
          console.log(`[MOD] Bot was modded in channel "${channelName}" (chatroom ${chatroomId}).`);
        } else {
          console.log(
            `[MOD] Bot modded in channel "${channelName}" (chatroom ${chatroomId}). Already registered: ${alreadyRegistered}`,
          );
        }
      }

      // Auto-unenroll when bot is unmodded/removed as moderator
      if (
        chatroomId &&
        (lowerContent.includes('unmod') || (lowerContent.includes('removed') && lowerContent.includes('moderator'))) &&
        lowerContent.includes(botNameLower)
      ) {
        const removed = removeChannel(channelName);
        allowedChatroomIds.delete(chatroomId);
        delete channelMapById[chatroomId];
        delete channelIdByName[channelName.toLowerCase()];
        unsubscribeFromChat(ws, chatroomId);
        if (removed) {
          console.log(`Unenrolled channel via unmod event: ${channelName} (${chatroomId})`);
          console.log(`[UNMOD] Bot was unmodded/removed from channel "${channelName}" (chatroom ${chatroomId}).`);
        }
        return;
      }

      // If still not allowed after potential enroll, skip processing commands
      if (chatroomId && !allowedChatroomIds.has(chatroomId)) return;

      const command = parseCommand(content);

      // If leavechannel is issued, proactively drop subscriptions/mappings
      if (command?.name === 'leavechannel') {
        const target = command.args?.[0];
        const targetLower = target?.toLowerCase?.();
        if (targetLower) {
          const targetChatroomId = channelIdByName[targetLower];
          const removed = removeChannel(targetLower);
          if (targetChatroomId) {
            allowedChatroomIds.delete(targetChatroomId);
            delete channelMapById[targetChatroomId];
            delete channelIdByName[targetLower];
            unsubscribeFromChat(ws, targetChatroomId);
            console.log(
              `[LEAVE CMD] Unsubscribed from channel "${targetLower}" (chatroom ${targetChatroomId}). removed=${removed}`,
            );
          } else {
            console.log(`[LEAVE CMD] Removed channel "${targetLower}" (id unknown). removed=${removed}`);
          }
        }
      }

      // If join/joinchannel is issued, immediately fetch and subscribe so no restart is needed
      if (command?.name === 'join' || command?.name === 'joinchannel') {
        const target =
          command.name === 'join'
            ? command.args?.[0] || sender
            : command.args?.[0];
        if (target) {
          await loadAndSubscribeChannel(target, ws);
        }
      }

      const response = await handleCommand(command, {
        sender,
        isBroadcaster,
        channel: channelName,
      });

      if (command) {
        console.log(`[CMD] ${sender} in #${channelName}: !${command.name} ${command.args?.join(' ') || ''}`.trim());
        if (command.name === 'join') {
          console.log(`[JOIN CMD] ${sender} result: ${response}`);
        }
      }

      if (response) {
        try {
          if (chatroomId) {
            await sendChatMessage(chatroomId, response);
          }
          console.log(`Replied to ${sender}: ${response}`);
        } catch (err) {
          console.error('Failed to send reply', {
            status: err.response?.status,
            data: err.response?.data,
            message: err.message,
          });
        }
      }
    }
  });
}

async function syncModStatus() {
  const channels = getEnabledChannels();
  for (const ch of channels) {
    const chName = typeof ch === 'string' ? ch : ch.channelName;
    if (!chName) continue;
    const chLower = chName.toLowerCase();
    const wasMod = modState.get(chLower) || false;
    const isMod = await isBotModded(chName);
    if (isMod !== wasMod) {
      modState.set(chLower, isMod);
      const chatroomId = channelIdByName[chLower];
      if (isMod && chatroomId) {
        allowedChatroomIds.add(chatroomId);
        console.log(`[MOD SYNC] Bot is modded in channel "${chName}" (${chatroomId}).`);
      } else if (!isMod && chatroomId) {
        allowedChatroomIds.delete(chatroomId);
        console.log(`[UNMOD SYNC] Bot is not modded in channel "${chName}" (${chatroomId}).`);
      }
    }
  }
}

async function start() {
  try {
    // Load channels and ensure base channel and bot's own channel are present
    const loaded = getEnabledChannels();
    const configuredChannels = [];

    // Normalize entries
    for (const entry of loaded) {
      if (entry && typeof entry.channelName === 'string') {
        configuredChannels.push(entry.channelName);
      } else if (typeof entry === 'string') {
        configuredChannels.push(entry);
      }
    }

    if (!configuredChannels.some((c) => c.toLowerCase() === KICK_CHANNEL.toLowerCase())) {
      addOrUpdateChannel(KICK_CHANNEL);
      configuredChannels.push(KICK_CHANNEL);
    }
    if (BOT_HOME && !configuredChannels.some((c) => c.toLowerCase() === BOT_HOME)) {
      addOrUpdateChannel(BOT_HOME);
      configuredChannels.push(BOT_HOME);
    }

    // Dedupe channels (case-insensitive)
    const seen = new Set();
    const uniqueChannels = [];
    for (const ch of configuredChannels) {
      const lower = ch.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      uniqueChannels.push(ch);
    }

    const channelInfos = {};
    const chatroomIds = [];
    for (const ch of uniqueChannels) {
      try {
        const info = await fetchChatroomInfo(ch);
        if (info?.id) {
          channelInfos[ch.toLowerCase()] = info;
          channelMapById[info.id] = ch;
          channelIdByName[ch.toLowerCase()] = info.id;
          chatroomIds.push(info.id);
        } else {
          console.error(`Could not resolve chatroom id for channel: ${ch}`);
        }
      } catch (err) {
        console.error(`Failed to fetch info for channel ${ch}:`, err.message);
      }
    }

    // Dedupe chatroom ids
    const uniqueChatroomIds = Array.from(new Set(chatroomIds));

    const appKey = PUSHER_APP_KEY;
    const pusherHost = KICK_PUSHER_HOST || '';
    const preferredCluster = (KICK_PUSHER_CLUSTER || '').trim();
    const clusters = preferredCluster
      ? [preferredCluster, ...CLUSTERS.filter((c) => c !== preferredCluster)]
      : CLUSTERS;

    if (DEBUG) {
      console.log('Chatrooms:', {
        channels: uniqueChannels,
        chatroomIds: uniqueChatroomIds,
      });
    }

    function connectWithCluster(clusterIndex = 0) {
      if (clusterIndex >= clusters.length) {
        console.error('No more Pusher clusters to try. Exiting.');
        process.exit(1);
      }

      const cluster = clusters[clusterIndex];
      const wsUrl = buildWsUrl({ cluster, appKey, host: pusherHost || KICK_PUSHER_HOST });
      const connectionVia = pusherHost ? pusherHost : `cluster ${cluster}`;
      console.log(`Connecting to Kick chat via ${connectionVia}...`);

      const ws = new WebSocket(wsUrl);
      let switched = false;

      ws.on('open', () => {
        console.log('WebSocket connected, waiting for subscription to succeed...');
        uniqueChatroomIds.forEach((id) => {
          allowedChatroomIds.add(id);
          subscribeToChat(ws, id);
        });
      });

      ws.on('error', (err) => {
        console.error(`WebSocket error on cluster ${cluster}:`, err.message);
        if (!switched) {
          switched = true;
          console.log('Trying next cluster due to error...');
          connectWithCluster(clusterIndex + 1);
          try { ws.close(); } catch { /* ignore */ }
        }
      });

      ws.on('close', (code, reason) => {
        console.error(`WebSocket closed (${code}) on cluster ${cluster}: ${reason}`);
        if (!switched && (code === 4001 || code === 1006 || code === 4100)) {
          switched = true;
          console.log('Cluster mismatch/close detected, trying next cluster...');
          connectWithCluster(clusterIndex + 1);
        }
      });

      listenForMessages(ws);
    }

    connectWithCluster();

    // Initial mod sync and interval
    await syncModStatus();
    setInterval(syncModStatus, 30000);
  } catch (err) {
    console.error('Failed to start bot:', err.response?.data || err.message);
    process.exit(1);
  }
}

start();
