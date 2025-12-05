import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getWeeklyRace } from '../../mcsr/api.js';

export class RaceCommand implements ChatCommand {
  name = 'race';
  aliases = ['wrace', 'weeklyrace'];
  description = 'Show Weekly Ranked Race stats for a player.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const targetInput = args?.[0]?.trim();
    const fallback = ctx.channel?.trim() || ctx.username;
    const target = (targetInput || fallback || ctx.username || '').trim();
    if (!target) {
      await ctx.reply('Please provide a player name for the race command.');
      return;
    }

    try {
      const entry = await getWeeklyRace(target);
      if (!entry?.playerRank || !entry.playerTimeMs) {
        await ctx.reply(`No weekly race data found for ${target}.`);
        return;
      }

      const raceNumber = entry.raceNumber || entry.raceId || 0;
      const playerSegment = formatRaceSegment(entry.playerRank, entry.playerTimeMs, entry.playerName);
      const leaderSegment = formatLeaderSegment(entry.leaderTimeMs, entry.leaderName);
      const remainingSegment = formatTimeRemaining(entry.timeRemainingMs);

      const parts = [`Ranked Weekly Race #${raceNumber}`];
      if (playerSegment) parts.push(playerSegment);
      if (leaderSegment) parts.push(leaderSegment);
      if (remainingSegment) parts.push(`ends in ${remainingSegment}`);

      await ctx.reply(parts.join(' | '));
    } catch (err) {
      console.error('Failed to fetch weekly race data for', target, err);
      await ctx.reply('Could not fetch weekly race info.');
    }
  }
}

function formatRaceSegment(rank: number, timeMs: number, playerName?: string): string {
  const name = playerName || 'Unknown';
  return `Rank #${rank}: ${formatRaceTime(timeMs)} by ${name}`;
}

function formatLeaderSegment(timeMs?: number, leaderName?: string): string | null {
  if (!Number.isFinite(timeMs)) return null;
  const name = leaderName || 'leader';
  return `leader: ${formatRaceTime(timeMs!)} by ${name}`;
}

function formatTimeRemaining(ms?: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const totalMinutes = Math.max(0, Math.floor(Number(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(', ');
}

function formatRaceTime(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
