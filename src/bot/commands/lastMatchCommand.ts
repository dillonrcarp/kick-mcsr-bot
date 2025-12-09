import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { getLastMatch, getPlayerSummary } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';

export class LastMatchCommand implements ChatCommand {
  name = 'lastmatch';
  aliases = ['lm', 'recent'];
  description = 'Show the most recent ranked match summary.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const arg = args?.[0]?.trim();
    const wantsSelf = arg?.toLowerCase() === 'me';
    const explicitTarget = arg && !wantsSelf ? arg : null;

    let target: string | null = explicitTarget ?? null;
    let reason: 'self' | 'channel' | undefined;

    if (!explicitTarget) {
      const resolved = await resolveTarget(ctx, wantsSelf);
      target = resolved.name;
      reason = resolved.reason;
    }

    if (!target) {
      if (reason === 'self') {
        await ctx.reply('No linked account found for you. Use !link MinecraftUsername to set yours.');
      } else {
        await ctx.reply('No linked account found for this channel or user. Use !link MinecraftUsername to set yours.');
      }
      return;
    }

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
      const seedLabel = match.seedType ? `Seed Type: ${match.seedType}` : null;
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

interface ResolvedTarget {
  name: string | null;
  reason?: 'self' | 'channel';
}

async function resolveTarget(ctx: ChatCommandContext, wantsSelf: boolean): Promise<ResolvedTarget> {
  const channelOwner = (ctx.channel || '').trim();
  const sender = (ctx.username || '').trim();
  const ownerLinked = channelOwner ? getLinkedMcName(channelOwner) : undefined;
  const senderLinked = sender ? getLinkedMcName(sender) : undefined;

  const validateSender = async (): Promise<string | null> => {
    if (!sender) return null;
    const summary = await getPlayerSummary(sender);
    return summary ? sender : null;
  };

  if (wantsSelf) {
    if (senderLinked) return { name: senderLinked };
    const validated = await validateSender();
    if (validated) return { name: validated };
    return { name: null, reason: 'self' };
  }

  // No args: prefer channel owner link, then sender link, then sender validated.
  if (!wantsSelf) {
    if (ownerLinked) return { name: ownerLinked };
    if (senderLinked) return { name: senderLinked };
    const validated = await validateSender();
    if (validated) return { name: validated };
    return { name: null, reason: 'channel' };
  }

  return { name: null, reason: 'channel' };
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
