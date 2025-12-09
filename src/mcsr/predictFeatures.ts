import { findEloChangeForPlayer, normalizeName, normalizeTimestampMs } from './api.js';

export interface PlayerMatchView {
  playedAt: number;
  isWin: boolean;
  eloDelta?: number;
  opponentEloAfter?: number;
  durationMs?: number;
}

export interface PlayerFeatureStats {
  player: string;
  sample: number;
  wins: number;
  losses: number;
  winRate: number;
  recencyWinRate?: number;
  totalEloDelta: number;
  avgEloDelta?: number;
  avgOpponentElo?: number;
  durations?: {
    averageWin?: number;
    bestWin?: number;
  };
  streak: {
    current: number;
    best: number;
  };
  newestMatchAt?: number;
  oldestMatchAt?: number;
}

export interface FeatureOptions {
  limit?: number;
  decayMs?: number;
  anchorMs?: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_DECAY_MS = 2 * 24 * 60 * 60 * 1000; // 48h half-life

export function computePlayerFeatures(
  matches: any[],
  playerName: string,
  options: FeatureOptions = {},
): PlayerFeatureStats | null {
  const targetNorm = normalizeName(playerName);
  if (!targetNorm) return null;
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const anchor = options.anchorMs ?? Date.now();
  const decayMs = Math.max(1, options.decayMs ?? DEFAULT_DECAY_MS);

  const views = normalizeMatchesForPlayer(matches, targetNorm).sort((a, b) => b.playedAt - a.playedAt);
  const trimmed = views.slice(0, limit);
  if (!trimmed.length) return null;

  let wins = 0;
  let losses = 0;
  let totalEloDelta = 0;
  let eloDeltaSamples = 0;
  let oppEloTotal = 0;
  let oppEloSamples = 0;
  const winDurations: number[] = [];

  let recencyWinWeighted = 0;
  let recencyWeight = 0;

  let currentStreak = 0;
  let bestStreak = 0;
  let rollingStreak = 0;
  let trackingCurrent = true;

  for (let index = 0; index < trimmed.length; index += 1) {
    const match = trimmed[index];
    const ageMs = Math.max(0, anchor - match.playedAt);
    const weight = Math.pow(0.5, ageMs / decayMs);

    if (match.isWin) {
      wins += 1;
      rollingStreak += 1;
      bestStreak = Math.max(bestStreak, rollingStreak);
      if (trackingCurrent) {
        currentStreak += 1;
      }
      if (Number.isFinite(match.durationMs)) {
        winDurations.push(Number(match.durationMs));
      }
      recencyWinWeighted += weight;
    } else {
      losses += 1;
      rollingStreak = 0;
      if (trackingCurrent) {
        trackingCurrent = false;
      }
    }
    recencyWeight += weight;

    if (Number.isFinite(match.eloDelta)) {
      totalEloDelta += Number(match.eloDelta);
      eloDeltaSamples += 1;
    }

    if (Number.isFinite(match.opponentEloAfter)) {
      oppEloTotal += Number(match.opponentEloAfter);
      oppEloSamples += 1;
    }
  }

  const sample = wins + losses;
  const winRate = sample > 0 ? wins / sample : 0;
  const recencyWinRate = recencyWeight > 0 ? recencyWinWeighted / recencyWeight : undefined;
  const avgEloDelta = eloDeltaSamples > 0 ? totalEloDelta / eloDeltaSamples : undefined;
  const avgOpponentElo = oppEloSamples > 0 ? oppEloTotal / oppEloSamples : undefined;
  const durations =
    winDurations.length > 0
      ? {
          averageWin: Math.round(winDurations.reduce((sum, v) => sum + v, 0) / winDurations.length),
          bestWin: Math.min(...winDurations),
        }
      : undefined;

  const newestMatchAt = trimmed[0]?.playedAt;
  const oldestMatchAt = trimmed[trimmed.length - 1]?.playedAt;

  return {
    player: playerName,
    sample,
    wins,
    losses,
    winRate,
    recencyWinRate,
    totalEloDelta,
    avgEloDelta,
    avgOpponentElo,
    durations,
    streak: {
      current: currentStreak,
      best: bestStreak,
    },
    newestMatchAt,
    oldestMatchAt,
  };
}

function normalizeMatchesForPlayer(matches: any[], targetNorm: string): PlayerMatchView[] {
  const normalized: PlayerMatchView[] = [];
  for (const raw of matches) {
    const mapped = mapMatchForPlayer(raw, targetNorm);
    if (mapped) {
      normalized.push(mapped);
    }
  }
  return normalized;
}

function mapMatchForPlayer(match: any, targetNorm: string): PlayerMatchView | null {
  if (!match || typeof match !== 'object') return null;
  const playedAt = normalizeTimestampMs(match.date ?? match.timestamp ?? match.played_at);
  if (playedAt === null) return null;

  const players: any[] = Array.isArray(match.players) ? match.players : [];
  const mapped = players.map((p) => ({
    uuid: p?.uuid ? String(p.uuid) : undefined,
    norm: normalizeName(p?.nickname || p?.name || p?.username || p?.id || p?.uuid),
    eloAfter: pickNumber(p?.eloRate, p?.elo_rate, p?.elo, p?.rating, p?.rank_score),
  }));

  const self = mapped.find((p) => p.norm === targetNorm || (p.uuid && normalizeName(p.uuid) === targetNorm));
  if (!self) return null;

  const opponent = mapped.find((p) => p !== self);
  const opponentEloAfter = opponent?.eloAfter;

  const winnerUuid = match?.result?.uuid ? String(match.result.uuid) : undefined;
  const eloDelta = findEloChangeForPlayer(match?.changes, self.uuid);
  const durationMs = pickNumber(match?.result?.time, match?.duration, match?.time, match?.result?.duration);

  let isWin: boolean | null = null;
  if (winnerUuid && self.uuid) {
    isWin = winnerUuid === self.uuid;
  } else if (Number.isFinite(eloDelta)) {
    if (Number(eloDelta) > 0) isWin = true;
    else if (Number(eloDelta) < 0) isWin = false;
  }

  if (isWin === null) return null;

  return {
    playedAt,
    isWin,
    eloDelta,
    opponentEloAfter,
    durationMs,
  };
}

function pickNumber(...values: Array<unknown>): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(num)) {
      return Number(num);
    }
  }
  return undefined;
}
