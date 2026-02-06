import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerRecord } from '../../mcsr/api.js';
import { LINK_HINT_TEXT } from '../../commands/commandSyntax.js';
import { resolveSinglePlayerTarget } from './targetResolver.js';

export class WinrateCommand implements ChatCommand {
  name = 'winrate';
  aliases = ['wr'];
  description = 'Show total wins, losses, winrate, and FFR%.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const resolved = await resolveSinglePlayerTarget(ctx, args);
    if (!resolved.ok) {
      await ctx.reply(resolved.message);
      return;
    }
    const target = resolved.name;

    try {
      const record = await getPlayerRecord(target);
      if (!record) {
        await ctx.reply(`No match history found for ${target}. Check spelling or ${LINK_HINT_TEXT}.`);
        return;
      }
      const displayName = record.displayName || target;
      const matches = Number.isFinite(record.matches) ? record.matches : record.wins + record.losses;
      const winrate =
        matches > 0 ? ((record.wins / matches) * 100).toFixed(1) : '0.0';
      const ffrText =
        record.ffr !== undefined && matches > 0 ? `${record.ffr.toFixed(2)}%` : null;

      const segments: string[] = [];
      segments.push(`Winrate: ${winrate}%`);
      segments.push(`W/L: ${record.wins}/${record.losses}`);
      if (Number.isFinite(matches)) {
        segments.push(`Played ${matches} Matches`);
      }
      if (ffrText) {
        segments.push(`FF Rate ${ffrText}`);
      }

      await ctx.reply(`◆ ${displayName} ${segments.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch winrate for', target, err);
      await ctx.reply(`Could not fetch winrate for ${target}. Try again or ${LINK_HINT_TEXT}.`);
    }
  }
}
