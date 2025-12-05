import axios from 'axios';

const DEFAULT_BASE = 'https://mcsrranked.com/api';

function apiBase(): string {
  const configured = process.env.MCSR_API_BASE;
  const base = configured && configured.trim() ? configured : DEFAULT_BASE;
  return base.replace(/\/+$/, '');
}

export interface PlayerSummary extends Record<string, unknown> {
  nickname?: string;
  username?: string;
  name?: string;
  eloRate?: number;
  elo?: number;
  rating?: number;
  mmr?: number;
  peak_elo?: number;
  peakElo?: number;
  highest_elo?: number;
  eloRank?: number;
  global_rank?: number;
  rank?: number;
  position?: number;
  leaderboard_rank?: number;
  overall_rank?: number;
  statistics?: Record<string, any>;
}

export async function getPlayerSummary(username: string): Promise<PlayerSummary | null> {
  if (!username) return null;
  const url = `${apiBase()}/users/${encodeURIComponent(username)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return payload as PlayerSummary;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

export interface WeeklyRaceEntry {
  raceId: number;
  raceNumber: number;
  playerName: string;
  playerRank?: number;
  playerTimeMs?: number;
  leaderName?: string;
  leaderTimeMs?: number;
  timeRemainingMs?: number;
}

export async function getWeeklyRace(username: string): Promise<WeeklyRaceEntry | null> {
  if (!username) return null;
  const slug = username.trim();
  const url = `${apiBase()}/weekly-race/${encodeURIComponent(slug)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return {
      raceId: numberOrUndefined(payload.race_id) ?? 0,
      raceNumber: numberOrUndefined(payload.race_number) ?? numberOrUndefined(payload.raceId) ?? 0,
      playerName: payload.player_name || payload.playerName || slug,
      playerRank: numberOrUndefined(payload.player_rank ?? payload.rank),
      playerTimeMs: numberOrUndefined(payload.player_time_ms ?? payload.playerTime),
      leaderName: payload.leader_name || payload.leaderName,
      leaderTimeMs: numberOrUndefined(payload.leader_time_ms ?? payload.leaderTime),
      timeRemainingMs: numberOrUndefined(payload.time_remaining_ms ?? payload.timeRemaining),
    };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

export interface LastMatchEntry {
  playedAt?: number;
  seedType?: string;
  playerA?: PlayerMatchStats;
  playerB?: PlayerMatchStats;
  winner?: 'A' | 'B' | null;
  matchNumber?: number;
  durationMs?: number;
}

export interface PlayerMatchStats {
  name: string;
  rank?: number;
  eloBefore?: number;
  eloAfter?: number;
}

export async function getLastMatch(username: string): Promise<LastMatchEntry | null> {
  if (!username) return null;
  const slug = username.trim();
  // Use the per-user matches endpoint to ensure we only get this player's games.
  const url = `${apiBase()}/users/${encodeURIComponent(slug)}/matches?limit=3`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!Array.isArray(payload) || payload.length === 0) return null;
    const match = payload[0];
    if (!match) return null;

    // Newer match format: players array with changes
    if (Array.isArray(match.players) && match.players.length >= 2) {
      const changeMap = new Map<string, { after?: number; delta?: number }>();
      if (Array.isArray(match.changes)) {
        for (const entry of match.changes) {
          const uuid = entry?.uuid;
          if (!uuid) continue;
          const after = numberOrUndefined(entry.eloRate ?? entry.elo);
          const delta = numberOrUndefined(entry.change ?? entry.delta);
          changeMap.set(String(uuid), { after, delta });
        }
      }

      const normalize = (player: any): PlayerMatchStats => {
        const uuid = player?.uuid ? String(player.uuid) : undefined;
        const change = uuid ? changeMap.get(uuid) : undefined;
        const after = change?.after ?? numberOrUndefined(player.eloRate ?? player.elo_rate);
        const delta = change?.delta;
        const before =
          Number.isFinite(after) && Number.isFinite(delta) ? Number(after) - Number(delta) : undefined;
        return {
          name: player?.nickname || player?.name || player?.username || slug,
          rank: numberOrUndefined(player?.eloRank ?? player?.rank ?? player?.player_rank),
          eloBefore: before,
          eloAfter: after,
        };
      };

      const [p1, p2] = match.players;
      const playerA = normalize(p1);
      const playerB = normalize(p2);

      const winnerUuid = match.result?.uuid ? String(match.result.uuid) : null;
      let winner: 'A' | 'B' | null = null;
      if (winnerUuid) {
        if (p1?.uuid && String(p1.uuid) === winnerUuid) winner = 'A';
        else if (p2?.uuid && String(p2.uuid) === winnerUuid) winner = 'B';
      }

      const ts =
        numberOrUndefined(match.date ?? match.timestamp ?? match.played_at) ?? Date.now();
      const playedAt = ts < 1e12 ? ts * 1000 : ts; // convert seconds to ms if needed

      return {
        playedAt,
        seedType: match.seedType || match.seed_type || match.seed?.overworld || match.seed?.id,
        playerA,
        playerB,
        winner,
        matchNumber: numberOrUndefined(match.match_number ?? match.id),
        durationMs: numberOrUndefined(match.result?.time ?? match.duration ?? match.time),
      };
    }

    // Legacy match format fallback
    const playerA = normalizeMatchPlayer(match.player_a || match.playerA || {});
    const playerB = normalizeMatchPlayer(match.player_b || match.playerB || {});
    return {
      playedAt: numberOrUndefined(match.timestamp) ?? numberOrUndefined(match.played_at) ?? Date.now(),
      seedType: match.seed_type || match.seedType,
      playerA,
      playerB,
      winner: normalizeWinner(match.winner),
      matchNumber: numberOrUndefined(match.match_number ?? match.id),
      durationMs: numberOrUndefined(match.time ?? match.duration),
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

function normalizeMatchPlayer(data: Record<string, any>): PlayerMatchStats {
  return {
    name: data.player_name || data.playerName || data.name || 'Unknown',
    rank: numberOrUndefined(data.player_rank ?? data.rank),
    eloBefore: numberOrUndefined(data.player_elo_before ?? data.elo_before ?? data.eloBefore),
    eloAfter: numberOrUndefined(data.player_elo_after ?? data.elo_after ?? data.eloAfter),
  };
}

function normalizeWinner(value: unknown): 'A' | 'B' | null {
  if (!value) return null;
  const str = String(value).toUpperCase();
  if (str === 'A' || str === 'B') return str;
  return null;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? Number(num) : undefined;
}

function parseHeadToHeadPayload(payload: any): HeadToHeadStats | null {
  if (!payload) return null;

  let winsOne = 0;
  let winsTwo = 0;
  let draws = 0;
  let lastMatchAt: number | undefined;

  const history = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload) ? payload : [];
  if (history.length > 0) {
    for (const match of history) {
      const winner = normalizeWinner(match.winner);
      if (winner === 'A') {
        winsOne += 1;
      } else if (winner === 'B') {
        winsTwo += 1;
      } else {
        draws += 1;
      }
      const ts = numberOrUndefined(match.timestamp ?? match.played_at);
      if (ts) {
        lastMatchAt = lastMatchAt ? Math.max(lastMatchAt, ts) : ts;
      }
    }
  } else {
    winsOne = numberOrUndefined(payload.wins_p1 ?? payload.player1_wins) ?? 0;
    winsTwo = numberOrUndefined(payload.wins_p2 ?? payload.player2_wins) ?? 0;
    draws = numberOrUndefined(payload.draws) ?? 0;
    lastMatchAt = numberOrUndefined(payload.last_match_timestamp ?? payload.lastMatchTimestamp);
  }

  const totalMatches =
    numberOrUndefined(payload.total_matches ?? payload.totalMatches) ??
    winsOne + winsTwo + draws;

  if (totalMatches === 0) {
    return null;
  }

  return {
    playerOne: '',
    playerTwo: '',
    winsOne,
    winsTwo,
    draws,
    totalMatches,
    lastMatchAt,
  };
}

export interface HeadToHeadStats {
  playerOne: string;
  playerTwo: string;
  winsOne: number;
  winsTwo: number;
  draws: number;
  totalMatches: number;
  lastMatchAt?: number;
}

export async function getHeadToHead(playerOne: string, playerTwo: string): Promise<HeadToHeadStats | null> {
  if (!playerOne || !playerTwo) return null;
  const p1 = playerOne.trim();
  const p2 = playerTwo.trim();
  const url = `${apiBase()}/matches/head-to-head?player1=${encodeURIComponent(p1)}&player2=${encodeURIComponent(p2)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    const parsed = parseHeadToHeadPayload(payload);
    if (parsed) {
      return {
        ...parsed,
        playerOne: p1,
        playerTwo: p2,
      };
    }
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // For validation errors, fall back to local aggregation.
    if (status === 404) return null;
    if (status && status !== 400 && status !== 422) throw err;
  }

  // Fallback: aggregate from recent matches.
  return await computeHeadToHeadFromMatches(p1, p2);
}

async function computeHeadToHeadFromMatches(playerOne: string, playerTwo: string, limit = 100): Promise<HeadToHeadStats | null> {
  // Use the per-user matches endpoint to ensure we only consider games involving playerOne,
  // then filter for games where playerTwo is also present.
  const matches = await fetchUserMatches(playerOne, limit);
  if (!matches.length) return null;

  const a = normalizeName(playerOne);
  const b = normalizeName(playerTwo);
  let winsOne = 0;
  let winsTwo = 0;
  let draws = 0;
  let lastMatchAt: number | undefined;

  for (const match of matches) {
    const players: any[] = Array.isArray(match.players) ? match.players : [];
    if (players.length < 2) continue;

    const mapped = players.map((p) => ({
      raw: p,
      name: normalizeName(p.nickname || p.name || p.username),
    }));
    const hasA = mapped.some((p) => p.name === a);
    const hasB = mapped.some((p) => p.name === b);
    if (!hasA || !hasB) continue;

    const winnerUuid = match.result?.uuid ? String(match.result.uuid) : null;
    const pA = mapped.find((p) => p.name === a)?.raw;
    const pB = mapped.find((p) => p.name === b)?.raw;
    if (winnerUuid && pA?.uuid && String(pA.uuid) === winnerUuid) winsOne += 1;
    else if (winnerUuid && pB?.uuid && String(pB.uuid) === winnerUuid) winsTwo += 1;
    else draws += 1;

    const ts = numberOrUndefined(match.date ?? match.timestamp ?? match.played_at);
    if (ts) {
      const ms = ts < 1e12 ? ts * 1000 : ts;
      lastMatchAt = lastMatchAt ? Math.max(lastMatchAt, ms) : ms;
    }
  }

  const totalMatches = winsOne + winsTwo + draws;
  if (totalMatches === 0) return null;

  return {
    playerOne,
    playerTwo,
    winsOne,
    winsTwo,
    draws,
    totalMatches,
    lastMatchAt,
  };
}

async function fetchUserMatches(player: string, limit = 200): Promise<any[]> {
  const slug = player.trim();
  if (!slug) return [];
  const url = `${apiBase()}/users/${encodeURIComponent(slug)}/matches?limit=${limit}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  const payload = data?.data ?? data;
  return Array.isArray(payload) ? payload : [];
}

function normalizeName(name: unknown): string {
  return String(name || '').trim().toLowerCase();
}

function matchIncludesPlayer(match: any, target: string): boolean {
  const inPlayers = Array.isArray(match?.players)
    ? match.players.some(
        (p: any) =>
          normalizeName(p?.nickname || p?.name || p?.username) === target ||
          (p?.uuid && String(p.uuid).toLowerCase() === target),
      )
    : false;

  const legacyPlayers =
    normalizeName(match?.player_a?.player_name || match?.player_a?.name) === target ||
    normalizeName(match?.player_b?.player_name || match?.player_b?.name) === target;

  return inPlayers || legacyPlayers;
}

export interface PlayerRecord {
  wins: number;
  losses: number;
  matches: number;
  ffr?: number;
}

export async function getPlayerRecord(username: string): Promise<PlayerRecord | null> {
  if (!username) return null;
  const slug = username.trim();
  const url = `${apiBase()}/users/${encodeURIComponent(slug)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') return null;
    const statsRoot =
      payload.statistics?.season ||
      payload.statistics?.total ||
      payload.statistics ||
      {};
    const wins = numberOrUndefined(statsRoot?.wins?.ranked ?? statsRoot?.wins ?? statsRoot?.totalWins) ?? 0;
    const losses =
      numberOrUndefined(
        statsRoot?.loses?.ranked ?? statsRoot?.losses?.ranked ?? statsRoot?.losses ?? statsRoot?.loses ?? statsRoot?.totalLosses,
      ) ?? 0;
    const forfeits =
      numberOrUndefined(
        statsRoot?.forfeits?.ranked ?? statsRoot?.forfeits ?? statsRoot?.totalForfeits ?? statsRoot?.ff,
      ) ?? 0;
    const matchesField =
      numberOrUndefined(
        statsRoot?.playedMatches?.ranked ??
          statsRoot?.matches?.ranked ??
          statsRoot?.playedMatches ??
          statsRoot?.matches,
      );
    const matches = matchesField ?? wins + losses + forfeits;
    const ffr = matches > 0 ? (forfeits / matches) * 100 : undefined;
    return {
      wins,
      losses,
      matches,
      ffr,
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

export interface PlayerAverage {
  player: string;
  averageMs: number;
  personalBestMs: number;
  finishes: number;
  ffr?: number;
}

export async function getPlayerAverage(username: string): Promise<PlayerAverage | null> {
  if (!username) return null;
  const slug = username.trim();
  const url = `${apiBase()}/users/${encodeURIComponent(slug)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') return null;
    const statsRoot = payload.statistics?.total || payload.statistics || {};
    const completionAggregate = numberOrUndefined(
      statsRoot?.completionTime?.ranked ??
        statsRoot?.completionTime ??
        statsRoot?.totalCompletionTime ??
        statsRoot?.total_completion_time,
    );
    const avgProvided = numberOrUndefined(
      statsRoot?.avgCompletionTime?.ranked ?? statsRoot?.avgCompletionTime ?? statsRoot?.averageCompletionTime,
    );
    const completions =
      numberOrUndefined(
        statsRoot?.completions?.ranked ??
          statsRoot?.completions ??
          statsRoot?.completedRuns ??
          statsRoot?.totalCompletions,
      ) ?? 0;

    let averageMs = 0;
    if (Number.isFinite(avgProvided)) {
      averageMs = Number(avgProvided);
    } else if (Number.isFinite(completionAggregate) && completions > 0) {
      averageMs = Number(completionAggregate) / completions;
    }

    const personalBestMs = numberOrUndefined(
      statsRoot?.bestTime?.ranked ??
        statsRoot?.bestTime ??
        statsRoot?.best_time ??
        statsRoot?.recordTime ??
        statsRoot?.record_time ??
        statsRoot?.fastestTime?.ranked ??
        statsRoot?.fastestTime ??
        statsRoot?.fastest_time ??
        statsRoot?.personalBest ??
        statsRoot?.personal_best,
    ) ?? 0;

    const forfeits =
      numberOrUndefined(
        statsRoot?.forfeits?.ranked ?? statsRoot?.forfeits ?? statsRoot?.totalForfeits ?? statsRoot?.ff,
      ) ?? 0;
    const matchesField =
      numberOrUndefined(
        statsRoot?.playedMatches?.ranked ??
          statsRoot?.matches?.ranked ??
          statsRoot?.playedMatches ??
          statsRoot?.matches,
      );
    const matches = matchesField ?? completions + forfeits;
    const ffr = matches > 0 ? (forfeits / matches) * 100 : undefined;

    return {
      player: payload.nickname || payload.username || payload.name || slug,
      averageMs,
      personalBestMs,
      finishes: completions,
      ffr,
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}
