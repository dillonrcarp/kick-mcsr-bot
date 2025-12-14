import fs from 'node:fs';
import path from 'node:path';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface HealthSnapshot {
  appVersion: string;
  state: ConnectionState;
  status: 'ok' | 'degraded' | 'error';
  startedAt: number;
  lastHeartbeatAt: number;
  lastEventAt: number | null;
  lastMessageAt: number | null;
  lastConnectAttemptAt: number | null;
  lastConnectAt: number | null;
  lastErrorAt: number | null;
  reconnectAttempts: number;
  nextRetryInMs: number | null;
  stale: boolean;
  info?: string;
}

interface HealthOptions {
  appVersion: string;
  heartbeatMs?: number;
  staleAfterMs?: number;
  forceExitAfterMs?: number;
  healthFilePath?: string;
}

function ensureDataDir(): string {
  const dir = path.resolve('data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export class HealthMonitor {
  private readonly heartbeatMs: number;
  private readonly staleAfterMs: number;
  private readonly forceExitAfterMs: number;
  private readonly filePath: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private unhealthySince: number | null = null;
  private snapshot: HealthSnapshot;

  constructor(options: HealthOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 45000;
    this.staleAfterMs = options.staleAfterMs ?? 120000;
    this.forceExitAfterMs = options.forceExitAfterMs ?? 300000;
    const dir = ensureDataDir();
    this.filePath = options.healthFilePath || path.join(dir, 'health.json');
    const now = Date.now();
    this.snapshot = {
      appVersion: options.appVersion,
      state: 'idle',
      status: 'ok',
      startedAt: now,
      lastHeartbeatAt: now,
      lastEventAt: null,
      lastMessageAt: null,
      lastConnectAttemptAt: null,
      lastConnectAt: null,
      lastErrorAt: null,
      reconnectAttempts: 0,
      nextRetryInMs: null,
      stale: false,
      info: 'booting',
    };
  }

  start(): void {
    this.stop();
    this.writeSnapshot('health-monitor-start');
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  setConnectionState(state: ConnectionState, info?: string): void {
    const now = Date.now();
    this.snapshot.state = state;
    this.snapshot.info = info ?? this.snapshot.info;
    if (state === 'connected') {
      this.snapshot.lastConnectAt = now;
      this.snapshot.reconnectAttempts = 0;
      this.snapshot.nextRetryInMs = null;
      this.unhealthySince = null;
    }
    if (state === 'connecting' || state === 'reconnecting') {
      this.snapshot.lastConnectAttemptAt = now;
    }
    if (state === 'error') {
      this.snapshot.lastErrorAt = now;
      this.flagUnhealthy(now);
    }
    this.heartbeat(false);
  }

  markReconnect(attempt: number, nextRetryMs: number, info?: string): void {
    this.snapshot.reconnectAttempts = attempt;
    this.snapshot.nextRetryInMs = nextRetryMs;
    this.snapshot.info = info ?? this.snapshot.info;
    this.setConnectionState('reconnecting', info);
  }

  recordEvent(kind: 'message' | 'event'): void {
    const now = Date.now();
    this.snapshot.lastEventAt = now;
    if (kind === 'message') {
      this.snapshot.lastMessageAt = now;
    }
    this.snapshot.info = 'event-received';
    this.heartbeat(false);
  }

  recordError(info: string): void {
    const now = Date.now();
    this.snapshot.lastErrorAt = now;
    this.snapshot.info = info;
    this.setConnectionState('error', info);
    this.heartbeat(true);
  }

  isStale(now = Date.now()): boolean {
    const lastEvent = this.snapshot.lastEventAt ?? this.snapshot.startedAt;
    return now - lastEvent > this.staleAfterMs;
  }

  shouldForceExit(now = Date.now()): boolean {
    if (this.unhealthySince === null) return false;
    return now - this.unhealthySince >= this.forceExitAfterMs;
  }

  getSnapshot(): HealthSnapshot {
    return { ...this.snapshot };
  }

  private heartbeat(log = true): void {
    const now = Date.now();
    this.snapshot.lastHeartbeatAt = now;
    this.snapshot.stale = this.isStale(now);
    const disconnected =
      this.snapshot.state === 'disconnected' || this.snapshot.state === 'error';
    const degraded = this.snapshot.stale || disconnected;
    if (degraded) {
      this.flagUnhealthy(now);
    } else {
      this.unhealthySince = null;
    }
    const severe = this.snapshot.state === 'error' || this.shouldForceExit(now);
    this.snapshot.status = severe
      ? 'error'
      : degraded
        ? 'degraded'
        : 'ok';
    this.writeSnapshot();
    if (log) {
      console.log(
        `[HEARTBEAT] state=${this.snapshot.state} status=${this.snapshot.status}` +
          ` stale=${this.snapshot.stale} reconnects=${this.snapshot.reconnectAttempts}` +
          ` lastEvent=${this.describeAge(this.snapshot.lastEventAt)}` +
          ` lastMsg=${this.describeAge(this.snapshot.lastMessageAt)}`,
      );
    }
  }

  private flagUnhealthy(now: number): void {
    if (this.unhealthySince === null) {
      this.unhealthySince = now;
    }
  }

  private writeSnapshot(reason?: string): void {
    try {
      const payload = { ...this.snapshot, info: reason ?? this.snapshot.info };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error('Failed to write health snapshot', err);
    }
  }

  private describeAge(timestamp: number | null): string {
    if (!timestamp) return 'never';
    const diff = Date.now() - timestamp;
    if (diff < 0) return '0s';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m${remainingSeconds}s`;
  }
}
