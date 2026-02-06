import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getLastMatch } from '../../mcsr/api.js';
import { resolveSinglePlayerTarget } from './targetResolver.js';

export class LastMatchCommand implements ChatCommand {
  name = 'lastmatch';
  aliases = ['lm', 'recent'];
  description = 'Show the most recent ranked match summary.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const resolved = await resolveSinglePlayerTarget(ctx, args);
    if (!resolved.ok) {
      await ctx.reply(resolved.message);
      return;
    }
    const target = resolved.name;

    try {
      const match = await getLastMatch(target);
      if (!match || !match.playerA || !match.playerB) {
        await ctx.reply(`No recent ranked matches found for ${target}. Check spelling or link with !link MinecraftUsername.`);
        return;
      }

      let playerA = match.playerA;
      let playerB = match.playerB;
      let winnerFlag: 'A' | 'B' | null = match.winner ?? null;
      if (samePlayer(match.playerB.name, target) && !samePlayer(match.playerA.name, target)) {
        playerA = match.playerB;
        playerB = match.playerA;
        if (winnerFlag) {
          winnerFlag = winnerFlag === 'A' ? 'B' : 'A';
        }
      }

      const timestamp = match.playedAt ?? Date.now();
      const timeAgo = formatTimeAgoVerbose(timestamp);
      const matchNumber = match.matchNumber ? `Match #${match.matchNumber}` : 'Ranked Match';
      const playerASegment = formatPlayerSegment(playerA);
      const playerBSegment = formatPlayerSegment(playerB);
      const seedLabel = match.seedType ? `Seed Type: ${formatSeedType(match.seedType)}` : null;
      const winnerLabel = formatWinner(winnerFlag, playerA, playerB, match.durationMs);
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
      console.error('Failed to fetch last match data for', target ?? ctx.username, err);
      await ctx.reply('Could not fetch last match data. Check names or link with !link MinecraftUsername.');
    }
  }
}

function formatSeedType(raw: string | undefined | null): string {
  if (!raw) return 'Unknown';
  const cleaned = raw.replace(/_/g, ' ').trim();
  if (!cleaned) return 'Unknown';
  return cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPlayerSegment(player: { name: string; rank?: number; eloBefore?: number; eloAfter?: number }): string {
  const rankText = player.rank !== undefined ? `#${player.rank}` : '#?';
  // Prefer post-match Elo so the header reflects the current rating.
  const eloBase = player.eloAfter ?? player.eloBefore;
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
    const after = Number.isFinite(player.eloAfter) ? Number(player.eloAfter) : null;

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
