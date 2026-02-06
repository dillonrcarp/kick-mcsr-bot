import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { fetchUserMatches, RateLimitError } from '../../mcsr/api.js';
import { LINK_HINT_TEXT } from '../../commands/commandSyntax.js';
import { computePlayerFeatures, type PlayerFeatureStats } from '../../mcsr/predictFeatures.js';
import { predictOutcome, type PredictionOutcome } from '../../mcsr/predictScore.js';
import {
  OWNER_LINK_TOOLTIP,
  SELF_LINK_TOOLTIP,
  resolveChannelOwnerTarget,
  resolveSenderTarget,
} from './targetResolver.js';

interface PredictDeps {
  fetchMatches: typeof fetchUserMatches;
  computeFeatures: typeof computePlayerFeatures;
  predict: typeof predictOutcome;
  now: () => number;
  resolveOwnerTarget: typeof resolveChannelOwnerTarget;
  resolveSenderTarget: typeof resolveSenderTarget;
}

interface ParsedArgs {
  playerA: string;
  playerB: string;
  matchCount: number;
}

const DEFAULT_MATCHES = 10;
const MAX_MATCHES = 50;
const FETCH_BUFFER = 5;

export class PredictCommand implements ChatCommand {
  name = 'predict';
  aliases = ['win'];
  description = "Predict likely winner between two players based on their last X ranked matches.";
  category = 'mcsr';

  private readonly deps: PredictDeps;

  constructor(deps?: Partial<PredictDeps>) {
    this.deps = {
      fetchMatches: deps?.fetchMatches ?? fetchUserMatches,
      computeFeatures: deps?.computeFeatures ?? computePlayerFeatures,
      predict: deps?.predict ?? predictOutcome,
      now: deps?.now ?? (() => Date.now()),
      resolveOwnerTarget: deps?.resolveOwnerTarget ?? resolveChannelOwnerTarget,
      resolveSenderTarget: deps?.resolveSenderTarget ?? resolveSenderTarget,
    };
  }

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const parsed = await this.parseArgs(ctx, args);
    if (!parsed.ok) {
      await ctx.reply(parsed.message);
      return;
    }

    const { playerA, playerB, matchCount } = parsed.value;
    const anchor = this.deps.now();

    try {
      const [matchesA, matchesB] = await Promise.all([
        this.deps.fetchMatches(playerA, matchCount + FETCH_BUFFER, { rankedOnly: true }),
        this.deps.fetchMatches(playerB, matchCount + FETCH_BUFFER, { rankedOnly: true }),
      ]);

      const featuresA = this.deps.computeFeatures(matchesA, playerA, { limit: matchCount, anchorMs: anchor });
      const featuresB = this.deps.computeFeatures(matchesB, playerB, { limit: matchCount, anchorMs: anchor });

      if (!featuresA || !featuresB) {
        await ctx.reply('Not enough recent ranked data to make a prediction for those players.');
        return;
      }

      const outcome = this.deps.predict({
        playerA: featuresA,
        playerB: featuresB,
        targetSample: matchCount,
        anchorMs: anchor,
      });

      if (!outcome) {
        await ctx.reply('Could not compute a prediction. Try again with different players.');
        return;
      }

      const message = formatPrediction(featuresA, featuresB, outcome, matchCount, anchor);
      await ctx.reply(message);
    } catch (err) {
      if (err instanceof RateLimitError) {
        const retrySeconds = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : null;
        console.error('Predict command rate-limited', { retryAfterMs: err.retryAfterMs });
        await ctx.reply(
          retrySeconds
            ? `Rate limited by MCSR API. Please wait ~${retrySeconds}s and try again.`
            : 'Rate limited by MCSR API. Please try again later.',
        );
        return;
      }
      console.error('Predict command failed', err);
      await ctx.reply(`Could not fetch data to make a prediction. Check names or ${LINK_HINT_TEXT}.`);
    }
  }

  private async parseArgs(
    ctx: ChatCommandContext,
    args: string[],
  ): Promise<{ ok: true; value: ParsedArgs } | { ok: false; message: string }> {
    let matchCount = DEFAULT_MATCHES;
    const nameTokens: string[] = [];

    for (const arg of args) {
      const num = Number(arg);
      if (Number.isFinite(num) && /^\d+$/.test(arg)) {
        matchCount = clamp(Math.round(num), 1, MAX_MATCHES);
      } else if (arg) {
        nameTokens.push(arg);
      }
    }

    let playerA: string | null = null;
    let playerB: string | null = null;

    if (nameTokens.length >= 2) {
      playerA = await this.resolvePlayer(ctx, nameTokens[0], 'owner');
      playerB = await this.resolvePlayer(ctx, nameTokens[1], 'sender');
    } else if (nameTokens.length === 1) {
      // Assume single arg is opponent; fill playerA from channel owner/link.
      playerA = await this.resolvePlayer(ctx, undefined, 'owner');
      playerB = await this.resolvePlayer(ctx, nameTokens[0], 'sender');
    } else {
      playerA = await this.resolvePlayer(ctx, undefined, 'owner');
      playerB = await this.resolvePlayer(ctx, undefined, 'sender');
    }

    if (!playerA) {
      return {
        ok: false,
        message: OWNER_LINK_TOOLTIP,
      };
    }
    if (!playerB) {
      return {
        ok: false,
        message: SELF_LINK_TOOLTIP,
      };
    }

    if (normalize(playerA) === normalize(playerB)) {
      return { ok: false, message: 'Need two different players to predict a matchup.' };
    }

    return {
      ok: true,
      value: {
        playerA,
        playerB,
        matchCount,
      },
    };
  }

  private async resolvePlayer(
    ctx: ChatCommandContext,
    raw: string | undefined,
    fallback: 'owner' | 'sender',
  ): Promise<string | null> {
    const value = raw?.trim();
    if (value && value.toLowerCase() === 'me') {
      const sender = await this.deps.resolveSenderTarget(ctx);
      return sender?.name ?? null;
    }
    if (value) return value;

    if (fallback === 'owner') {
      const owner = await this.deps.resolveOwnerTarget(ctx);
      return owner?.name ?? null;
    }

    const sender = await this.deps.resolveSenderTarget(ctx);
    return sender?.name ?? null;
  }
}

function formatPrediction(
  a: PlayerFeatureStats,
  b: PlayerFeatureStats,
  outcome: PredictionOutcome,
  matchCount: number,
  anchor: number,
): string {
  const winnerName = outcome.winner === 'A' ? a.player : b.player;
  const winnerProb = outcome.winner === 'A' ? outcome.probabilityA : outcome.probabilityB;
  const pct = (winnerProb * 100).toFixed(1);
  const confidencePct = Math.round(outcome.confidence * 100);

  const factors = outcome.factors.length ? `Factors: ${outcome.factors.join('; ')}` : 'Factors: balanced slate';
  const sample = `Sample: ${a.player} ${a.sample} vs ${b.player} ${b.sample} (last ${matchCount} ranked)`;
  const recency = formatRecency(a, b, anchor);

  return `◆ Predicted: ${winnerName} ~${pct}% (confidence ${confidencePct}%) • ${factors} • ${sample}${recency ? ' • ' + recency : ''}`;
}

function formatRecency(a: PlayerFeatureStats, b: PlayerFeatureStats, anchor: number): string | null {
  const oldest = Math.min(a.oldestMatchAt ?? anchor, b.oldestMatchAt ?? anchor);
  if (!Number.isFinite(oldest)) return null;
  const ago = timeAgo(anchor - oldest);
  return `Recency window: ~${ago}`;
}

function timeAgo(diffMs: number): string {
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
