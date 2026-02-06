import { fetchUserMatches, findEloChangeForPlayer, normalizeName, normalizeTimestampMs } from './api.js';
import { computePlayerFeatures, type PlayerFeatureStats } from './predictFeatures.js';
import { predictOutcome } from './predictScore.js';

export interface BacktestOptions {
  players: string[];
  matchesPerPlayer?: number;
  featureLimit?: number;
  minHistory?: number;
  calibrationBins?: number;
  trainFraction?: number;
}

export interface PredictionSample {
  matchKey: string;
  playedAt: number;
  playerA: string;
  playerB: string;
  winner: string;
  probabilityA: number;
  confidence: number;
  labelA: 0 | 1;
}

export interface BinaryMetrics {
  count: number;
  accuracy: number;
  avgConfidence: number;
  brier: number;
  logLoss: number;
}

export interface CalibrationBin {
  start: number;
  end: number;
  count: number;
  meanPredicted: number;
  observedWinRate: number;
}

export interface PlattModel {
  a: number;
  b: number;
}

export interface BacktestReport {
  players: string[];
  consideredMatches: number;
  eligibleMatches: number;
  samples: number;
  trainSamples: number;
  testSamples: number;
  skipped: {
    missingParticipants: number;
    missingWinner: number;
    missingHistory: number;
    modelUnavailable: number;
  };
  raw: {
    train: BinaryMetrics;
    test: BinaryMetrics;
    calibration: CalibrationBin[];
  };
  calibrated: {
    test: BinaryMetrics;
    calibration: CalibrationBin[];
    model: PlattModel | null;
  };
}

interface HistoryEntry {
  playedAt: number;
  match: any;
}

interface MatchEvent {
  key: string;
  playedAt: number;
  playerA: string;
  playerB: string;
  winner: string;
  match: any;
}

interface CollectedEvents {
  events: MatchEvent[];
  rejected: {
    missingParticipants: number;
    missingWinner: number;
  };
}

export interface PreparedBacktestSample {
  matchKey: string;
  playedAt: number;
  playerA: string;
  playerB: string;
  labelA: 0 | 1;
  targetSample: number;
  featuresA: PlayerFeatureStats;
  featuresB: PlayerFeatureStats;
}

export interface PreparedBacktestData {
  players: string[];
  consideredMatches: number;
  skipped: {
    missingParticipants: number;
    missingWinner: number;
    missingHistory: number;
    modelUnavailable: number;
  };
  samples: PreparedBacktestSample[];
}

export async function runPredictBacktest(options: BacktestOptions): Promise<BacktestReport> {
  const matchesPerPlayer = Math.max(20, options.matchesPerPlayer ?? 150);
  const featureLimit = Math.max(1, options.featureLimit ?? 10);
  const bins = Math.max(3, options.calibrationBins ?? 10);
  const trainFraction = clamp(options.trainFraction ?? 0.8, 0.5, 0.95);
  const prepared = await buildBacktestSamples({
    ...options,
    matchesPerPlayer,
    featureLimit,
  });
  const predictions: PredictionSample[] = [];
  const skipped = { ...prepared.skipped };

  for (const sample of prepared.samples) {
    const outcome = predictOutcome({
      playerA: sample.featuresA,
      playerB: sample.featuresB,
      targetSample: sample.targetSample,
      anchorMs: sample.playedAt,
    });
    if (!outcome) {
      skipped.modelUnavailable += 1;
      continue;
    }
    predictions.push({
      matchKey: sample.matchKey,
      playedAt: sample.playedAt,
      playerA: sample.playerA,
      playerB: sample.playerB,
      winner: sample.labelA ? sample.playerA : sample.playerB,
      probabilityA: clamp(outcome.probabilityA, 1e-6, 1 - 1e-6),
      confidence: outcome.confidence,
      labelA: sample.labelA,
    });
  }

  predictions.sort((a, b) => a.playedAt - b.playedAt);
  const splitIndex = Math.max(1, Math.min(predictions.length - 1, Math.floor(predictions.length * trainFraction)));
  const hasSplit = predictions.length >= 2;
  const train = hasSplit ? predictions.slice(0, splitIndex) : predictions;
  const test = hasSplit ? predictions.slice(splitIndex) : predictions;

  const rawTrain = computeBinaryMetrics(train);
  const rawTest = computeBinaryMetrics(test);
  const rawBins = computeCalibrationBins(test, bins);

  const model = train.length >= 20 ? fitPlattScaling(train) : null;
  const calibratedTest = model ? applyPlattScaling(test, model) : test;
  const calibratedTestMetrics = computeBinaryMetrics(calibratedTest);
  const calibratedBins = computeCalibrationBins(calibratedTest, bins);

  return {
    players: prepared.players,
    consideredMatches: prepared.consideredMatches,
    eligibleMatches: predictions.length,
    samples: predictions.length,
    trainSamples: train.length,
    testSamples: test.length,
    skipped,
    raw: {
      train: rawTrain,
      test: rawTest,
      calibration: rawBins,
    },
    calibrated: {
      test: calibratedTestMetrics,
      calibration: calibratedBins,
      model,
    },
  };
}

export async function buildBacktestSamples(
  options: BacktestOptions,
): Promise<PreparedBacktestData> {
  const matchesPerPlayer = Math.max(20, options.matchesPerPlayer ?? 150);
  const featureLimit = Math.max(1, options.featureLimit ?? 10);
  const minHistory = Math.max(1, options.minHistory ?? featureLimit);

  const uniquePlayers = dedupePlayers(options.players);
  if (uniquePlayers.length < 2) {
    throw new Error('Backtest needs at least two distinct players.');
  }
  const playerSet = new Set(uniquePlayers.map((name) => normalizeName(name)));

  const histories = new Map<string, HistoryEntry[]>();
  for (const player of uniquePlayers) {
    const norm = normalizeName(player);
    const matches = await fetchUserMatches(player, matchesPerPlayer, { rankedOnly: true });
    const entries = matches
      .map((match) => ({
        playedAt: normalizeTimestampMs(match?.date ?? match?.timestamp ?? match?.played_at),
        match,
      }))
      .filter(
        (entry): entry is HistoryEntry =>
          entry.playedAt !== null && Number.isFinite(entry.playedAt),
      )
      .sort((a, b) => a.playedAt - b.playedAt);
    histories.set(norm, entries);
  }

  const collected = collectMatchEvents(histories, playerSet);
  const skipped = {
    missingParticipants: collected.rejected.missingParticipants,
    missingWinner: collected.rejected.missingWinner,
    missingHistory: 0,
    modelUnavailable: 0,
  };

  const samples: PreparedBacktestSample[] = [];
  for (const event of collected.events) {
    const historyA = historyBefore(histories.get(event.playerA) ?? [], event.playedAt);
    const historyB = historyBefore(histories.get(event.playerB) ?? [], event.playedAt);

    if (historyA.length < minHistory || historyB.length < minHistory) {
      skipped.missingHistory += 1;
      continue;
    }

    const featuresA = computePlayerFeatures(
      historyA.map((entry) => entry.match),
      event.playerA,
      { limit: featureLimit, anchorMs: event.playedAt },
    );
    const featuresB = computePlayerFeatures(
      historyB.map((entry) => entry.match),
      event.playerB,
      { limit: featureLimit, anchorMs: event.playedAt },
    );
    if (!featuresA || !featuresB) {
      skipped.modelUnavailable += 1;
      continue;
    }

    samples.push({
      matchKey: event.key,
      playedAt: event.playedAt,
      playerA: event.playerA,
      playerB: event.playerB,
      labelA: event.winner === event.playerA ? 1 : 0,
      targetSample: featureLimit,
      featuresA,
      featuresB,
    });
  }

  return {
    players: uniquePlayers,
    consideredMatches: collected.events.length,
    skipped,
    samples,
  };
}

export function computeBinaryMetrics(samples: Array<Pick<PredictionSample, 'probabilityA' | 'labelA' | 'confidence'>>): BinaryMetrics {
  if (!samples.length) {
    return { count: 0, accuracy: 0, avgConfidence: 0, brier: 0, logLoss: 0 };
  }

  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let confidence = 0;
  for (const sample of samples) {
    const p = clamp(sample.probabilityA, 1e-6, 1 - 1e-6);
    const y = sample.labelA;
    const predicted = p >= 0.5 ? 1 : 0;
    if (predicted === y) correct += 1;
    const err = p - y;
    brier += err * err;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    confidence += clamp(sample.confidence, 0, 1);
  }

  return {
    count: samples.length,
    accuracy: correct / samples.length,
    avgConfidence: confidence / samples.length,
    brier: brier / samples.length,
    logLoss: logLoss / samples.length,
  };
}

export function computeCalibrationBins(
  samples: Array<Pick<PredictionSample, 'probabilityA' | 'labelA'>>,
  bins = 10,
): CalibrationBin[] {
  const bucketCount = Math.max(2, bins);
  const grouped = Array.from({ length: bucketCount }, () => [] as Array<Pick<PredictionSample, 'probabilityA' | 'labelA'>>);
  for (const sample of samples) {
    const p = clamp(sample.probabilityA, 0, 1);
    const index = Math.min(bucketCount - 1, Math.floor(p * bucketCount));
    grouped[index].push(sample);
  }

  const results: CalibrationBin[] = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const group = grouped[i];
    const start = i / bucketCount;
    const end = (i + 1) / bucketCount;
    if (!group.length) {
      results.push({
        start,
        end,
        count: 0,
        meanPredicted: 0,
        observedWinRate: 0,
      });
      continue;
    }
    const meanPredicted = group.reduce((sum, item) => sum + item.probabilityA, 0) / group.length;
    const observed = group.reduce((sum, item) => sum + item.labelA, 0) / group.length;
    results.push({
      start,
      end,
      count: group.length,
      meanPredicted,
      observedWinRate: observed,
    });
  }

  return results;
}

export function fitPlattScaling(
  samples: Array<Pick<PredictionSample, 'probabilityA' | 'labelA'>>,
  iterations = 40,
): PlattModel | null {
  if (samples.length < 10) return null;

  let a = 1;
  let b = 0;
  const lambda = 1e-4;

  for (let iter = 0; iter < iterations; iter += 1) {
    let gA = 0;
    let gB = 0;
    let hAA = lambda;
    let hAB = 0;
    let hBB = lambda;

    for (const sample of samples) {
      const y = sample.labelA;
      const s = safeLogit(sample.probabilityA);
      const z = a * s + b;
      const p = sigmoid(z);
      const diff = p - y;
      const w = p * (1 - p);

      gA += diff * s;
      gB += diff;
      hAA += w * s * s;
      hAB += w * s;
      hBB += w;
    }

    const det = hAA * hBB - hAB * hAB;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;

    const stepA = (hBB * gA - hAB * gB) / det;
    const stepB = (hAA * gB - hAB * gA) / det;

    a -= stepA;
    b -= stepB;

    if (Math.abs(stepA) < 1e-6 && Math.abs(stepB) < 1e-6) break;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

export function applyPlattScaling(
  samples: PredictionSample[],
  model: PlattModel,
): PredictionSample[] {
  return samples.map((sample) => {
    const s = safeLogit(sample.probabilityA);
    const calibrated = sigmoid(model.a * s + model.b);
    return {
      ...sample,
      probabilityA: clamp(calibrated, 1e-6, 1 - 1e-6),
    };
  });
}

export function formatBacktestReport(report: BacktestReport): string {
  const lines: string[] = [];
  lines.push('Predict Backtest Report');
  lines.push(`Players: ${report.players.join(', ')}`);
  lines.push(`Matches considered: ${report.consideredMatches}`);
  lines.push(`Samples used: ${report.samples} (train ${report.trainSamples}, test ${report.testSamples})`);
  lines.push(
    `Skipped: history=${report.skipped.missingHistory}, missingParticipants=${report.skipped.missingParticipants}, missingWinner=${report.skipped.missingWinner}, modelUnavailable=${report.skipped.modelUnavailable}`,
  );
  lines.push('');
  lines.push(`Raw Test -> accuracy ${(report.raw.test.accuracy * 100).toFixed(1)}%, brier ${report.raw.test.brier.toFixed(4)}, logloss ${report.raw.test.logLoss.toFixed(4)}`);
  if (report.calibrated.model) {
    lines.push(
      `Calibrated Test -> accuracy ${(report.calibrated.test.accuracy * 100).toFixed(1)}%, brier ${report.calibrated.test.brier.toFixed(4)}, logloss ${report.calibrated.test.logLoss.toFixed(4)} (a=${report.calibrated.model.a.toFixed(4)}, b=${report.calibrated.model.b.toFixed(4)})`,
    );
  } else {
    lines.push('Calibrated Test -> skipped (not enough training samples for Platt scaling)');
  }
  lines.push('');
  lines.push('Calibration bins (test set):');
  lines.push('Range\tCount\tMeanPred\tObserved');
  for (const bin of report.raw.calibration) {
    if (!bin.count) continue;
    lines.push(
      `${bin.start.toFixed(1)}-${bin.end.toFixed(1)}\t${bin.count}\t${bin.meanPredicted.toFixed(3)}\t${bin.observedWinRate.toFixed(3)}`,
    );
  }
  return lines.join('\n');
}

function collectMatchEvents(
  histories: Map<string, HistoryEntry[]>,
  pool: Set<string>,
): CollectedEvents {
  const seen = new Map<string, MatchEvent>();
  let missingParticipants = 0;
  let missingWinner = 0;

  for (const entries of histories.values()) {
    for (const entry of entries) {
      const normalized = normalizeEvent(entry.match, pool);
      if (!normalized) {
        missingParticipants += 1;
        continue;
      }
      if (!normalized.event) {
        if (normalized.reason === 'missingWinner') {
          missingWinner += 1;
        } else {
          missingParticipants += 1;
        }
        continue;
      }
      const event = normalized.event;
      if (!seen.has(event.key)) {
        seen.set(event.key, event);
      }
    }
  }

  return {
    events: Array.from(seen.values()).sort((a, b) => a.playedAt - b.playedAt),
    rejected: {
      missingParticipants,
      missingWinner,
    },
  };
}

function normalizeEvent(
  match: any,
  pool: Set<string>,
): { event: MatchEvent | null; reason?: 'missingParticipants' | 'missingWinner' } | null {
  if (!match || typeof match !== 'object') return null;
  const playedAtValue = normalizeTimestampMs(match.date ?? match.timestamp ?? match.played_at);
  if (playedAtValue === null || !Number.isFinite(playedAtValue)) return null;
  const playedAt = playedAtValue;

  const players: any[] = Array.isArray(match.players) ? match.players : [];
  if (players.length < 2) return { event: null, reason: 'missingParticipants' };

  const mapped = players
    .map((player) => ({
      uuid: player?.uuid ? String(player.uuid) : undefined,
      name: normalizeName(player?.nickname || player?.name || player?.username || player?.id || player?.uuid),
    }))
    .filter((player) => Boolean(player.name));
  if (mapped.length < 2) return { event: null, reason: 'missingParticipants' };

  const unique = dedupeByName(mapped);
  if (unique.length < 2) return { event: null, reason: 'missingParticipants' };

  const firstTwo = unique.slice(0, 2);
  const [one, two] = firstTwo;
  if (!pool.has(one.name) || !pool.has(two.name)) return { event: null, reason: 'missingParticipants' };

  const winnerByUuid = winnerFromUuid(match, firstTwo);
  const winnerByDelta = winnerFromDelta(match, firstTwo);
  const winner = winnerByUuid ?? winnerByDelta;
  if (!winner) return { event: null, reason: 'missingWinner' };

  const sortedPair = [one.name, two.name].sort();
  const key = buildEventKey(match, playedAt, sortedPair);
  return {
    event: {
      key,
      playedAt,
      playerA: one.name,
      playerB: two.name,
      winner,
      match,
    },
  };
}

function winnerFromUuid(
  match: any,
  players: Array<{ uuid?: string; name: string }>,
): string | null {
  const winnerUuid = match?.result?.uuid ? String(match.result.uuid) : null;
  if (!winnerUuid) return null;
  const winner = players.find((player) => player.uuid && player.uuid === winnerUuid);
  return winner?.name ?? null;
}

function winnerFromDelta(
  match: any,
  players: Array<{ uuid?: string; name: string }>,
): string | null {
  const deltas = players.map((player) => ({
    name: player.name,
    delta: findEloChangeForPlayer(match?.changes, player.uuid),
  }));
  const valid = deltas.filter((entry) => Number.isFinite(entry.delta));
  if (valid.length < 2) return null;
  valid.sort((a, b) => Number(b.delta) - Number(a.delta));
  const top = valid[0];
  const second = valid[1];
  if (!top || !second) return null;
  if (!Number.isFinite(top.delta) || !Number.isFinite(second.delta)) return null;
  if (Number(top.delta) <= Number(second.delta)) return null;
  if (Number(top.delta) <= 0) return null;
  return top.name;
}

function historyBefore(entries: HistoryEntry[], anchorMs: number): HistoryEntry[] {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (entries[mid].playedAt < anchorMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return entries.slice(0, lo);
}

function buildEventKey(match: any, playedAt: number, sortedPair: string[]): string {
  const id = match?.id ?? match?.match_id ?? match?.matchId ?? match?.uuid;
  if (id !== undefined && id !== null) {
    return `id:${String(id)}`;
  }
  return `seed:${playedAt}:${sortedPair.join(':')}`;
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    result.push(item);
  }
  return result;
}

function dedupePlayers(players: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of players) {
    const trimmed = (name || '').trim();
    const norm = normalizeName(trimmed);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(trimmed);
  }
  return out;
}

function safeLogit(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
