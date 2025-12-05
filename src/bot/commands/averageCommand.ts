import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerAverage } from '../../mcsr/api.js';

export class AverageCommand implements ChatCommand {
  name = 'average';
  aliases = ['avg'];
  description = 'Show player average time, PB, and total finishes.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const target = args?.[0]?.trim();
    if (!target) {
      await ctx.reply('Usage: +average <player>');
      return;
    }

    try {
      const stats = await getPlayerAverage(target);
      if (!stats) {
        await ctx.reply(`No run data found for ${target}.`);
        return;
      }

      const display = stats.player || target;
      const avgText = formatRaceTime(stats.averageMs);
      const pbText = formatRaceTime(stats.personalBestMs);
      const parts = [`${display}: avg ${avgText}`, `pb ${pbText}`, `${stats.finishes} finishes`];
      if (stats.ffr !== undefined) {
        parts.push(`FFR ${Math.round(stats.ffr)}%`);
      }
      await ctx.reply(parts.join(' | '));
    } catch (err) {
      console.error('Failed to fetch average stats for', target, err);
      await ctx.reply(`Could not fetch average time for ${target}.`);
    }
  }
}

function formatRaceTime(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
