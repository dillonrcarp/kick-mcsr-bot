import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getTopRecordLeaderboard, getPlayerAverage, getPlayerSummary } from '../../mcsr/api.js';

export class FastestCommand implements ChatCommand {
  name = 'mcsrwr';
  aliases = [];
  description = 'Show the #1 record leaderboard player (all-time) with PB, average, and Elo/rank.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, _args: string[]): Promise<void> {
    try {
      const top = await getTopRecordLeaderboard({ distinct: true, limit: 1 });
      if (!top) {
        await ctx.reply('Could not fetch the current fastest leaderboard entry.');
        return;
      }

      const [avg, summary] = await Promise.all([
        getPlayerAverage(top.player.name),
        getPlayerSummary(top.player.name),
      ]);

      const fastest = formatRaceTime(top.timeMs ?? avg?.personalBestMs);
      const dateText = formatDate(top.dateMs);
      const avgText = formatRaceTime(avg?.averageMs);
      const parts: string[] = [];
      parts.push(dateText ? `Fastest: ${fastest} (${dateText})` : `Fastest: ${fastest}`);
      if (avgText !== 'N/A') parts.push(`Avg: ${avgText}`);

      const elo = pickNumber(
        top.player.elo,
        summary?.eloRate,
        summary?.elo,
        summary?.rating,
        summary?.mmr,
      );
      const rank = pickNumber(
        top.player.rank,
        summary?.eloRank,
        summary?.global_rank,
        summary?.rank,
        summary?.position,
        summary?.leaderboard_rank,
      );

      if (elo !== undefined && rank !== undefined) {
        parts.push(`Elo ${elo} (#${rank})`);
      } else if (elo !== undefined) {
        parts.push(`Elo ${elo}`);
      } else if (rank !== undefined) {
        parts.push(`#${rank}`);
      }

      const label = 'All-Time Record';
      await ctx.reply(`◆ ${label} • ${top.player.name} • ${parts.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch fastest leaderboard entry', err);
      await ctx.reply('Could not fetch the current fastest leaderboard entry.');
    }
  }
}

function formatRaceTime(ms?: number | null): string {
  if (!Number.isFinite(ms)) return 'N/A';
  const totalMs = Math.max(0, Math.floor(Number(ms)));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(ms?: number | null): string | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(Number(ms));
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

function pickNumber(...values: Array<number | string | null | undefined>): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(num)) {
      return Number(num);
    }
  }
  return undefined;
}
