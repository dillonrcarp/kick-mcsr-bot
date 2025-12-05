import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getLastMatch } from '../../mcsr/api.js';

export class LastMatchCommand implements ChatCommand {
  name = 'lastmatch';
  aliases = ['lm', 'recent'];
  description = 'Show the most recent ranked match summary.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const targetInput = args?.[0]?.trim();
    const fallback = ctx.channel?.trim() || ctx.username;
    const target = (targetInput || fallback || ctx.username || '').trim();
    if (!target) {
      await ctx.reply('Please provide a player name for last match info.');
      return;
    }

    try {
      const match = await getLastMatch(target);
      if (!match || !match.playerA || !match.playerB) {
        await ctx.reply(`No recent ranked matches found for ${target}.`);
        return;
      }

      let playerA = match.playerA;
      let playerB = match.playerB;
      if (samePlayer(match.playerB.name, target) && !samePlayer(match.playerA.name, target)) {
        playerA = match.playerB;
        playerB = match.playerA;
      }

      const timestamp = match.playedAt ?? Date.now();
      const timeAgo = formatTimeAgoVerbose(timestamp);
      const matchNumber = match.matchNumber ? `Match #${match.matchNumber}` : 'Ranked Match';
      const playerASegment = formatPlayerSegment(playerA);
      const playerBSegment = formatPlayerSegment(playerB);
      const seedLabel = match.seedType ? `Seed Type: ${match.seedType}` : null;
      const winnerLabel = formatWinner(match.winner ?? null, playerA, playerB, match.durationMs);
      const deltaSegment = formatEloDelta(playerA, playerB);

      const header = `◆ ${playerA.name} • Last Match Stats`;
      const bodyParts = [
        `(${timeAgo} ago)`,
        `${playerASegment} VS ${playerBSegment}`,
        seedLabel,
        winnerLabel,
        `Elo Change: ${deltaSegment}`,
      ].filter(Boolean);

      await ctx.reply(`${header}\n${bodyParts.join(' • ')}`);
    } catch (err) {
      console.error('Failed to fetch last match data for', target, err);
      await ctx.reply('Could not fetch last match data.');
    }
  }
}

function formatPlayerSegment(player: { name: string; rank?: number; eloBefore?: number; eloAfter?: number }): string {
  const rankText = player.rank !== undefined ? `#${player.rank}` : '#?';
  const eloBase = player.eloBefore ?? player.eloAfter;
  const eloText = eloBase !== undefined ? `(${eloBase})` : '';
  return `${rankText} ${player.name} ${eloText}`.trim();
}

function formatWinner(
  winner: 'A' | 'B' | null,
  playerA: { name: string },
  playerB: { name: string },
  durationMs?: number,
): string {
  const duration = formatDuration(durationMs);
  if (winner === 'A') return `Winner: ${playerA.name}${duration ? ` (${duration})` : ''}`;
  if (winner === 'B') return `Winner: ${playerB.name}${duration ? ` (${duration})` : ''}`;
  return 'Winner: N/A (DRAW)';
}

function formatEloDelta(
  playerA: { name: string; eloBefore?: number; eloAfter?: number },
  playerB: { name: string; eloBefore?: number; eloAfter?: number },
): string {
  const format = (player: { name: string; eloBefore?: number; eloAfter?: number }): string => {
    const delta = computeDelta(player.eloBefore, player.eloAfter);
    const after =
      Number.isFinite(player.eloAfter) ? Number(player.eloAfter) : null;

    if (after !== null && delta !== null) {
      const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
      return `${player.name} ${deltaText} \u2192 ${after}`;
    }
    if (after !== null) {
      return `${player.name} \u2192 ${after}`;
    }
    return `${player.name} ?`;
  };

  return [format(playerA), format(playerB)].join(' | ');
}

function computeDelta(before?: number, after?: number): number | null {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return Number(after) - Number(before);
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

function samePlayer(a?: string, b?: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function formatDuration(ms?: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const totalMs = Number(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = Math.floor(totalMs % 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatTimeAgoVerbose(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
