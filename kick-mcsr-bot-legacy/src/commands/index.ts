import { fetchPlayerSummary, fetchLeaderboardTop, fetchLastMatch } from '../services/mcsrApi.js';
import type { LeaderboardOptions } from '../services/mcsrApi.js';
import { getLinkedAccount, setLinkedAccount, removeLinkedAccount } from '../persistence/linkedAccounts.js';
import { addOrUpdateChannel } from '../persistence/channelRegistry.js';
import { joinChannel, leaveChannel } from '../services/kickChannelManager.js';

export interface CommandContext {
  sender: string;
  isBroadcaster: boolean;
  channel: string;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

interface TargetResult {
  username?: string;
  error?: string;
  season?: string | null;
}

const BOT_USERNAME = (process.env.KICK_BOT_USERNAME || '').toLowerCase();

export function parseCommand(raw?: string | null): ParsedCommand | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('!')) return null;

  const [name, ...args] = trimmed.split(/\s+/);
  return {
    name: name.slice(1).toLowerCase(),
    args,
  };
}

export async function handleCommand(command: ParsedCommand | null, ctx: CommandContext): Promise<string | null> {
  if (!command?.name) return null;
  const context: CommandContext = {
    sender: ctx.sender || '',
    isBroadcaster: Boolean(ctx.isBroadcaster),
    channel: ctx.channel || '',
  };

  switch (command.name) {
    case 'ping':
      return 'Pong!';
    case 'rank':
      return handleRankCommand(command.args);
    case 'stats':
      return handleStatsCommand(command.args);
    case 'top':
    case 'lb':
      return handleTopCommand(command.args);
    case 'elo':
      return handleEloCommand(command.args, context);
    case 'lastmatch':
      return handleLastMatchCommand(command.args, context);
    case 'winrate':
      return handleWinrateCommand(command.args, context);
    case 'avg':
    case 'average':
      return handleAverageCommand(command.args, context);
    case 'record':
      return handleRecordCommand(command.args, context);
    case 'mcsrcommands':
      return listCommands();
    case 'link':
      return handleLinkCommand(command.args, context);
    case 'unlink':
      return handleUnlinkCommand(context);
    case 'join':
      return handleJoinCommand(command.args, context);
    case 'joinchannel':
      return handleJoinChannelCommand(command.args);
    case 'leavechannel':
      return handleLeaveChannelCommand(command.args);
    default:
      return null;
  }
}

async function handleRankCommand(args: string[]): Promise<string> {
  const username = args?.[0];
  if (!username) {
    return 'Usage: !rank [player]';
  }

  try {
    const data = await fetchPlayerSummary(username);
    if (!data) {
      return `No MCSR data found for "${username}".`;
    }

    const display = data.nickname || data.username || data.name || username;
    const rating =
      data.eloRate ??
      data.elo ??
      data.rating ??
      data.ranked_elo ??
      data.rank_score ??
      data.mmr;
    const globalRank =
      data.eloRank ??
      data.global_rank ??
      data.rank ??
      data.position ??
      data.leaderboard_rank ??
      data.overall_rank;

    const parts = [];
    parts.push(`${display}`);
    if (rating !== undefined) parts.push(`rating ${rating}`);
    if (globalRank !== undefined) parts.push(`#${globalRank}`);

    return parts.length > 1 ? parts.join(' | ') : `Found player "${display}".`;
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleStatsCommand(args: string[]): Promise<string> {
  const username = args?.[0];
  if (!username) {
    return 'Usage: !stats [player]';
  }
  try {
    const data = await fetchPlayerSummary(username.toLowerCase());
    if (!data) {
      return `No MCSR data found for "${username}".`;
    }

    const display = data.nickname || data.username || data.name || username;
    const stats = data.statistics?.total || data.statistics || {};
    const wins = stats.wins?.ranked ?? stats.wins ?? stats.totalWins;
    const losses =
      stats.loses?.ranked ?? stats.losses?.ranked ?? stats.losses ?? stats.loses ?? stats.totalLosses;
    const matches =
      stats.playedMatches?.ranked ?? stats.matches?.ranked ?? stats.playedMatches ?? stats.matches;
    const forfeits =
      stats.forfeits?.ranked ?? stats.forfeits ?? stats.totalForfeits ?? stats.ff ?? undefined;
    const bestStreak =
      stats.highestWinStreak?.ranked ??
      stats.highestWinStreak ??
      stats.bestStreak ??
      stats.streak ??
      undefined;

    const totalGames = matches ?? (wins ?? 0) + (losses ?? 0) + (forfeits ?? 0);
    const winrate = wins !== undefined && totalGames > 0 ? Math.round((wins / totalGames) * 100) : undefined;
    const ffr =
      forfeits !== undefined && totalGames > 0
        ? Math.round((forfeits / totalGames) * 100)
        : undefined;

    const parts = [`${display}`];
    if (wins !== undefined && losses !== undefined) parts.push(`W/L ${wins}/${losses}`);
    else if (wins !== undefined) parts.push(`Wins ${wins}`);
    if (winrate !== undefined) parts.push(`WR ${winrate}%`);
    if (matches !== undefined) parts.push(`${matches} games`);
    if (bestStreak !== undefined) parts.push(`Best streak ${bestStreak}`);
    if (ffr !== undefined) parts.push(`FFR ${ffr}%`);

    return parts.join(' | ');
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleTopCommand(args: string[]): Promise<string> {
  let mode: LeaderboardOptions['board'] = 'elo';
  let country: string | null = null;
  let rawLimit: string | null = null;

  for (const arg of args || []) {
    if (/^phase$/i.test(arg)) mode = 'phase';
    else if (/^predicted$/i.test(arg)) mode = 'predicted';
    else if (/^record$/i.test(arg)) mode = 'record';
    else if (/^country:/i.test(arg)) {
      const [, val] = arg.split(':');
      country = val ? val.toUpperCase() : null;
    } else if (!rawLimit && /^\d+$/.test(arg)) {
      rawLimit = arg;
    }
  }

  const limit = rawLimit ? Number(rawLimit) : mode === 'phase' || mode === 'predicted' ? 12 : 10;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 10;

  try {
    const entries = await fetchLeaderboardTop(safeLimit, { board: mode, country });
    if (!entries.length) return 'No leaderboard data available right now.';

    const parts = entries.map((entry, index) => {
      const rank = (entry.eloRank ?? entry.rank ?? entry.position ?? index + 1) as number;
      const name = (entry.nickname || entry.username || entry.name || `#${rank}`) as string;
      if (mode === 'record') {
        const time = (entry.time ?? entry.bestTime ?? entry.best_time) as number | undefined;
        const timeText = time ? formatMs(time) : 'N/A';
        return `${rank}. ${name} (${timeText})`;
      }
      const rating =
        entry.eloRate ?? entry.elo ?? entry.rating ?? entry.phasePoint ?? entry.phasePoints ?? entry.points ?? '?';
      return `${rank}. ${name} (${rating})`;
    });

    const label =
      mode === 'record'
        ? 'Top record times'
        : mode === 'phase'
        ? 'Top phase points'
        : mode === 'predicted'
        ? 'Predicted phase points'
        : 'Top elo';
    const countryLabel = country ? ` [${country}]` : '';
    return `${label}${countryLabel}: ${parts.join(' | ')}`;
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleEloCommand(args: string[], ctx: CommandContext): Promise<string> {
  const target = resolveTarget(args, ctx);
  if (target.error) return target.error;

  try {
    const data = await fetchPlayerSummary(target.username!);
    if (!data) {
      return `No MCSR data found for "${target.username}".`;
    }

    const display = data.nickname || data.username || data.name || target.username;
    const rating =
      data.eloRate ??
      data.elo ??
      data.rating ??
      data.ranked_elo ??
      data.rank_score ??
      data.mmr ??
      'No data available.';
    const rank =
      data.eloRank ??
      data.global_rank ??
      data.rank ??
      data.position ??
      data.leaderboard_rank ??
      data.overall_rank ??
      'No data available.';

    const stats = data.statistics?.total || data.statistics || {};
    const wins = stats.wins?.ranked ?? stats.wins ?? stats.totalWins;
    const losses =
      stats.loses?.ranked ?? stats.losses?.ranked ?? stats.losses ?? stats.loses ?? stats.totalLosses;
    const matches =
      stats.playedMatches?.ranked ?? stats.matches?.ranked ?? stats.playedMatches ?? stats.matches;
    const forfeits =
      stats.forfeits?.ranked ?? stats.forfeits ?? stats.totalForfeits ?? stats.ff ?? undefined;
    const avgMs = computeAverageMs(stats);

    const totalGames = (wins ?? 0) + (losses ?? 0);
    const winrate =
      wins !== undefined && totalGames > 0 ? `${((wins / totalGames) * 100).toFixed(1)}%` : 'No data available.';
    const gamesForFf = matches ?? totalGames;
    const ffr =
      forfeits !== undefined && gamesForFf > 0
        ? `${((forfeits / gamesForFf) * 100).toFixed(1)}%`
        : 'No data available.';
    const avgTime = formatMs(avgMs);
    const matchesText = matches !== undefined ? `${matches}` : 'No data available.';

    return `Player: ${display} | Elo: ${rating} | Rank: #${rank} | Winrate: ${winrate} | Forfeit: ${ffr} | Avg Time: ${avgTime} | Matches: ${matchesText}`;
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleAverageCommand(args: string[], ctx: CommandContext): Promise<string> {
  const target = resolveTargetWithSeason(args, ctx);
  if (target.error) return target.error;

  try {
    const data = await fetchPlayerSummary(target.username!);
    if (!data) return `No MCSR data found for "${target.username}".`;

    const statsRoot = data.statistics || {};
    const stats = target.season
      ? statsRoot.season || statsRoot.total || statsRoot
      : statsRoot.total || statsRoot.season || statsRoot;

    const avgMs = computeAverageMs(stats);
    const comps =
      stats?.completions?.ranked ??
      stats?.completions ??
      stats?.completedRuns ??
      stats?.totalCompletions;
    const wins = stats?.wins?.ranked ?? stats?.wins ?? stats?.totalWins;
    const losses =
      stats?.loses?.ranked ?? stats?.losses?.ranked ?? stats?.losses ?? stats?.loses ?? stats?.totalLosses;

    const avgText = formatMs(avgMs);
    const parts = [];
    parts.push(data.nickname || data.username || data.name || target.username);
    parts.push(`Avg Time: ${avgText}`);
    if (comps !== undefined) parts.push(`Completions: ${comps}`);
    if (wins !== undefined && losses !== undefined) parts.push(`W/L: ${wins}/${losses}`);
    if (target.season) parts.push(`Season: ${target.season}`);

    return parts.join(' | ');
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleLastMatchCommand(args: string[], ctx: CommandContext): Promise<string> {
  const target = resolveTarget(args, ctx);
  if (target.error) return target.error;

  try {
    const summary = await fetchPlayerSummary(target.username!);
    if (!summary) return `No MCSR data found for "${target.username}".`;

    const lastMatch = await fetchLastMatch(target.username!);
    if (!lastMatch) return `No recent matches found for "${target.username}".`;

    const playerUuid = summary.uuid;
    const winnerUuid = lastMatch.result?.uuid;
    const playerChange = lastMatch.changes?.find((change) => change.uuid === playerUuid);
    const opponent = lastMatch.players?.find((player) => player.uuid !== playerUuid);

    const outcome = winnerUuid
      ? winnerUuid === playerUuid
        ? 'Won'
        : 'Lost'
      : lastMatch.forfeited
        ? 'Forfeit'
        : 'Finished';

    const timeMs = lastMatch.result?.time;
    const timeText = timeMs ? formatMs(timeMs) : 'No data available.';
    const delta = playerChange?.change;
    const deltaText = delta !== undefined ? (delta >= 0 ? `+${delta}` : `${delta}`) : 'No data available.';

    const oppName = opponent?.nickname || opponent?.name || 'Unknown';
    return `Last match for ${summary.nickname || target.username}: ${outcome} vs ${oppName} | Time: ${timeText} | Elo change: ${deltaText}`;
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleWinrateCommand(args: string[], ctx: CommandContext): Promise<string> {
  const target = resolveTargetWithSeason(args, ctx);
  if (target.error) return target.error;

  try {
    const data = await fetchPlayerSummary(target.username!);
    if (!data) return `No MCSR data found for "${target.username}".`;

    const statsRoot = data.statistics || {};
    const stats = target.season
      ? statsRoot.season || statsRoot.total || statsRoot
      : statsRoot.total || statsRoot.season || statsRoot;

    const wins = stats?.wins?.ranked ?? stats?.wins ?? stats?.totalWins;
    const losses =
      stats?.loses?.ranked ?? stats?.losses?.ranked ?? stats?.losses ?? stats?.loses ?? stats?.totalLosses;
    const games = stats?.playedMatches?.ranked ?? stats?.matches?.ranked ?? stats?.playedMatches ?? stats?.matches;
    const forfeits =
      stats?.forfeits?.ranked ?? stats?.forfeits ?? stats?.totalForfeits ?? stats?.ff ?? undefined;

    const total = (wins ?? 0) + (losses ?? 0);
    const wr = wins !== undefined && total > 0 ? `${((wins / total) * 100).toFixed(1)}%` : 'No data available.';
    const gamesForFf = games ?? total + (forfeits ?? 0);
    const ffr =
      forfeits !== undefined && gamesForFf > 0
        ? `${((forfeits / gamesForFf) * 100).toFixed(1)}%`
        : 'No data available.';

    const parts = [];
    parts.push(data.nickname || data.username || data.name || target.username);
    parts.push(`WR: ${wr}`);
    if (wins !== undefined && losses !== undefined) parts.push(`W/L: ${wins}/${losses}`);
    if (games !== undefined) parts.push(`Games: ${games}`);
    parts.push(`FFR: ${ffr}`);
    if (target.season) parts.push(`Season: ${target.season}`);

    return parts.join(' | ');
  } catch {
    return 'MCSR API error, try again later.';
  }
}

async function handleRecordCommand(args: string[], ctx: CommandContext): Promise<string> {
  const userA = args?.[0];
  const userB = args?.[1];

  let resolvedA = userA;
  let resolvedB = userB;
  if (!resolvedA) {
    const linked = getLinkedAccount(ctx.sender);
    if (linked) resolvedA = linked;
  }
  if (!resolvedB) {
    if (ctx.isBroadcaster) {
      resolvedB = getLinkedAccount(ctx.channel) || ctx.channel;
    } else {
      const linked = getLinkedAccount(ctx.sender);
      if (linked) resolvedB = linked;
    }
  }

  if (!resolvedA || !resolvedB) {
    return 'Usage: !record [player1] [player2] (head-to-head records not available yet)';
  }

  return 'Head-to-head records are not available via the public MCSR API yet.';
}

function resolveTarget(args: string[], ctx: CommandContext): TargetResult {
  const provided = args?.[0];
  if (provided) return { username: provided };

  if (ctx.isBroadcaster) {
    return { username: getLinkedAccount(ctx.channel) || ctx.channel };
  }

  const linked = getLinkedAccount(ctx.sender);
  if (linked) return { username: linked };
  return { error: "You don't have an MCSR account linked. Please provide a username." };
}

function resolveTargetWithSeason(args: string[], ctx: CommandContext): TargetResult {
  let season: string | null = null;
  const filtered: string[] = [];
  for (const arg of args || []) {
    const match = /^season:(.+)$/i.exec(arg);
    if (match) {
      season = match[1];
    } else {
      filtered.push(arg);
    }
  }

  const target = resolveTarget(filtered, ctx);
  if (target.error) return target;
  return { username: target.username, season };
}

function formatMs(ms?: number | null): string {
  if (!Number.isFinite(ms)) return 'No data available.';
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function computeAverageMs(stats: any): number | undefined {
  if (!stats) return undefined;
  const completionMs =
    stats?.completionTime?.ranked ??
    stats?.completionTime ??
    stats?.avgCompletionTime ??
    stats?.averageCompletionTime;
  const completions =
    stats?.completions?.ranked ??
    stats?.completions ??
    stats?.completedRuns ??
    stats?.totalCompletions;
  if (Number.isFinite(completionMs) && Number.isFinite(completions) && completions > 0) {
    return completionMs / completions;
  }
  return completionMs;
}

function listCommands(): string {
  return 'Commands: !ping, !rank [user], !stats [user], !elo [user], !winrate [user] season:<n>, !avg [user] season:<n>, !lastmatch [user], !lb [limit|phase|predicted|record|country:XX], !record <user1> <user2>, !link <mc>, !unlink, !join, !joinchannel <channel>, !mcsrcommands';
}

async function handleLinkCommand(args: string[], ctx: CommandContext): Promise<string> {
  const target = args?.[0];
  if (!target) {
    return 'Usage: !link [mc-username]';
  }
  const actor = ctx.sender || '';
  const ok = setLinkedAccount(actor, target);
  return ok ? `Linked ${actor} -> ${target}` : 'Failed to link account.';
}

async function handleUnlinkCommand(ctx: CommandContext): Promise<string> {
  const actor = ctx.sender || '';
  const removed = removeLinkedAccount(actor);
  return removed ? `Unlinked ${actor}` : `No linked account found for ${actor}.`;
}

async function handleJoinCommand(args: string[], ctx: CommandContext): Promise<string> {
  if ((ctx.channel || '').toLowerCase() !== BOT_USERNAME) {
    console.log(`[JOIN] Ignored !join from ${ctx.sender || 'unknown'} in non-bot channel "${ctx.channel || ''}"`);
    return 'Use !join in the bot channel only.';
  }

  const targetChannel = args?.[0] || ctx.sender || '';
  if (!targetChannel) {
    console.log(`[JOIN] Missing target channel from ${ctx.sender || 'unknown'}`);
    return 'Usage: !join [channel]';
  }

  const ok = addOrUpdateChannel(targetChannel, null);
  if (ok) {
    console.log(`[JOIN] Registered channel "${targetChannel}" requested by ${ctx.sender || 'unknown sender'}`);
    return `Registered channel "${targetChannel}". The bot will join when modded.`;
  }
  console.log(`[JOIN] Failed to register channel "${targetChannel}" requested by ${ctx.sender || 'unknown sender'}`);
  return 'Failed to register channel.';
}

async function handleJoinChannelCommand(args: string[]): Promise<string> {
  const target = args?.[0];
  if (!target) {
    return 'Usage: !joinchannel [channelName]';
  }
  try {
    await joinChannel(target);
    return `Attempting to join channel: ${target}`;
  } catch (err) {
    console.error(`[joinchannel] Failed to join ${target}`, err);
    return `Failed to join ${target}`;
  }
}

async function handleLeaveChannelCommand(args: string[]): Promise<string> {
  const target = args?.[0];
  if (!target) {
    return 'Usage: !leavechannel [channelName]';
  }
  try {
    await leaveChannel(target);
    return `Attempting to leave channel: ${target}`;
  } catch (err) {
    console.error(`[leavechannel] Failed to leave ${target}`, err);
    return `Failed to leave ${target}`;
  }
}
