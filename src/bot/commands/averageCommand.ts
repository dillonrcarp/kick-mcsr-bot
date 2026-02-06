import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerAverage } from '../../mcsr/api.js';
import { LINK_HINT_TEXT } from '../../commands/commandSyntax.js';
import { formatMinutesSeconds } from './formatUtils.js';
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
        await ctx.reply(`No run data found for ${target}. Check spelling or ${LINK_HINT_TEXT}.`);
        return;
      }

      const display = stats.player || target;
      const avgText = formatMinutesSeconds(stats.averageMs) ?? 'N/A';
      const pbText = formatMinutesSeconds(stats.personalBestMs) ?? 'N/A';
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
      await ctx.reply(`Could not fetch average time for ${target}. Try again or ${LINK_HINT_TEXT}.`);
    }
  }
}
