import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getPlayerAverage } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';

export class AverageCommand implements ChatCommand {
  name = 'average';
  aliases = ['avg'];
  description = 'Show player average time, PB, and total finishes.';
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
