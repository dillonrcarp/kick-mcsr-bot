import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerRecord, getPlayerSummary } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';

export class WinrateCommand implements ChatCommand {
  name = 'winrate';
  aliases = ['wr'];
  description = 'Show total wins, losses, winrate, and FFR%.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const arg = args?.[0]?.trim();
    const wantsSelf = arg?.toLowerCase() === 'me';
    const explicitTarget = arg && !wantsSelf ? arg : null;

    const channelOwner = (ctx.channel || '').trim();
    const sender = (ctx.username || '').trim();
    const ownerLinked = channelOwner ? getLinkedMcName(channelOwner) : undefined;
    const senderLinked = sender ? getLinkedMcName(sender) : undefined;

    let target = explicitTarget ?? null;
    if (!target) {
      if (wantsSelf) {
        target = senderLinked || sender || null;
      } else {
        target = ownerLinked || senderLinked || sender || null;
      }
    }

    if (!target) {
      await ctx.reply('No linked account found for this channel or user. Use !link MinecraftUsername to set yours.');
      return;
    }

    try {
      // If we had to fall back to sender name, validate it first.
      if (!explicitTarget && !wantsSelf && !ownerLinked && !senderLinked && sender) {
        const summary = await getPlayerSummary(sender);
        if (!summary) {
          await ctx.reply('No linked account found for this channel or user. Use !link MinecraftUsername to set yours.');
          return;
        }
      }

      const record = await getPlayerRecord(target);
      if (!record) {
        await ctx.reply(`No match history found for ${target}. Check spelling or link with !link MinecraftUsername.`);
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
      await ctx.reply(`Could not fetch winrate for ${target}. Try again or link with !link MinecraftUsername.`);
    }
  }
}
