import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getRecentWindowStats } from '../../mcsr/api.js';
import { resolveSinglePlayerTarget } from './targetResolver.js';

export class MCSRTodayCommand implements ChatCommand {
  name = 'mcsrtoday';
  aliases = ['today', 'td'];
  description = 'Show ranked stats from the last 12 hours.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const resolved = await resolveSinglePlayerTarget(ctx, args);
    if (!resolved.ok) {
      await ctx.reply(resolved.message);
      return;
    }
    const target = resolved.name;

    try {
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      const stats = await getRecentWindowStats(target, twelveHoursMs);
      if (!stats) {
        await ctx.reply(`No match data found for last 12h for ${target}.`);
        return;
      }

      const bestText = formatClock(stats.bestWinMs);
      const avgText = formatClock(stats.averageWinMs);
      const eloText = formatEloDelta(stats.eloDelta);
      const matches = Math.max(1, stats.matches);
      const winrate = Math.round((stats.wins / matches) * 100);

      const segments = [
        'Stats: Last 12h',
        `Best: ${bestText} (avg ${avgText})`,
        `Elo Δ ${eloText}`,
        `W/L: ${winrate}% (${stats.wins}/${stats.losses})`,
      ];

      await ctx.reply(`◆ ${stats.player} • ${segments.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch last-24h stats for', target, err);
      await ctx.reply(`Could not fetch last-24h stats for ${target}. Try again or link with !link MinecraftUsername.`);
    }
  }
}

function formatClock(ms?: number): string {
  if (!Number.isFinite(ms)) return 'N/A';
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatEloDelta(delta: number): string {
  if (!Number.isFinite(delta)) return 'N/A';
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return '+0';
}
