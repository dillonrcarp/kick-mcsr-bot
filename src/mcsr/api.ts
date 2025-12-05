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
    if (status === 404 || status === 400 || status === 422) {
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
  const perUserUrl = `${apiBase()}/users/${encodeURIComponent(slug)}/matches?limit=3`;
  try {
    const { data } = await axios.get(perUserUrl, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!Array.isArray(payload) || payload.length === 0) return null;
    const match = payload[0];
    if (!match) return null;

    const normalized = normalizeMatchPayload(match, slug);
    if (normalized && hasMeaningfulPlayers(normalized)) {
      return normalized;
    }

    const legacyMatch = await fetchLegacyMatch(slug);
    if (legacyMatch) {
      const fallback = normalizeMatchPayload(legacyMatch, slug);
      if (fallback && hasMeaningfulPlayers(fallback)) {
        return fallback;
      }
    }

    return normalized;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

function hasMeaningfulPlayers(entry: LastMatchEntry | null): entry is LastMatchEntry {
  if (!entry || !entry.playerA || !entry.playerB) return false;
  const hasName = (player: PlayerMatchStats | undefined): boolean =>
    Boolean(player && player.name && player.name !== 'Unknown');
  return hasName(entry.playerA) && hasName(entry.playerB);
}

function normalizeMatchPayload(match: any, slug: string): LastMatchEntry | null {
  if (!match) return null;

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

    const ts = numberOrUndefined(match.date ?? match.timestamp ?? match.played_at) ?? Date.now();
    const playedAt = ts < 1e12 ? ts * 1000 : ts;

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

  const playerA = normalizeLegacyMatchPlayer(match, 'A', slug);
  const playerB = normalizeLegacyMatchPlayer(match, 'B');
  return {
    playedAt: numberOrUndefined(match.timestamp) ?? numberOrUndefined(match.played_at) ?? Date.now(),
    seedType: match.seed_type || match.seedType,
    playerA,
    playerB,
    winner: normalizeWinner(match.winner),
    matchNumber: numberOrUndefined(match.match_number ?? match.id),
    durationMs: numberOrUndefined(match.time ?? match.duration),
  };
}

async function fetchLegacyMatch(username: string): Promise<any | null> {
  const url = `${apiBase()}/matches?player=${encodeURIComponent(username)}&limit=1`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!Array.isArray(payload) || payload.length === 0) return null;
    return payload[0];
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

function normalizeMatchPlayer(data: Record<string, any>, fallbackName?: string): PlayerMatchStats {
  const nested =
    (typeof data.player === 'object' && data.player) ||
    (typeof data.user === 'object' && data.user) ||
    (typeof data.profile === 'object' && data.profile) ||
    null;

  const name =
    pickString(
      data.player_name,
      data.playerName,
      data.nickname,
      data.username,
      data.name,
      nested?.player_name,
      nested?.playerName,
      nested?.nickname,
      nested?.username,
      nested?.name,
      fallbackName,
    ) ?? 'Unknown';

  const rank = pickNumber(
    data.player_rank,
    data.rank,
    data.eloRank,
    nested?.player_rank,
    nested?.rank,
    nested?.eloRank,
  );

  const delta = pickNumber(
    data.elo_change,
    data.change,
    data.delta,
    nested?.elo_change,
    nested?.change,
    nested?.delta,
  );

  let eloBefore = pickNumber(
    data.player_elo_before,
    data.elo_before,
    data.eloBefore,
    data.elo_start,
    data.eloStart,
    nested?.player_elo_before,
    nested?.elo_before,
    nested?.eloBefore,
    nested?.elo_start,
    nested?.eloStart,
  );

  let eloAfter = pickNumber(
    data.player_elo_after,
    data.elo_after,
    data.eloAfter,
    data.elo_end,
    data.eloEnd,
    data.eloRate,
    data.elo,
    nested?.player_elo_after,
    nested?.elo_after,
    nested?.eloAfter,
    nested?.elo_end,
    nested?.eloEnd,
    nested?.eloRate,
    nested?.elo,
  );

  if (eloBefore === undefined && eloAfter !== undefined && delta !== undefined) {
    eloBefore = eloAfter - delta;
  } else if (eloAfter === undefined && eloBefore !== undefined && delta !== undefined) {
    eloAfter = eloBefore + delta;
  }

  return {
    name,
    rank,
    eloBefore,
    eloAfter,
  };
}

function normalizeLegacyMatchPlayer(match: Record<string, any>, side: 'A' | 'B', fallbackName?: string): PlayerMatchStats {
  const candidateKeys =
    side === 'A'
      ? ['player_a', 'playerA', 'player1', 'player_one', 'playerOne', 'player', 'user', 'profile', 'self', 'subject']
      : [
          'player_b',
          'playerB',
          'player2',
          'player_two',
          'playerTwo',
          'opponent',
          'opponent_player',
          'opponentPlayer',
          'opponentUser',
          'opponent_user',
          'enemy',
          'versus',
          'vs',
        ];

  const data: Record<string, any> = {};
  let inlineName: string | undefined;

  for (const key of candidateKeys) {
    const value = match?.[key];
    if (!value) continue;
    if (typeof value === 'object') {
      Object.assign(data, value);
    } else if (typeof value === 'string' && !inlineName) {
      inlineName = value;
    }
  }

  const index = side === 'A' ? '1' : '2';
  const word = side === 'A' ? 'one' : 'two';
  const camel = side === 'A' ? 'One' : 'Two';
  const short = side === 'A' ? 'p1' : 'p2';

  const resolvedName = pickString(
    data.player_name,
    data.playerName,
    inlineName,
    match?.[`player${index}_name`],
    match?.[`player_${word}_name`],
    match?.[`player${camel}Name`],
    match?.[`player${index}`],
    match?.[`player_${word}`],
    match?.[`player${camel}`],
    match?.[`Player${index}`],
    side === 'A' ? match?.player_name ?? match?.playerName ?? match?.subject_name ?? match?.subjectName : undefined,
    side === 'B'
      ? match?.opponent_name ??
        match?.opponentName ??
        match?.enemy_name ??
        match?.enemyName ??
        match?.versus_name ??
        match?.versusName ??
        match?.vs_name ??
        match?.vsName
      : undefined,
    fallbackName,
  );
  if (resolvedName) data.player_name = resolvedName;

  const resolvedRank = pickNumber(
    data.player_rank,
    data.rank,
    match?.[`player${index}_rank`],
    match?.[`player_${word}_rank`],
    match?.[`player${camel}Rank`],
    match?.[`Player${index}Rank`],
    side === 'A' ? match?.player_rank ?? match?.playerRank ?? match?.subject_rank ?? match?.subjectRank : undefined,
    side === 'B'
      ? match?.opponent_rank ?? match?.opponentRank ?? match?.enemy_rank ?? match?.enemyRank
      : undefined,
  );
  if (resolvedRank !== undefined) data.player_rank = resolvedRank;

  const resolvedBefore = pickNumber(
    data.player_elo_before,
    data.elo_before,
    data.eloBefore,
    match?.[`player${index}_elo_before`],
    match?.[`player_${word}_elo_before`],
    match?.[`player${camel}EloBefore`],
    match?.[`player${camel}BeforeElo`],
    match?.[`player${index}EloBefore`],
    match?.[`player_${word}EloBefore`],
    match?.[`p${index}_elo_before`],
    match?.[`${short}_elo_before`],
    side === 'A'
      ? match?.player_elo_before ??
        match?.playerEloBefore ??
        match?.subject_elo_before ??
        match?.subjectEloBefore ??
        match?.elo_before ??
        match?.eloBefore
      : undefined,
    side === 'B'
      ? match?.opponent_elo_before ??
        match?.opponentEloBefore ??
        match?.enemy_elo_before ??
        match?.enemyEloBefore ??
        match?.vs_elo_before ??
        match?.versus_elo_before
      : undefined,
  );
  if (resolvedBefore !== undefined) data.player_elo_before = resolvedBefore;

  const resolvedAfter = pickNumber(
    data.player_elo_after,
    data.elo_after,
    data.eloAfter,
    match?.[`player${index}_elo_after`],
    match?.[`player_${word}_elo_after`],
    match?.[`player${camel}EloAfter`],
    match?.[`player${index}_elo`],
    match?.[`player_${word}_elo`],
    match?.[`player${camel}Elo`],
    match?.[`p${index}_elo_after`],
    match?.[`p${index}_elo`],
    match?.[`${short}_elo_after`],
    match?.[`${short}_elo`],
    side === 'A'
      ? match?.player_elo_after ??
        match?.playerEloAfter ??
        match?.subject_elo_after ??
        match?.subjectEloAfter ??
        match?.elo_after ??
        match?.eloAfter ??
        match?.player_elo ??
        match?.playerElo
      : undefined,
    side === 'B'
      ? match?.opponent_elo_after ??
        match?.opponentEloAfter ??
        match?.enemy_elo_after ??
        match?.enemyEloAfter ??
        match?.vs_elo_after ??
        match?.versus_elo_after ??
        match?.opponent_elo ??
        match?.opponentElo
      : undefined,
  );
  if (resolvedAfter !== undefined) {
    data.player_elo_after = resolvedAfter;
    if (data.elo_after === undefined) data.elo_after = resolvedAfter;
    if (data.elo === undefined) data.elo = resolvedAfter;
  }

  const resolvedChange = pickNumber(
    data.elo_change,
    data.change,
    data.delta,
    match?.[`player${index}_elo_change`],
    match?.[`player_${word}_elo_change`],
    match?.[`player${camel}EloChange`],
    match?.[`p${index}_elo_change`],
    match?.[`${short}_elo_change`],
    side === 'A'
      ? match?.player_elo_change ??
        match?.playerEloChange ??
        match?.elo_change ??
        match?.eloChange ??
        match?.subject_elo_change ??
        match?.subjectEloChange
      : undefined,
    side === 'B'
      ? match?.opponent_elo_change ??
        match?.opponentEloChange ??
        match?.enemy_elo_change ??
        match?.enemyEloChange
      : undefined,
  );
  if (resolvedChange !== undefined && data.change === undefined) {
    data.change = resolvedChange;
  }

  return normalizeMatchPlayer(data, resolvedName ?? fallbackName);
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function pickNumber(...values: Array<unknown>): number | undefined {
  for (const value of values) {
    const num = numberOrUndefined(value);
    if (num !== undefined) {
      return num;
    }
  }
  return undefined;
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

function parseHeadToHeadPayload(payload: any, fallbackOne?: string, fallbackTwo?: string): HeadToHeadStats | null {
  if (!payload) return null;

  let winsOne = 0;
  let winsTwo = 0;
  let draws = 0;
  let lastMatchAt: number | undefined;
  let displayOne = fallbackOne;
  let displayTwo = fallbackTwo;

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
      const nameA =
        match.player_a?.player_name ??
        match.player_a?.name ??
        match.playerA?.player_name ??
        match.playerA?.name ??
        match.player1 ??
        match.player_one ??
        match.playerOne;
      const nameB =
        match.player_b?.player_name ??
        match.player_b?.name ??
        match.playerB?.player_name ??
        match.playerB?.name ??
        match.player2 ??
        match.player_two ??
        match.playerTwo;
      if (!displayOne && nameA) displayOne = String(nameA);
      if (!displayTwo && nameB) displayTwo = String(nameB);

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
    displayOne =
      payload.player1_name ??
      payload.player_one_name ??
      payload.playerOneName ??
      payload.player1 ??
      payload.player_one ??
      payload.playerOne ??
      displayOne;
    displayTwo =
      payload.player2_name ??
      payload.player_two_name ??
      payload.playerTwoName ??
      payload.player2 ??
      payload.player_two ??
      payload.playerTwo ??
      displayTwo;
  }

  const totalMatches =
    numberOrUndefined(payload.total_matches ?? payload.totalMatches) ??
    winsOne + winsTwo + draws;

  if (totalMatches === 0) {
    return null;
  }

  return {
    playerOne: fallbackOne ?? '',
    playerTwo: fallbackTwo ?? '',
    playerOneName: displayOne,
    playerTwoName: displayTwo,
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
  playerOneName?: string;
  playerTwoName?: string;
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

  // Preferred: use the documented versus endpoints first.
  const versusMatches = await computeHeadToHeadFromVersusMatches(p1, p2);
  if (versusMatches) return versusMatches;

  const versusStats = await fetchVersusStats(p1, p2);
  if (versusStats) return versusStats;

  const url = `${apiBase()}/matches/head-to-head?player1=${encodeURIComponent(p1)}&player2=${encodeURIComponent(p2)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    const parsed = parseHeadToHeadPayload(payload, p1, p2);
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

async function computeHeadToHeadFromVersusMatches(playerOne: string, playerTwo: string, count = 100): Promise<HeadToHeadStats | null> {
  const url = `${apiBase()}/users/${encodeURIComponent(playerOne)}/versus/${encodeURIComponent(playerTwo)}/matches?count=${count}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    const history: any[] = Array.isArray(payload) ? payload : [];
    if (!history.length) return null;

    const aNorm = normalizeName(playerOne);
    const bNorm = normalizeName(playerTwo);
    let winsOne = 0;
    let winsTwo = 0;
    let draws = 0;
    let lastMatchAt: number | undefined;
    let displayOne: string | undefined;
    let displayTwo: string | undefined;

    for (const match of history) {
      const players: any[] = Array.isArray(match.players) ? match.players : [];
      const pA = players.find((p) => normalizeName(p?.nickname || p?.name || p?.username) === aNorm);
      const pB = players.find((p) => normalizeName(p?.nickname || p?.name || p?.username) === bNorm);
      if (!pA || !pB) continue;
      if (!displayOne && (pA.nickname || pA.name || pA.username)) displayOne = pA.nickname || pA.name || pA.username;
      if (!displayTwo && (pB.nickname || pB.name || pB.username)) displayTwo = pB.nickname || pB.name || pB.username;

      const winnerUuid = match.result?.uuid ? String(match.result.uuid) : null;
      if (winnerUuid && pA.uuid && String(pA.uuid) === winnerUuid) winsOne += 1;
      else if (winnerUuid && pB.uuid && String(pB.uuid) === winnerUuid) winsTwo += 1;
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
      playerOneName: displayOne ?? playerOne,
      playerTwoName: displayTwo ?? playerTwo,
      winsOne,
      winsTwo,
      draws,
      totalMatches,
      lastMatchAt,
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 400) return null;
    throw err;
  }
}

async function fetchVersusStats(playerOne: string, playerTwo: string): Promise<HeadToHeadStats | null> {
  const url = `${apiBase()}/users/${encodeURIComponent(playerOne)}/versus/${encodeURIComponent(playerTwo)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    const players: any[] = Array.isArray(payload?.players) ? payload.players : [];
    const aNorm = normalizeName(playerOne);
    const bNorm = normalizeName(playerTwo);
    const pA = players.find((p) => normalizeName(p?.nickname || p?.name || p?.username || p?.uuid) === aNorm);
    const pB = players.find((p) => normalizeName(p?.nickname || p?.name || p?.username || p?.uuid) === bNorm);
    const rankedResults = payload?.results?.ranked ?? payload?.results ?? {};
    const winsOne = numberOrUndefined(pA ? rankedResults?.[pA.uuid] : undefined) ?? 0;
    const winsTwo = numberOrUndefined(pB ? rankedResults?.[pB.uuid] : undefined) ?? 0;
    const totalMatches = numberOrUndefined(rankedResults?.total) ?? winsOne + winsTwo;
    if (totalMatches === 0) return null;
    return {
      playerOne,
      playerTwo,
      playerOneName: pA?.nickname || pA?.name || pA?.username || playerOne,
      playerTwoName: pB?.nickname || pB?.name || pB?.username || playerTwo,
      winsOne,
      winsTwo,
      draws: 0,
      totalMatches,
    };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 400) return null;
    throw err;
  }
}

async function computeHeadToHeadFromMatches(playerOne: string, playerTwo: string, limit = 300): Promise<HeadToHeadStats | null> {
  // Pull matches for both players, dedupe, then filter for games involving both.
  const matchesOne = await fetchUserMatches(playerOne, limit);
  const matchesTwo = await fetchUserMatches(playerTwo, limit);
  const combined: any[] = [];
  const seen = new Set<string>();

  for (const match of [...matchesOne, ...matchesTwo]) {
    const key = buildMatchKey(match);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    combined.push(match);
  }

  if (!combined.length) return null;

  const a = normalizeName(playerOne);
  const b = normalizeName(playerTwo);
  let winsOne = 0;
  let winsTwo = 0;
  let draws = 0;
  let lastMatchAt: number | undefined;
  let displayOne: string | undefined;
  let displayTwo: string | undefined;

  for (const match of combined) {
    const players: any[] = Array.isArray(match.players) ? match.players : [];
    if (players.length < 2) continue;

    const mapped = players.map((p) => ({
      raw: p,
      name: normalizeName(p.nickname || p.name || p.username),
      display: p.nickname || p.name || p.username,
    }));
    const hasA = mapped.some((p) => p.name === a);
    const hasB = mapped.some((p) => p.name === b);
    if (!hasA || !hasB) continue;

    const winnerUuid = match.result?.uuid ? String(match.result.uuid) : null;
    const pA = mapped.find((p) => p.name === a);
    const pB = mapped.find((p) => p.name === b);
    if (!displayOne && pA?.display) displayOne = String(pA.display);
    if (!displayTwo && pB?.display) displayTwo = String(pB.display);
    const pARaw = pA?.raw;
    const pBRaw = pB?.raw;
    if (winnerUuid && pARaw?.uuid && String(pARaw.uuid) === winnerUuid) winsOne += 1;
    else if (winnerUuid && pBRaw?.uuid && String(pBRaw.uuid) === winnerUuid) winsTwo += 1;
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
    playerOneName: displayOne ?? playerOne,
    playerTwoName: displayTwo ?? playerTwo,
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

  const collected: any[] = [];
  const pageSize = 20;
  let offset = 0;

  while (collected.length < limit) {
    const url = `${apiBase()}/users/${encodeURIComponent(slug)}/matches?limit=${pageSize}&offset=${offset}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    const page = Array.isArray(payload) ? payload : [];
    if (!page.length) break;
    collected.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return collected.slice(0, limit);
}

function normalizeName(name: unknown): string {
  return String(name || '').trim().toLowerCase();
}

function buildMatchKey(match: any): string | null {
  if (!match || typeof match !== 'object') return null;
  const byId = match.id ?? match.match_id ?? match.matchId ?? match.uuid;
  if (byId !== undefined && byId !== null) return `id:${String(byId)}`;
  const ts = match.date ?? match.timestamp ?? match.played_at;
  const tsPart = ts !== undefined && ts !== null ? String(ts) : '';
  const players = Array.isArray(match.players)
    ? match.players
        .map((p: any) => normalizeName(p?.nickname || p?.name || p?.username || p?.uuid))
        .sort()
        .join(',')
    : '';
  const seed = `${tsPart}|${players}`;
  return seed ? `seed:${seed}` : null;
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
  displayName?: string;
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
    const displayName = payload.nickname || payload.username || payload.name || slug;
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
      displayName,
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
  forfeits?: number;
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
    const statsRoot =
      payload.statistics?.season ||
      payload.statistics?.total ||
      payload.statistics ||
      {};
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
      forfeits,
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
