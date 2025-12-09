import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getRecentWindowStats, getPlayerSummary } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';

export class MCSRTodayCommand implements ChatCommand {
  name = 'mcsrtoday';
  aliases = ['today', 'td'];
  description = 'Show ranked stats from the last 24 hours.';
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
      // Validate implicit sender fallback so we do not hammer the API with bad names.
      if (!explicitTarget && !wantsSelf && !ownerLinked && !senderLinked && sender) {
        const summary = await getPlayerSummary(sender);
        if (!summary) {
          await ctx.reply('No linked account found for this channel or user. Use !link MinecraftUsername to set yours.');
          return;
        }
      }

      const stats = await getRecentWindowStats(target);
      if (!stats) {
        await ctx.reply(`No match data found for last 24h for ${target}.`);
        return;
      }

      const bestText = formatClock(stats.bestWinMs);
      const avgText = formatClock(stats.averageWinMs);
      const eloText = formatEloDelta(stats.eloDelta);
      const matches = Math.max(1, stats.matches);
      const winrate = Math.round((stats.wins / matches) * 100);

      const segments = [
        'Stats: Last 24h',
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
