import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerSummary } from '../../mcsr/api.js';

export class EloCommand implements ChatCommand {
  name = 'elo';
  aliases = ['stats'];
  description = "Show a player's Elo, rank, winrate, and other stats.";
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const targetInput = args?.[0]?.trim();
    const fallback = ctx.channel?.trim() || ctx.username;
    const target = (targetInput || fallback || ctx.username || '').trim();
    if (!target) {
      await ctx.reply('Please provide a player name.');
      return;
    }

    try {
      const summary = await getPlayerSummary(target);
      if (!summary) {
        await ctx.reply(`Could not fetch MCSR stats for ${target}.`);
        return;
      }
      const response = buildStatsMessage(summary);
      await ctx.reply(response);
    } catch (err) {
      console.error('Failed to fetch MCSR stats for', target, err);
      await ctx.reply(`Could not fetch MCSR stats for ${target}.`);
    }
  }
}

function buildStatsMessage(data: Record<string, any>): string {
  const display = data.nickname || data.username || data.name || 'Player';
  const rating = pickNumber(data.eloRate, data.elo, data.rating, data.rank_score, data.mmr);
  const peak = pickNumber(data.eloPeak, data.peak_elo, data.highest_elo, data.highestElo);
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

  const statsRoot =
    data.statistics?.season ||
    data.statistics?.total ||
    data.statistics ||
    {};
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

  // Elo + peak
  if (rating !== undefined && peak !== undefined) {
    segments.push(`Elo ${rating} (Peak ${peak})`);
  } else if (rating !== undefined) {
    segments.push(`Elo ${rating}`);
  } else if (peak !== undefined) {
    segments.push(`Peak ${peak}`);
  }

  // Rank/tier
  const rankLabel = rank !== undefined ? `#${rank}` : null;
  if (tier && rankLabel) {
    segments.push(`${tier} (${rankLabel})`);
  } else if (tier) {
    segments.push(tier);
  } else if (rankLabel) {
    segments.push(`Rank ${rankLabel}`);
  }

  // W/L with winrate
  if (wins !== undefined && losses !== undefined) {
    const total = wins + losses;
    const winrate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    segments.push(`W/L: ${wins}/${losses} (${winrate}%)`);
  }

  // Matches played
  const totalMatches =
    matches ?? (wins !== undefined && losses !== undefined ? wins + losses : undefined);
  if (totalMatches !== undefined) {
    segments.push(`Played ${totalMatches} Matches`);
  }

  // Personal best / average
  const fastestText = formatMs(fastestMs);
  const avgText = formatMs(avgMs);
  if (fastestText) {
    segments.push(avgText ? `PB: ${fastestText} (avg ${avgText})` : `PB: ${fastestText}`);
  }

  // FF rate
  const ffSegment = buildForfeitSegment(statsRoot, matches, wins, losses);
  if (ffSegment) {
    segments.push(ffSegment);
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

function buildForfeitSegment(
  statsRoot: Record<string, any>,
  matches?: number,
  wins?: number,
  losses?: number,
): string | null {
  const forfeits = pickNumber(
    statsRoot?.forfeits?.ranked,
    statsRoot?.forfeits,
    statsRoot?.totalForfeits,
    statsRoot?.ff,
  );
  if (forfeits === undefined) return null;
  const denominator = matches ?? (wins !== undefined && losses !== undefined ? wins + losses : undefined);
  if (!denominator || denominator <= 0) return null;
  const rate = ((forfeits / denominator) * 100).toFixed(2);
  return `FF Rate ${rate}%`;
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
