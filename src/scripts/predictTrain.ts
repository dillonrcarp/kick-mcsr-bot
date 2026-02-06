import fs from 'node:fs';
import path from 'node:path';

import {
  buildBacktestSamples,
  computeBinaryMetrics,
  fitPlattScaling,
  type PreparedBacktestSample,
  type PredictionSample,
} from '../mcsr/predictBacktest.js';
import {
  buildFeatureDeltaVector,
  featureNames,
  type FeatureName,
  type PredictModelArtifact,
  type FeatureDeltaVector,
} from '../mcsr/predictModel.js';
import { predictOutcomeHeuristic } from '../mcsr/predictScore.js';

interface TrainCliArgs {
  players: string[];
  matchesPerPlayer?: number;
  featureLimit?: number;
  minHistory?: number;
  trainFraction?: number;
  iterations?: number;
  learningRate?: number;
  l2?: number;
  modelOut?: string;
  forceSave?: boolean;
}

interface LogisticModel {
  intercept: number;
  weights: Record<FeatureName, number>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.players.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const featureList = featureNames();
  const prepared = await buildBacktestSamples({
    players: args.players,
    matchesPerPlayer: args.matchesPerPlayer,
    featureLimit: args.featureLimit,
    minHistory: args.minHistory,
    trainFraction: args.trainFraction,
  });
  const chronological = [...prepared.samples].sort((a, b) => a.playedAt - b.playedAt);
  if (chronological.length < 40) {
    throw new Error(`Not enough training samples (${chronological.length}). Need at least 40.`);
  }

  const trainFraction = clamp(args.trainFraction ?? 0.8, 0.5, 0.95);
  const splitIndex = Math.max(1, Math.min(chronological.length - 1, Math.floor(chronological.length * trainFraction)));
  const trainSamples = chronological.slice(0, splitIndex);
  const testSamples = chronological.slice(splitIndex);

  const trainRows = trainSamples.map(toRow);
  const testRows = testSamples.map(toRow);

  const trained = trainLogistic(trainRows, {
    features: featureList,
    iterations: args.iterations ?? 600,
    learningRate: args.learningRate ?? 0.08,
    l2: args.l2 ?? 0.001,
  });

  const trainPredRaw = scoreRows(trainRows, trained);
  const testPredRaw = scoreRows(testRows, trained);

  const calibration = fitPlattScaling(trainPredRaw);
  const testPredCalibrated = calibration
    ? applyCalibrationToRows(testPredRaw, calibration.a, calibration.b)
    : testPredRaw;

  const heuristicTest = scoreHeuristic(testSamples);
  const heuristicMetrics = computeBinaryMetrics(heuristicTest);
  const trainedMetrics = computeBinaryMetrics(testPredCalibrated);

  const improved =
    trainedMetrics.logLoss < heuristicMetrics.logLoss &&
    trainedMetrics.brier < heuristicMetrics.brier;

  const artifact: PredictModelArtifact = {
    version: 1,
    createdAt: new Date().toISOString(),
    features: featureList,
    intercept: trained.intercept,
    weights: trained.weights,
    calibration: calibration ?? null,
    training: {
      sampleCount: chronological.length,
      trainCount: trainSamples.length,
      testCount: testSamples.length,
      heuristic: {
        testBrier: heuristicMetrics.brier,
        testLogLoss: heuristicMetrics.logLoss,
      },
      trained: {
        testBrier: trainedMetrics.brier,
        testLogLoss: trainedMetrics.logLoss,
      },
    },
  };

  printSummary({
    sampleCount: chronological.length,
    trainCount: trainSamples.length,
    testCount: testSamples.length,
    heuristicMetrics,
    trainedMetrics,
    improved,
    calibration,
  });

  const outputPath = path.resolve(args.modelOut ?? path.join('data', 'predict-model.json'));
  if (!improved && !args.forceSave) {
    console.log(`Model not saved: trained model did not beat heuristic on both Brier and logloss.`);
    console.log(`Use --force-save to write anyway to ${outputPath}`);
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
  console.log(`Model artifact written to ${outputPath}`);
}

function toRow(sample: PreparedBacktestSample): TrainRow {
  const vector = buildFeatureDeltaVector(sample.featuresA, sample.featuresB);
  return {
    vector,
    label: sample.labelA,
    sample,
  };
}

interface TrainRow {
  vector: FeatureDeltaVector;
  label: 0 | 1;
  sample: PreparedBacktestSample;
}

const FEATURE_NAME_SET = new Set<string>(featureNames());

function trainLogistic(
  rows: TrainRow[],
  options: {
    features: FeatureName[];
    iterations: number;
    learningRate: number;
    l2: number;
  },
): LogisticModel {
  const weights = Object.fromEntries(options.features.map((feature) => [feature, 0])) as Record<FeatureName, number>;
  let intercept = 0;
  const n = rows.length;

  for (let iter = 0; iter < options.iterations; iter += 1) {
    const progress = iter / Math.max(1, options.iterations - 1);
    const lr = options.learningRate * (1 - 0.7 * progress);

    let gradIntercept = 0;
    const gradWeights = Object.fromEntries(options.features.map((feature) => [feature, 0])) as Record<FeatureName, number>;

    for (const row of rows) {
      const z = intercept + dot(weights, row.vector, options.features);
      const p = sigmoid(z);
      const diff = p - row.label;
      gradIntercept += diff;
      for (const feature of options.features) {
        const x = Number(getFeatureValue(row.vector, feature) ?? 0);
        gradWeights[feature] += diff * x;
      }
    }

    intercept -= (lr * gradIntercept) / n;
    for (const feature of options.features) {
      const g = gradWeights[feature] / n + options.l2 * weights[feature];
      weights[feature] -= lr * g;
    }
  }

  return { intercept, weights };
}

function scoreRows(rows: TrainRow[], model: LogisticModel): PredictionSample[] {
  const names = Object.keys(model.weights).filter(isFeatureName);
  return rows.map((row) => {
    const z = model.intercept + dot(model.weights, row.vector, names);
    const p = clamp(sigmoid(z), 1e-6, 1 - 1e-6);
    return {
      matchKey: row.sample.matchKey,
      playedAt: row.sample.playedAt,
      playerA: row.sample.playerA,
      playerB: row.sample.playerB,
      winner: row.sample.labelA ? row.sample.playerA : row.sample.playerB,
      probabilityA: p,
      confidence: 0.5,
      labelA: row.sample.labelA,
    };
  });
}

function applyCalibrationToRows(
  rows: PredictionSample[],
  a: number,
  b: number,
): PredictionSample[] {
  return rows.map((row) => {
    const logit = safeLogit(row.probabilityA);
    const calibrated = clamp(sigmoid(a * logit + b), 1e-6, 1 - 1e-6);
    return {
      ...row,
      probabilityA: calibrated,
    };
  });
}

function scoreHeuristic(samples: PreparedBacktestSample[]): PredictionSample[] {
  const rows: PredictionSample[] = [];
  for (const sample of samples) {
    const outcome = predictOutcomeHeuristic({
      playerA: sample.featuresA,
      playerB: sample.featuresB,
      targetSample: sample.targetSample,
      anchorMs: sample.playedAt,
    });
    if (!outcome) continue;
    rows.push({
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
  return rows;
}

function dot(
  weights: Record<FeatureName, number>,
  vector: FeatureDeltaVector,
  names: FeatureName[],
): number {
  let sum = 0;
  for (const name of names) {
    const w = weights[name];
    const x = getFeatureValue(vector, name);
    if (!Number.isFinite(w) || !Number.isFinite(x)) continue;
    sum += w * x;
  }
  return sum;
}

function getFeatureValue(vector: FeatureDeltaVector, feature: FeatureName): number {
  return vector[feature];
}

function isFeatureName(value: string): value is FeatureName {
  return FEATURE_NAME_SET.has(value);
}

function parseArgs(argv: string[]): TrainCliArgs {
  const cli: TrainCliArgs = { players: [] };
  let idx = 0;
  while (idx < argv.length) {
    const token = argv[idx];
    const value = argv[idx + 1];
    switch (token) {
      case '--players':
        if (value) {
          cli.players.push(...splitCsv(value));
          idx += 2;
          continue;
        }
        break;
      case '--players-file':
        if (value) {
          cli.players.push(...readPlayersFile(value));
          idx += 2;
          continue;
        }
        break;
      case '--matches-per-player':
        cli.matchesPerPlayer = readNumber(value, 1);
        idx += 2;
        continue;
      case '--feature-limit':
        cli.featureLimit = readNumber(value, 1);
        idx += 2;
        continue;
      case '--min-history':
        cli.minHistory = readNumber(value, 1);
        idx += 2;
        continue;
      case '--train-fraction':
        cli.trainFraction = readFraction(value);
        idx += 2;
        continue;
      case '--iterations':
        cli.iterations = readNumber(value, 1);
        idx += 2;
        continue;
      case '--learning-rate':
        cli.learningRate = readPositive(value);
        idx += 2;
        continue;
      case '--l2':
        cli.l2 = readPositive(value);
        idx += 2;
        continue;
      case '--model-out':
        cli.modelOut = value ? value.trim() : undefined;
        idx += 2;
        continue;
      case '--force-save':
        cli.forceSave = true;
        idx += 1;
        continue;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        break;
    }
    throw new Error(`Unknown or incomplete argument: ${token}`);
  }

  return {
    ...cli,
    players: dedupe(cli.players),
  };
}

function printSummary(args: {
  sampleCount: number;
  trainCount: number;
  testCount: number;
  heuristicMetrics: ReturnType<typeof computeBinaryMetrics>;
  trainedMetrics: ReturnType<typeof computeBinaryMetrics>;
  improved: boolean;
  calibration: { a: number; b: number } | null;
}): void {
  console.log('Predict Training Report');
  console.log(`Samples: ${args.sampleCount} (train ${args.trainCount}, test ${args.testCount})`);
  console.log(
    `Heuristic test: brier=${args.heuristicMetrics.brier.toFixed(4)} logloss=${args.heuristicMetrics.logLoss.toFixed(4)} accuracy=${(args.heuristicMetrics.accuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `Trained test:   brier=${args.trainedMetrics.brier.toFixed(4)} logloss=${args.trainedMetrics.logLoss.toFixed(4)} accuracy=${(args.trainedMetrics.accuracy * 100).toFixed(1)}%`,
  );
  if (args.calibration) {
    console.log(`Calibration: a=${args.calibration.a.toFixed(4)} b=${args.calibration.b.toFixed(4)}`);
  } else {
    console.log('Calibration: skipped (insufficient train samples)');
  }
  console.log(`Improved over heuristic on both metrics: ${args.improved ? 'yes' : 'no'}`);
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readPlayersFile(filePath: string): string[] {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
}

function readNumber(value: string | undefined, min: number): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) throw new Error(`Invalid numeric argument: ${value}`);
  return Math.floor(num);
}

function readPositive(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`Invalid positive argument: ${value}`);
  return num;
}

function readFraction(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num >= 1) {
    throw new Error(`Invalid train fraction: ${value}`);
  }
  return num;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const norm = item.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    output.push(item);
  }
  return output;
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npm run train:predict -- --players playerA,playerB,... [options]',
      '',
      'Options:',
      '  --players-file <path>        newline-delimited player list',
      '  --matches-per-player <n>     default 150',
      '  --feature-limit <n>          default 10',
      '  --min-history <n>            default feature-limit',
      '  --train-fraction <f>         default 0.8',
      '  --iterations <n>             default 600',
      '  --learning-rate <f>          default 0.08',
      '  --l2 <f>                     default 0.001',
      '  --model-out <path>           default data/predict-model.json',
      '  --force-save                 save even if model is worse than heuristic',
    ].join('\n'),
  );
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

await main();
