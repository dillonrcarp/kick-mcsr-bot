import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerAverage } from '../../mcsr/api.js';
import { resolveSinglePlayerTarget } from './targetResolver.js';

export class AverageCommand implements ChatCommand {
  name = 'average';
  aliases = ['avg'];
  description = 'Show player average time, PB, and total finishes.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const resolved = await resolveSinglePlayerTarget(ctx, args);
    if (!resolved.ok) {
      await ctx.reply(resolved.message);
      return;
    }
    const target = resolved.name;

    try {
      const stats = await getPlayerAverage(target);
      if (!stats) {
        await ctx.reply(`No run data found for ${target}. Check spelling or link with !link MinecraftUsername.`);
        return;
      }

      const display = stats.player || target;
      const avgText = formatRaceTime(stats.averageMs);
      const pbText = formatRaceTime(stats.personalBestMs);
      const parts: string[] = [];
      parts.push(`Average: ${avgText}`);
      parts.push(`PB: ${pbText}`);
      parts.push(`Finishes ${stats.finishes}`);
      if (stats.ffr !== undefined) {
        parts.push(`FF Rate ${stats.ffr.toFixed(2)}%`);
      }
      await ctx.reply(`◆ ${display} ${parts.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch average stats for', target, err);
      await ctx.reply(`Could not fetch average time for ${target}. Try again or link with !link MinecraftUsername.`);
    }
  }
}

function formatRaceTime(ms: number): string {
  if (!Number.isFinite(ms)) return 'N/A';
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
