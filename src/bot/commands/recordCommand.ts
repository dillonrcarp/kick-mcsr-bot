import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getHeadToHead } from '../../mcsr/api.js';
import { OWNER_LINK_TOOLTIP, resolveChannelOwnerTarget } from './targetResolver.js';

export class RecordCommand implements ChatCommand {
  name = 'record';
  aliases = ['vs', 'headtohead'];
  description = 'Show the head-to-head record between two players.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const [rawP1, rawP2] = args ?? [];
    const arg1 = rawP1?.trim();
    const arg2 = rawP2?.trim();

    // If only one arg is provided, treat it as the opponent and fill playerOne from channel owner.
    let playerOne: string | null;
    let playerTwo: string | null;
    if (arg1 && arg2) {
      playerOne = arg1;
      playerTwo = arg2;
    } else if (arg1) {
      playerTwo = arg1;
      const owner = await resolveChannelOwnerTarget(ctx);
      if (!owner) {
        await ctx.reply(OWNER_LINK_TOOLTIP);
        return;
      }
      playerOne = owner.name;
    } else {
      playerOne = null;
      playerTwo = null;
    }

    if (!playerOne || !playerTwo) {
      await ctx.reply('Usage: +record player1 player2 (link with !link MinecraftUsername to auto-fill yours)');
      return;
    }

    try {
      const stats = await getHeadToHead(playerOne, playerTwo);
      if (!stats) {
        await ctx.reply(`No head-to-head matches found for ${playerOne} and ${playerTwo}. Check spelling or link with !link MinecraftUsername.`);
        return;
      }

      const {
        winsOne,
        winsTwo,
        totalMatches,
        draws,
        lastMatchAt,
        playerOne: p1,
        playerTwo: p2,
        playerOneName,
        playerTwoName,
      } = stats;
      const displayOne = playerOneName || p1;
      const displayTwo = playerTwoName || p2;
      const segments: string[] = [];
      segments.push(`${displayOne} vs ${displayTwo}: ${winsOne}:${winsTwo}`);
      segments.push(`Played ${totalMatches} Matches`);
      if (draws && draws > 0) {
        segments.push(`${draws} draws`);
      }
      if (lastMatchAt) {
        segments.push(`Last played ${formatTimeAgo(lastMatchAt)} ago`);
      }

      await ctx.reply(`◆ ${segments.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch head-to-head record for', playerOne, playerTwo, err);
      await ctx.reply('Could not fetch head-to-head record. Try again or verify names/linking with !link MinecraftUsername. Usage: +record player1 player2');
    }
  }
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w`;
}
