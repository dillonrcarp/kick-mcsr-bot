import WebSocket, { RawData } from 'ws';
import axios, { type RawAxiosRequestHeaders } from 'axios';

import { parseCommand, handleCommand } from '../commands/index.js';
import { getEnabledChannels, addOrUpdateChannel, removeChannel } from '../persistence/channelRegistry.js';
import type { ChannelEntry } from '../persistence/channelRegistry.js';
import type { BotEnvConfig } from '../config/env.js';

interface ChatroomInfo {
  id: string;
  pusherCluster?: string;
  pusherAppKey?: string;
  pusherHost?: string;
}

interface PusherMessage {
  event?: string;
  data?: any;
  channel?: string;
}

const PUSHER_CLIENT = 'js';
const PUSHER_VERSION = '8.4.0';
const PUSHER_PROTOCOL = '7';
const DEFAULT_PUSHER_KEY = 'eb707e3b98eae06e0046';
const DEFAULT_CLUSTERS = 'us3,us2,us1,mt1,eu1,eu2,ap1,sa1';

export class KickMcsrBot {
  private readonly config: BotEnvConfig;
  private readonly debug: boolean;
  private readonly baseHeaders: RawAxiosRequestHeaders;
  private readonly botHome: string;
  private readonly appKey: string;
  private readonly baseClusters: string[];
  private readonly pusherHost?: string;
  private readonly channelMapById = new Map<string, string>();
  private readonly channelIdByName = new Map<string, string>();
  private readonly allowedChatroomIds = new Set<string>();
  private readonly modState = new Map<string, boolean>();
  private readonly modSyncErrors = new Map<string, string | number>();
  private trackedChatroomIds: string[] = [];
  private modSyncTimer?: NodeJS.Timeout;

  constructor(config: BotEnvConfig) {
    this.config = config;
    this.debug = config.debugChat;
    this.botHome = config.botUsername.toLowerCase();
    this.appKey = config.pusherKey || DEFAULT_PUSHER_KEY;
    this.pusherHost = config.pusherHost;
    this.baseHeaders = this.buildBaseHeaders();
    const clusterSource = config.pusherCluster || DEFAULT_CLUSTERS;
    this.baseClusters = clusterSource
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  async start(): Promise<void> {
    const chatroomIds = await this.bootstrapChannels();
    this.trackedChatroomIds = Array.from(new Set(chatroomIds));
    this.connectWithCluster();
    await this.syncModStatus();
    this.modSyncTimer = setInterval(() => {
      void this.syncModStatus();
    }, 30000);
  }

  private buildBaseHeaders(): RawAxiosRequestHeaders {
    const cookieHeader = this.config.cookieHeader || this.buildCookieHeader();
    const headers: RawAxiosRequestHeaders = {
      'User-Agent': 'kick-mcsr-bot/phase1',
      Authorization: `Bearer ${this.decode(this.config.token)}`,
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${encodeURIComponent(this.config.channel)}`,
      Cookie: cookieHeader,
      Accept: 'application/json, text/plain, */*',
      Vary: 'Accept-Encoding',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (this.config.xsrfToken) {
      headers['X-XSRF-TOKEN'] = this.decode(this.config.xsrfToken);
    }

    return headers;
  }

  private buildCookieHeader(): string {
    const parts = [`session_token=${this.config.token}`];
    if (this.config.sessionCookie) {
      parts.push(`kick_session=${this.config.sessionCookie}`);
    }
    if (this.config.xsrfToken) {
      parts.push(`XSRF-TOKEN=${this.config.xsrfToken}`);
    }
    if (this.config.extraCookies) {
      parts.push(this.config.extraCookies);
    }
    return parts.join('; ');
  }

  private decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private async bootstrapChannels(): Promise<string[]> {
    try {
      const loaded = getEnabledChannels();
      const configuredChannels = this.normalizeChannels(loaded);

      if (!configuredChannels.some((c) => c.toLowerCase() === this.config.channel.toLowerCase())) {
        addOrUpdateChannel(this.config.channel);
        configuredChannels.push(this.config.channel);
      }
      if (this.botHome && !configuredChannels.some((c) => c.toLowerCase() === this.botHome)) {
        addOrUpdateChannel(this.botHome);
        configuredChannels.push(this.botHome);
      }

      const uniqueChannels = this.dedupe(configuredChannels);
      const chatroomIds: string[] = [];
      for (const channel of uniqueChannels) {
        try {
          const info = await this.fetchChatroomInfo(channel);
          if (info?.id) {
            this.channelMapById.set(info.id, channel);
            this.channelIdByName.set(channel.toLowerCase(), info.id);
            chatroomIds.push(info.id);
          } else {
            console.error(`Could not resolve chatroom id for channel: ${channel}`);
          }
        } catch (err: unknown) {
          const message = (err as Error)?.message || 'unknown error';
          console.error(`Failed to fetch info for channel ${channel}: ${message}`);
        }
      }
      return chatroomIds;
    } catch (err) {
      console.error('Failed to load channel registry:', err);
      throw err;
    }
  }

  private normalizeChannels(entries: ChannelEntry[]): string[] {
    const result: string[] = [];
    for (const entry of entries) {
      if (typeof (entry as unknown) === 'string') {
        result.push(String(entry));
      } else if (entry && typeof entry.channelName === 'string') {
        result.push(entry.channelName);
      }
    }
    return result;
  }

  private dedupe(channels: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const name of channels) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      unique.push(name);
    }
    return unique;
  }

  private buildWsUrl(cluster: string, host?: string): string {
    if (host) {
      const normalizedHost = host.startsWith('ws') ? host : `wss://${host}`;
      return `${normalizedHost}/app/${this.appKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
    }
    return `wss://ws-${cluster}.pusher.com/app/${this.appKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
  }

  private connectWithCluster(clusterIndex = 0): void {
    const preferredCluster = (this.config.pusherCluster || '').trim();
    const clusters = preferredCluster
      ? [preferredCluster, ...this.baseClusters.filter((c) => c !== preferredCluster)]
      : this.baseClusters;

    if (clusterIndex >= clusters.length) {
      console.error('No more Pusher clusters to try. Exiting.');
      process.exit(1);
    }

    const cluster = clusters[clusterIndex];
    const wsUrl = this.buildWsUrl(cluster, this.pusherHost || this.config.pusherHost);
    const connectionVia = this.pusherHost ? this.pusherHost : `cluster ${cluster}`;
    console.log(`Connecting to Kick chat via ${connectionVia}...`);

    const ws = new WebSocket(wsUrl);
    let switched = false;

    ws.on('open', () => {
      console.log('WebSocket connected, waiting for subscription to succeed...');
      for (const id of this.trackedChatroomIds) {
        this.allowedChatroomIds.add(id);
        this.subscribeToChat(ws, id);
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error on cluster ${cluster}:`, err instanceof Error ? err.message : err);
      if (!switched) {
        switched = true;
        console.log('Trying next cluster due to error...');
        this.connectWithCluster(clusterIndex + 1);
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.error(`WebSocket closed (${code}) on cluster ${cluster}: ${reason.toString()}`);
      if (!switched && (code === 4001 || code === 1006 || code === 4100)) {
        switched = true;
        console.log('Cluster mismatch/close detected, trying next cluster...');
        this.connectWithCluster(clusterIndex + 1);
      }
    });

    this.listenForMessages(ws);
  }

  private subscribeToChat(ws: WebSocket, chatroomId: string): void {
    const channels = [`chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`];
    for (const channel of channels) {
      const payload = JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel, auth: '' },
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
      if (this.debug) {
        console.log('Sent subscription for channel:', channel);
      }
    }
  }

  private unsubscribeFromChat(ws: WebSocket, chatroomId: string): void {
    const channels = [`chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`];
    for (const channel of channels) {
      const payload = JSON.stringify({
        event: 'pusher:unsubscribe',
        data: { channel },
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
      if (this.debug) {
        console.log('Sent unsubscribe for channel:', channel);
      }
    }
  }

  private listenForMessages(ws: WebSocket): void {
    ws.on('message', async (payload: RawData) => {
      const raw = typeof payload === 'string' ? payload : payload.toString();
      let message: PusherMessage;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (this.debug && !message.event) {
        console.log('WS message without event:', message);
      }

      if (this.debug && message.event && !['pusher:ping', 'pusher:pong'].includes(message.event)) {
        console.log('WS event:', message.event, 'dataType:', typeof message.data);
        console.log('WS raw message:', JSON.stringify(message));
      }

      if (message.event === 'pusher:connection_established') {
        return;
      }

      if (message.event === 'pusher:ping') {
        this.handlePusherPing(ws);
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
        try {
          await this.processChatEvent(ws, message);
        } catch (err) {
          console.error('Failed to process chat event', err);
        }
      }
    });
  }

  private async processChatEvent(ws: WebSocket, message: PusherMessage): Promise<void> {
    const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
    const sender = data?.sender?.username || data?.senderUsername;
    const content = data?.content ?? data?.message ?? data?.text ?? data?.body ?? data?.msg;
    const rawChatroomId = data?.chatroom_id ?? this.parseChatroomId(message.channel || '');
    const chatroomId = rawChatroomId ? String(rawChatroomId) : null;
    const isBroadcaster = Array.isArray(data?.sender?.identity?.badges)
      ? data.sender.identity.badges.some((badge: any) => badge?.type === 'broadcaster')
      : false;
    const channelName = chatroomId ? this.channelMapById.get(chatroomId) || this.config.channel : this.config.channel;

    if (this.debug) {
      console.log('Chat payload:', { event: message.event, sender, content, commandPreview: parseCommand(content) });
    }

    if (!content || !sender) return;
    if (sender.toLowerCase() === this.config.botUsername.toLowerCase()) return;

    const lowerContent = content.toLowerCase();
    const botNameLower = this.config.botUsername.toLowerCase();

    const mentionsMod =
      lowerContent.includes('mod') || lowerContent.includes('moderator') || lowerContent.includes('unmod');
    if (this.debug && mentionsMod && lowerContent.includes(botNameLower)) {
      console.log(
        `[MOD DEBUG] Possible mod/unmod message in #${channelName}: sender=${sender}, content="${content}", chatroomId=${chatroomId}`,
      );
    }

    if (chatroomId && lowerContent.includes('moderator') && lowerContent.includes(botNameLower)) {
      const alreadyRegistered = getEnabledChannels().some((entry) => {
        const name = typeof (entry as unknown) === 'string' ? String(entry) : entry.channelName;
        return name?.toLowerCase() === channelName.toLowerCase();
      });
      const added = addOrUpdateChannel(channelName);
      if (added) {
        this.channelMapById.set(chatroomId, channelName);
        this.allowedChatroomIds.add(chatroomId);
        this.subscribeToChat(ws, chatroomId);
        console.log(`Enrolled channel via mod event: ${channelName} (${chatroomId})`);
        console.log(`[MOD] Bot was modded in channel "${channelName}" (chatroom ${chatroomId}).`);
      } else {
        console.log(
          `[MOD] Bot modded in channel "${channelName}" (chatroom ${chatroomId}). Already registered: ${alreadyRegistered}`,
        );
      }
    }

    if (
      chatroomId &&
      (lowerContent.includes('unmod') || (lowerContent.includes('removed') && lowerContent.includes('moderator'))) &&
      lowerContent.includes(botNameLower)
    ) {
      const removed = removeChannel(channelName);
      this.allowedChatroomIds.delete(chatroomId);
      this.channelMapById.delete(chatroomId);
      this.channelIdByName.delete(channelName.toLowerCase());
      this.unsubscribeFromChat(ws, chatroomId);
      if (removed) {
        console.log(`Unenrolled channel via unmod event: ${channelName} (${chatroomId})`);
        console.log(`[UNMOD] Bot was unmodded/removed from channel "${channelName}" (chatroom ${chatroomId}).`);
      }
      return;
    }

    if (chatroomId && !this.allowedChatroomIds.has(chatroomId)) {
      return;
    }

    const command = parseCommand(content);

    if (command?.name === 'leavechannel') {
      const target = command.args?.[0];
      const targetLower = target?.toLowerCase();
      if (targetLower) {
        const targetChatroomId = this.channelIdByName.get(targetLower);
        const removed = removeChannel(targetLower);
        if (targetChatroomId) {
          this.allowedChatroomIds.delete(targetChatroomId);
          this.channelMapById.delete(targetChatroomId);
          this.channelIdByName.delete(targetLower);
          this.unsubscribeFromChat(ws, targetChatroomId);
          console.log(
            `[LEAVE CMD] Unsubscribed from channel "${targetLower}" (chatroom ${targetChatroomId}). removed=${removed}`,
          );
        } else {
          console.log(`[LEAVE CMD] Removed channel "${targetLower}" (id unknown). removed=${removed}`);
        }
      }
    }

    if (command?.name === 'join' || command?.name === 'joinchannel') {
      const target = command.name === 'join' ? command.args?.[0] || sender : command.args?.[0];
      if (target) {
        await this.loadAndSubscribeChannel(target, ws);
      }
    }

    const response = await handleCommand(command, {
      sender,
      isBroadcaster,
      channel: channelName,
    });

    if (command) {
      console.log(
        `[CMD] ${sender} in #${channelName}: !${command.name} ${command.args?.join(' ') || ''}`.trim(),
      );
      if (command.name === 'join') {
        console.log(`[JOIN CMD] ${sender} result: ${response}`);
      }
    }

    if (response) {
      try {
        if (chatroomId) {
          await this.sendChatMessage(chatroomId, response);
        }
        console.log(`Replied to ${sender}: ${response}`);
      } catch (err) {
        const status = (err as { response?: { status?: number; data?: unknown } }).response?.status;
        const data = (err as { response?: { status?: number; data?: unknown } }).response?.data;
        const message = (err as Error)?.message;
        console.error('Failed to send reply', { status, data, message });
      }
    }
  }

  private handlePusherPing(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
    }
  }

  private parseChatroomId(channelName: string): string | null {
    if (!channelName || typeof channelName !== 'string') return null;
    const match = channelName.match(/chatrooms\.(\d+)/);
    return match ? match[1] : null;
  }

  private async fetchChatroomInfo(channel: string): Promise<ChatroomInfo | null> {
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`;
    const { data } = await axios.get(url, { headers: this.baseHeaders });
    const chatroom = data?.chatroom || {};
    if (!chatroom?.id) return null;
    return {
      id: String(chatroom.id),
      pusherCluster: chatroom.pusher_cluster || chatroom.pusherCluster,
      pusherAppKey: chatroom.pusher_app_key || chatroom.pusherAppKey,
      pusherHost: chatroom.pusher_host || chatroom.pusherHost,
    };
  }

  private async sendChatMessage(chatroomId: string, message: string): Promise<void> {
    const url = `https://kick.com/api/v2/messages/send/${chatroomId}`;
    await axios.post(
      url,
      {
        content: message,
        type: 'message',
      },
      {
        headers: this.baseHeaders,
        withCredentials: true,
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
      },
    );
  }

  private async loadAndSubscribeChannel(channelName: string, ws: WebSocket): Promise<void> {
    if (!channelName) return;
    const lower = channelName.toLowerCase();
    const existingId = this.channelIdByName.get(lower);
    if (existingId) {
      this.allowedChatroomIds.add(existingId);
      this.subscribeToChat(ws, existingId);
      if (this.debug) {
        console.log(`[JOIN LIVE] Already tracking ${channelName} (${existingId}), resubscribed.`);
      }
      return;
    }
    try {
      const info = await this.fetchChatroomInfo(lower);
      if (info?.id) {
        this.channelMapById.set(info.id, channelName);
        this.channelIdByName.set(lower, info.id);
        this.allowedChatroomIds.add(info.id);
        this.subscribeToChat(ws, info.id);
        console.log(`[JOIN LIVE] Subscribed to channel "${channelName}" (chatroom ${info.id}).`);
      } else {
        console.warn(`[JOIN LIVE] Could not resolve chatroom id for ${channelName}.`);
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const message = (err as Error)?.message;
      console.error(`[JOIN LIVE] Failed to load channel ${channelName}:`, status || message);
    }
  }

  private async isBotModded(channelName: string): Promise<boolean> {
    if (!channelName) return false;
    const url = `https://kick.com/api/internal/v1/channels/${encodeURIComponent(channelName)}/community/moderators`;
    try {
      const { data } = await axios.post(url, {}, { headers: this.baseHeaders, timeout: 8000 });
      const mods =
        data?.data?.moderators ||
        data?.moderators ||
        data?.data ||
        data?.items ||
        (Array.isArray(data) ? data : []);
      if (!Array.isArray(mods)) return false;
      const botLower = this.config.botUsername.toLowerCase();
      return mods.some((mod: any) => {
        const username = mod?.username?.toLowerCase?.();
        const slug = mod?.slug?.toLowerCase?.();
        const name = mod?.name?.toLowerCase?.();
        return username === botLower || slug === botLower || name === botLower;
      });
    } catch (err) {
      const status = (err as { response?: { status?: number }; code?: string }).response?.status || (err as any)?.code || 'error';
      if (status === 403) return false;
      const key = channelName.toLowerCase();
      const prev = this.modSyncErrors.get(key);
      if (prev !== status) {
        console.log(`[MOD SYNC] Failed to fetch moderators for ${channelName}: ${status}`);
        this.modSyncErrors.set(key, status);
      }
      return false;
    }
  }

  private async syncModStatus(): Promise<void> {
    const channels = getEnabledChannels();
    for (const entry of channels) {
      const chName = typeof (entry as unknown) === 'string' ? String(entry) : entry.channelName;
      if (!chName) continue;
      const chLower = chName.toLowerCase();
      const wasMod = this.modState.get(chLower) || false;
      const isMod = await this.isBotModded(chName);
      if (isMod !== wasMod) {
        this.modState.set(chLower, isMod);
        const chatroomId = this.channelIdByName.get(chLower);
        if (isMod && chatroomId) {
          this.allowedChatroomIds.add(chatroomId);
          console.log(`[MOD SYNC] Bot is modded in channel "${chName}" (${chatroomId}).`);
        } else if (!isMod && chatroomId) {
          this.allowedChatroomIds.delete(chatroomId);
          console.log(`[UNMOD SYNC] Bot is not modded in channel "${chName}" (${chatroomId}).`);
        }
      }
    }
  }
}
