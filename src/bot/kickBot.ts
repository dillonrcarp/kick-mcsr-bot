import WebSocket, { type RawData } from 'ws';
import axios, { type RawAxiosRequestHeaders } from 'axios';

import { parseCommand } from '../commands/index.js';
import type { ParsedCommand } from '../commands/index.js';
import type { ChannelMapping, EnvConfig } from '../config/env.js';
import {
  dedupeChannels,
  loadStoredChannels,
  saveStoredChannels,
  type StoredChannel,
} from '../storage/channelStore.js';
import { CommandRegistry } from './commands/commandRegistry.js';
import { PingCommand } from './commands/pingCommand.js';
import { EloCommand } from './commands/eloCommand.js';
import { LastMatchCommand } from './commands/lastMatchCommand.js';
import { RecordCommand } from './commands/recordCommand.js';
import { WinrateCommand } from './commands/winrateCommand.js';
import { AverageCommand } from './commands/averageCommand.js';
import { MCSRHelpCommand } from './commands/mcsrHelpCommand.js';
import { LinkCommand } from './commands/linkCommand.js';
import { UnlinkCommand } from './commands/unlinkCommand.js';
import { MCSRTodayCommand } from './commands/mcsrtodayCommand.js';

interface PusherMessage {
  event?: string;
  data?: any;
  channel?: string;
}

interface ChatroomInfo extends ChannelMapping {}

const DEFAULT_PUSHER_KEY = 'eb707e3b98eae06e0046';
const DEFAULT_CLUSTERS = ['us2', 'us1', 'us3', 'mt1'];
const PUSHER_CLIENT = 'js';
const PUSHER_VERSION = '8.4.0';
const PUSHER_PROTOCOL = '7';
const FALLBACK_CHATROOM_ID = 86176434;

export class KickBot {
  private readonly headers: RawAxiosRequestHeaders;
  private ws?: WebSocket;
  private readonly config: EnvConfig;
  private readonly pusherKey: string;
  private readonly clusterList: string[];
  private readonly bindings: ChatroomInfo[] = [];
  private readonly botsByRoom = new Map<string, ChatroomInfo>();
  private readonly homeChannel: string;
  private readonly commandRegistry: CommandRegistry;

  constructor(config: EnvConfig) {
    this.config = config;
    this.pusherKey = config.pusherKey || DEFAULT_PUSHER_KEY;
    this.headers = this.buildHeaders();
    const preferred = config.pusherCluster?.split(',').map((c) => c.trim()).filter(Boolean) ?? [];
    const merged = [...preferred, ...DEFAULT_CLUSTERS];
    this.clusterList = Array.from(new Set(merged));
    this.homeChannel = this.config.channel.toLowerCase();
    this.commandRegistry = new CommandRegistry();
    this.commandRegistry.register(new PingCommand());
    this.commandRegistry.register(new EloCommand());
    this.commandRegistry.register(new LastMatchCommand());
    this.commandRegistry.register(new RecordCommand());
    this.commandRegistry.register(new WinrateCommand());
    this.commandRegistry.register(new AverageCommand());
    this.commandRegistry.register(new LinkCommand());
    this.commandRegistry.register(new UnlinkCommand());
    this.commandRegistry.register(new MCSRTodayCommand());
    this.commandRegistry.register(new MCSRHelpCommand(this.commandRegistry));
  }

  async start(): Promise<void> {
    const infos = await this.fetchChatroomInfo();
    if (!infos.length) {
      throw new Error('No Kick channels configured. Set KICK_CHANNELS or KICK_CHANNEL.');
    }
    this.bindings.splice(0, this.bindings.length);
    this.botsByRoom.clear();
    for (const binding of infos) {
      this.addBindingToMemory(binding);
    }
    saveStoredChannels(
      this.bindings.map((binding) => ({
        channel: binding.channel,
        chatroomId: binding.chatroomId,
      })),
    );
    this.openWebSocket();
  }

  private buildHeaders(): RawAxiosRequestHeaders {
    const cookies: string[] = [`session_token=${this.config.token}`];
    if (this.config.sessionCookie) {
      cookies.push(`kick_session=${this.config.sessionCookie}`);
    }
    if (this.config.xsrfToken) {
      cookies.push(`XSRF-TOKEN=${this.config.xsrfToken}`);
    }
    if (this.config.extraCookies) {
      cookies.push(this.config.extraCookies);
    }

    const header: RawAxiosRequestHeaders = {
      'User-Agent': 'kick-mcsr-bot/minimal',
      Authorization: `Bearer ${this.decode(this.config.token)}`,
      Cookie: cookies.join('; '),
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${encodeURIComponent(this.config.channel)}`,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
    };

    if (this.config.xsrfToken) {
      header['X-XSRF-TOKEN'] = this.decode(this.config.xsrfToken);
    }

    return header;
  }

  private decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private openWebSocket(clusterIndex = 0): void {
    const target = this.clusterList[clusterIndex];
    if (!target) {
      throw new Error('No Kick Pusher clusters available.');
    }

    const wsUrl = this.buildWsUrl(target);
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('Connected to Kick chat, subscribing...');
      this.subscribe();
    });

    this.ws.on('close', (code) => {
      console.warn(`WebSocket closed (${code}). Attempting reconnect...`);
      setTimeout(() => this.openWebSocket((clusterIndex + 1) % this.clusterList.length), 1500);
    });

    this.ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    this.listenForMessages(this.ws);
  }

  private buildWsUrl(target: string): string {
    if (target.startsWith('ws')) {
      return `${target}/app/${this.pusherKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
    }
    return `wss://ws-${target}.pusher.com/app/${this.pusherKey}?protocol=${PUSHER_PROTOCOL}&client=${PUSHER_CLIENT}&version=${PUSHER_VERSION}&flash=false`;
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.bindings.length) return;
    for (const binding of this.bindings) {
      this.subscribeBinding(binding);
    }
  }

  private subscribeBinding(binding: ChatroomInfo): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const channelId = this.chatroomKey(binding.chatroomId);
    const channels = [
      `chatrooms.${channelId}`,
      `chatrooms.${channelId}.v2`,
      `chatroom_${channelId}`,
    ];

    for (const channel of channels) {
      console.log(`Subscribing to ${channel}`);
      this.ws.send(
        JSON.stringify({
          event: 'pusher:subscribe',
          data: { channel, auth: '' },
        }),
      );
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

      if (message.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        return;
      }

      if (message.event === 'pusher:connection_established') {
        console.log('Pusher connection established');
        return;
      }

      if (message.event === 'pusher_internal:subscription_succeeded') {
        console.log('Subscription succeeded for channel:', message.channel || '(unknown)');
        return;
      }

      if (
        message.event === 'App\\Events\\ChatMessageEvent' ||
        message.event === 'App\\Events\\MessageSentEvent'
      ) {
        await this.processChatEvent(message);
      }
    });
  }

  private async processChatEvent(message: PusherMessage): Promise<void> {
    if (!this.botsByRoom.size) return;
    const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
    const content = data?.content ?? data?.message;
    const sender = data?.sender?.username || data?.senderUsername;
    const rawChatroom = data?.chatroom_id ?? this.parseChatroom(message.channel);
    const chatroomId =
      rawChatroom !== undefined && rawChatroom !== null ? Number(rawChatroom) : null;
    if (!content || !sender || chatroomId === null) return;
    const command = parseCommand(content);
    const chatroomKey = this.chatroomKey(chatroomId);
    const binding = this.botsByRoom.get(chatroomKey);
    if (this.config.logChatEvents) {
      console.log('[ROUTE]', chatroomKey, '→ bot exists:', Boolean(binding));
    }
    if (!binding) return;
    if (sender.toLowerCase() === this.config.botUsername.toLowerCase()) return;

    let handled = false;
    if (command?.name === 'join') {
      handled = await this.handleJoinCommand(command, binding, sender);
    } else if (command?.name === 'leave') {
      handled = await this.handleLeaveCommand(command, binding, sender);
    }

    if (handled) return;

    const ctx = {
      channel: binding.channel,
      username: sender,
      message: content,
      reply: async (text: string) => {
        try {
          await this.sendMessage(binding.chatroomId, text);
          console.log(
            `[BOT][#${binding.channel}] Replied to ${sender}: ${text} | Trigger: ${content}`,
          );
        } catch (err) {
          const status = (err as { response?: { status?: number } }).response?.status;
          const data = (err as { response?: { data?: unknown } }).response?.data;
          const message = (err as Error)?.message;
          console.error('Failed to send reply', { status, data, message, channel: binding.channel });
          if (this.isModRequiredError(err)) {
            await this.notifyModRequirement(binding);
          }
        }
      },
    };

    const plusHandled = await this.commandRegistry.handleMessage(ctx, ['+', '!']);
    if (plusHandled) return;

    if (this.config.logChatEvents) {
      console.log(`[CHAT EVENT][#${binding.channel}] ${sender}: ${content}`);
    }
  }

  private parseChatroom(channelName?: string | null): number | null {
    if (!channelName) return null;
    const match = channelName.match(/chatrooms\.(\d+)/) || channelName.match(/chatroom_(\d+)/);
    return match ? Number(match[1]) : null;
  }

  private chatroomKey(chatroomId: number): string {
    return String(chatroomId);
  }

  private addBindingToMemory(binding: ChatroomInfo): void {
    if (!binding.channel || !Number.isFinite(binding.chatroomId)) return;
    const channelSlug = binding.channel.trim();
    const normalized: ChatroomInfo = {
      channel: channelSlug,
      chatroomId: binding.chatroomId,
    };
    const key = this.chatroomKey(normalized.chatroomId);
    const existingIdx = this.bindings.findIndex(
      (entry) => entry.chatroomId === normalized.chatroomId,
    );
    if (existingIdx >= 0) {
      this.bindings[existingIdx] = normalized;
    } else {
      this.bindings.push(normalized);
    }
    this.botsByRoom.set(key, normalized);
  }

  private removeBinding(chatroomId: number): void {
    const key = this.chatroomKey(chatroomId);
    this.botsByRoom.delete(key);
    const idx = this.bindings.findIndex((entry) => entry.chatroomId === chatroomId);
    if (idx >= 0) {
      this.bindings.splice(idx, 1);
    }
  }

  private async sendMessage(chatroomId: number, content: string): Promise<void> {
    const url = `https://kick.com/api/v2/messages/send/${chatroomId}`;
    const payload = (text: string) => ({
      content: text,
      type: 'message',
    });

    await axios.post(
      url,
      payload(content),
      {
        headers: this.headers,
        withCredentials: true,
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
      },
    );
  }

  private async fetchChatroomInfo(): Promise<ChatroomInfo[]> {
    const stored = loadStoredChannels();
    let envChannels = this.config.channels;
    if (!envChannels.length) {
      const resolved = await this.fetchChannelInfo(this.config.channel);
      if (resolved) {
        envChannels = [resolved];
      } else {
        envChannels = [
          {
            channel: this.config.channel,
            chatroomId: FALLBACK_CHATROOM_ID,
          },
        ];
      }
    }
    const merged: StoredChannel[] = dedupeChannels([...stored, ...envChannels]);
    if (merged.length === 0) {
      console.warn('No channels available after merging stored and env config.');
    } else {
      console.log(`Loaded ${merged.length} channel mapping(s) from storage/env.`);
    }
    return merged.map((entry) => ({
      channel: entry.channel,
      chatroomId: entry.chatroomId,
    }));
  }

  private async fetchChannelInfo(username: string): Promise<ChatroomInfo | null> {
    if (!username || !username.trim()) return null;
    const slug = username.trim().toLowerCase();
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'kickmcsr-bot/1.0',
        },
      });
      if (!response.ok) {
        console.error('fetchChannelInfo failed for', slug, response.status);
        return null;
      }
      const data = (await response.json()) as any;
      const channelSlug = data?.slug || data?.username || slug;
      const chatroomId = Number(data?.chatroom?.id);
      if (!channelSlug || !Number.isFinite(chatroomId)) {
        return null;
      }
      return {
        channel: String(channelSlug),
        chatroomId,
      };
    } catch (err) {
      console.error('fetchChannelInfo failed for', slug, err);
      return null;
    }
  }

  private async handleJoinCommand(
    command: ParsedCommand,
    binding: ChatroomInfo,
    sender: string,
  ): Promise<boolean> {
    if (binding.channel.toLowerCase() !== this.homeChannel) {
      return false;
    }

    const targetArg = command.args?.[0]?.trim();
    const targetChannel = (targetArg || sender || '').trim().toLowerCase();
    if (!targetChannel) {
      await this.sendMessage(binding.chatroomId, 'Channel not found.');
      return true;
    }

    console.log('[JOIN REQUEST] sender =', sender, 'target =', targetChannel);
    const channelInfo = await this.fetchChannelInfo(targetChannel);
    if (!channelInfo) {
      await this.sendMessage(binding.chatroomId, 'Channel not found.');
      return true;
    }

    console.log('[JOIN RESULT] slug =', channelInfo.channel, 'chatroomId =', channelInfo.chatroomId);
    const chatroomKey = this.chatroomKey(channelInfo.chatroomId);
    if (this.botsByRoom.has(chatroomKey)) {
      await this.sendMessage(binding.chatroomId, 'This channel is already connected.');
      return true;
    }

    this.addBindingToMemory(channelInfo);
    saveStoredChannels(
      this.bindings.map((entry) => ({
        channel: entry.channel,
        chatroomId: entry.chatroomId,
      })),
    );

    console.log('[JOIN] Registered', channelInfo.channel, channelInfo.chatroomId);
    this.subscribeBinding(channelInfo);

    await this.sendMessage(
      binding.chatroomId,
      `Bot connected to ${channelInfo.channel}. You may now use commands there.`,
    );
    return true;
  }

  private async handleLeaveCommand(
    command: ParsedCommand,
    binding: ChatroomInfo,
    sender: string,
  ): Promise<boolean> {
    if (binding.channel.toLowerCase() !== this.homeChannel) {
      return false;
    }

    const targetArg = command.args?.[0]?.trim();
    const targetSlug = (targetArg || sender || '').trim().toLowerCase();
    if (!targetSlug) {
      await this.sendMessage(binding.chatroomId, 'This channel is not currently connected.');
      return true;
    }

    console.log('[LEAVE REQUEST] sender =', sender, 'target =', targetSlug);
    if (targetSlug === this.homeChannel) {
      await this.sendMessage(binding.chatroomId, 'The bot cannot leave its own channel.');
      return true;
    }

    const existing = this.bindings.find(
      (entry) => entry.channel.toLowerCase() === targetSlug.toLowerCase(),
    );
    if (!existing) {
      await this.sendMessage(binding.chatroomId, 'This channel is not currently connected.');
      return true;
    }

    this.removeBinding(existing.chatroomId);
    saveStoredChannels(
      this.bindings.map((entry) => ({
        channel: entry.channel,
        chatroomId: entry.chatroomId,
      })),
    );

    console.log('[LEAVE] Removed', existing.channel, existing.chatroomId);
    await this.sendMessage(binding.chatroomId, `Bot disconnected from ${existing.channel}.`);
    return true;
  }

  private isModRequiredError(err: unknown): boolean {
    const response = (err as { response?: { status?: number; data?: any } }).response;
    if (!response || response.status !== 400) return false;
    const statusMessage = response.data?.status?.message || response.data?.status?.code;
    if (typeof statusMessage === 'string') {
      return statusMessage.toUpperCase().includes('MAX_SPECIAL_CHARS');
    }
    if (typeof response.data?.message === 'string') {
      return response.data.message.toUpperCase().includes('MAX_SPECIAL_CHARS');
    }
    return false;
  }

  private async notifyModRequirement(binding: ChatroomInfo): Promise<void> {
    const notice = this.buildModInstruction(binding.channel);
    try {
      await this.sendMessage(binding.chatroomId, notice);
      console.log(`[MOD-NOTICE] Reminded #${binding.channel} to mod the bot.`);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const data = (err as { response?: { data?: unknown } }).response?.data;
      const message = (err as Error)?.message;
      console.error('Failed to send mod reminder', { status, data, message, channel: binding.channel });
    }
  }

  private buildModInstruction(channel: string): string {
    return `Please mod @${this.config.botUsername} in #${channel} to unlock the full command set.`;
  }
}
