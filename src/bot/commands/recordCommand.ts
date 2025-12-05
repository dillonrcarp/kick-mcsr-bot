import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getHeadToHead } from '../../mcsr/api.js';

export class RecordCommand implements ChatCommand {
  name = 'record';
  aliases = ['vs', 'headtohead'];
  description = 'Show the head-to-head record between two players.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    if (!args || args.length < 2) {
      await ctx.reply('Usage: +record <player1> <player2>');
      return;
    }

    const [rawP1, rawP2] = args;
    const playerOne = rawP1?.trim();
    const playerTwo = rawP2?.trim();
    if (!playerOne || !playerTwo) {
      await ctx.reply('Usage: +record <player1> <player2>');
      return;
    }

    try {
      const stats = await getHeadToHead(playerOne, playerTwo);
      if (!stats) {
        await ctx.reply(`No head-to-head matches found for ${playerOne} and ${playerTwo}.`);
        return;
      }

      const { winsOne, winsTwo, totalMatches, draws, lastMatchAt } = stats;
      const parts = [`${playerOne} vs ${playerTwo}: ${winsOne}:${winsTwo}`, `${totalMatches} total games played`];
      if (draws && draws > 0) {
        parts.push(`${draws} draws`);
      }
      if (lastMatchAt) {
        parts.push(`last played ${formatTimeAgo(lastMatchAt)} ago`);
      }

      await ctx.reply(parts.join(' | '));
    } catch (err) {
      console.error('Failed to fetch head-to-head record for', playerOne, playerTwo, err);
      await ctx.reply('Could not fetch head-to-head record.');
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
