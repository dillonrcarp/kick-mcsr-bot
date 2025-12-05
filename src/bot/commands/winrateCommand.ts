import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerRecord } from '../../mcsr/api.js';

export class WinrateCommand implements ChatCommand {
  name = 'winrate';
  aliases = ['wr'];
  description = 'Show total wins, losses, winrate, and FFR%.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const target = args?.[0]?.trim();
    if (!target) {
      await ctx.reply('Usage: +winrate <player>');
      return;
    }

    try {
      const record = await getPlayerRecord(target);
      if (!record) {
        await ctx.reply(`No match history found for ${target}.`);
        return;
      }
      const winrate = record.matches > 0 ? Math.round((record.wins / record.matches) * 100) : 0;
      const parts = [`${target}: ${winrate}% WR`, `${record.wins}W ${record.losses}L`, `${record.matches} games`];
      if (record.ffr !== undefined) {
        const ffrPct = record.ffr;
        const ffrText = ffrPct < 10 ? ffrPct.toFixed(1) : Math.round(ffrPct).toString();
        parts.push(`FFR ${ffrText}%`);
      }
      await ctx.reply(parts.join(' | '));
    } catch (err) {
      console.error('Failed to fetch winrate for', target, err);
      await ctx.reply(`Could not fetch winrate for ${target}.`);
    }
  }
}
