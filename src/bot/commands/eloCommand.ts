import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerSummary } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';

export class EloCommand implements ChatCommand {
  name = 'elo';
  aliases = ['stats'];
  description = "Show a player's Elo, rank, winrate, and other stats.";
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    try {
      const resolved = await resolveTarget(ctx, args);
      if (!resolved) {
        await ctx.reply('No linked account found for this channel or user. Use !link MinecraftUsername to set yours.');
        return;
      }
      const summary = resolved.summary ?? (await getPlayerSummary(resolved.name));
      if (!summary) {
        await ctx.reply(`Could not fetch MCSR stats for ${resolved.name}. Check spelling or link with !link MinecraftUsername.`);
        return;
      }
      const response = buildStatsMessage(summary, resolved.name);
      await ctx.reply(response);
    } catch (err) {
      console.error('Failed to fetch MCSR stats for', ctx.username, err);
      await ctx.reply('Could not fetch MCSR stats for this request. Try again or link with !link MinecraftUsername.');
    }
  }
}

interface ResolvedTarget {
  name: string;
  summary?: Record<string, any> | null;
}

async function resolveTarget(ctx: ChatCommandContext, args: string[]): Promise<ResolvedTarget | null> {
  const channelOwner = (ctx.channel || '').trim();
  const sender = (ctx.username || '').trim();
  const arg = args?.[0]?.trim();
  const wantsSelf = arg?.toLowerCase() === 'me';

  // Explicit target other than "me"
  if (arg && !wantsSelf) {
    return { name: arg };
  }

  const ownerLinked = channelOwner ? getLinkedMcName(channelOwner) : undefined;
  const senderLinked = sender ? getLinkedMcName(sender) : undefined;

  // If owner linked and user asked for "me", honor sender instead.
  if (wantsSelf) {
    if (senderLinked) return { name: senderLinked };
    if (sender) {
      const summary = await getPlayerSummary(sender);
      if (summary) return { name: sender, summary };
    }
    return null;
  }

  if (ownerLinked) return { name: ownerLinked };
  if (senderLinked) return { name: senderLinked };

  if (sender) {
    const summary = await getPlayerSummary(sender);
    if (summary) return { name: sender, summary };
  }

  return null;
}

function buildStatsMessage(data: Record<string, any>, fallbackName: string): string {
  const display = data.nickname || data.username || data.name || fallbackName || 'Player';
  const rating = pickNumber(data.eloRate, data.elo, data.rating, data.rank_score, data.mmr);
  const peak = pickNumber(
    data.eloPeak,
    data.peak_elo,
    data.highest_elo,
    data.highestElo,
    data.seasonResult?.highest,
  );
  const rank = pickNumber(
    data.eloRank,
    data.global_rank,
    data.rank,
    data.position,
    data.leaderboard_rank,
    data.overall_rank,
  );
  const tier =
    data.rankName ||
    data.rank_name ||
    data.division ||
    data.league ||
    data.tier ||
    data.rankTier ||
    data.rank_title ||
    (rating !== undefined ? tierFromElo(rating) : undefined);

  const statsRoot = data.statistics?.season || data.statistics?.total || data.statistics || {};
  const wins = pickNumber(statsRoot?.wins?.ranked, statsRoot?.wins, statsRoot?.totalWins);
  const losses = pickNumber(
    statsRoot?.loses?.ranked,
    statsRoot?.losses?.ranked,
    statsRoot?.losses,
    statsRoot?.loses,
    statsRoot?.totalLosses,
  );
  const matches = pickNumber(
    statsRoot?.playedMatches?.ranked,
    statsRoot?.matches?.ranked,
    statsRoot?.playedMatches,
    statsRoot?.matches,
  );
  const forfeits = pickNumber(
    statsRoot?.forfeits?.ranked,
    statsRoot?.forfeits,
    statsRoot?.totalForfeits,
    statsRoot?.ff,
  );
  const fastestMs = pickNumber(
    statsRoot?.bestTime?.ranked,
    statsRoot?.bestTime,
    statsRoot?.best_time,
    statsRoot?.recordTime,
    statsRoot?.record_time,
    statsRoot?.fastestTime?.ranked,
    statsRoot?.fastestTime,
    statsRoot?.fastest_time,
    statsRoot?.personalBest,
    statsRoot?.personal_best,
    statsRoot?.bestCompletionTime,
    statsRoot?.best_completion_time,
    data.bestTime,
    data.best_time,
  );
  const avgMs = computeAverageMs(statsRoot);

  const segments: string[] = [];

  if (rating !== undefined && peak !== undefined) {
    segments.push(`Elo ${rating} (Peak ${peak})`);
  } else if (rating !== undefined) {
    segments.push(`Elo ${rating}`);
  } else if (peak !== undefined) {
    segments.push(`Peak ${peak}`);
  }

  const rankLabel = rank !== undefined ? `#${rank}` : null;
  if (tier && rankLabel) {
    segments.push(`${tier} (${rankLabel})`);
  } else if (tier) {
    segments.push(tier);
  } else if (rankLabel) {
    segments.push(`#${rank}`);
  }

  if (wins !== undefined && losses !== undefined) {
    const total = wins + losses;
    const winrate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    segments.push(`W/L: ${wins}/${losses} (${winrate}%)`);
  }

  const totalMatches =
    matches ?? (wins !== undefined && losses !== undefined ? wins + losses : undefined);
  if (totalMatches !== undefined) {
    segments.push(`Played ${totalMatches} Matches`);
  }

  const fastestText = formatMs(fastestMs);
  const avgText = formatMs(avgMs);
  if (fastestText) {
    segments.push(avgText ? `PB: ${fastestText} (avg ${avgText})` : `PB: ${fastestText}`);
  }

  if (forfeits !== undefined && totalMatches !== undefined && totalMatches > 0) {
    const rate = ((forfeits / totalMatches) * 100).toFixed(2);
    segments.push(`FF Rate ${rate}%`);
  }

  if (!segments.length) return '◆ Stats: No stats available';
  return `◆ ${display} Stats: ${segments.join(' • ')}`;
}

function pickNumber(
  ...values: Array<number | string | null | undefined>
): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(num)) {
      return Number(num);
    }
  }
  return undefined;
}

function formatMs(ms?: number | null): string | null {
  if (!Number.isFinite(ms)) return null;
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
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
  return Number.isFinite(completionMs) ? Number(completionMs) : undefined;
}

function tierFromElo(elo: number): string {
  const tiers = [
    { min: 2000, name: 'Netherite' },
    { min: 1800, name: 'Diamond III' },
    { min: 1650, name: 'Diamond II' },
    { min: 1500, name: 'Diamond I' },
    { min: 1400, name: 'Emerald III' },
    { min: 1300, name: 'Emerald II' },
    { min: 1200, name: 'Emerald I' },
    { min: 1100, name: 'Gold III' },
    { min: 1000, name: 'Gold II' },
    { min: 900, name: 'Gold I' },
    { min: 800, name: 'Iron III' },
    { min: 700, name: 'Iron II' },
    { min: 600, name: 'Iron I' },
    { min: 500, name: 'Coal III' },
    { min: 400, name: 'Coal II' },
    { min: 0, name: 'Coal I' },
  ];
  const match = tiers.find((tier) => elo >= tier.min);
  return match ? match.name : 'Coal I';
}
