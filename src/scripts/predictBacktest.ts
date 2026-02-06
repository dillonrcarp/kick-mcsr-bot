import fs from 'node:fs';
import path from 'node:path';

import {
  formatBacktestReport,
  runPredictBacktest,
  type BacktestOptions,
} from '../mcsr/predictBacktest.js';

interface CliArgs {
  players: string[];
  matchesPerPlayer?: number;
  featureLimit?: number;
  minHistory?: number;
  bins?: number;
  trainFraction?: number;
  jsonOut?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.players.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const options: BacktestOptions = {
    players: args.players,
    matchesPerPlayer: args.matchesPerPlayer,
    featureLimit: args.featureLimit,
    minHistory: args.minHistory,
    calibrationBins: args.bins,
    trainFraction: args.trainFraction,
  };

  const report = await runPredictBacktest(options);
  console.log(formatBacktestReport(report));

  if (args.jsonOut) {
    const outPath = path.resolve(args.jsonOut);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nJSON report written to ${outPath}`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const cli: CliArgs = { players: [] };
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
      case '--bins':
        cli.bins = readNumber(value, 2);
        idx += 2;
        continue;
      case '--train-fraction':
        cli.trainFraction = readFraction(value);
        idx += 2;
        continue;
      case '--json-out':
        cli.jsonOut = value ? value.trim() : undefined;
        idx += 2;
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
  if (!Number.isFinite(num) || num < min) {
    throw new Error(`Invalid numeric argument: ${value}`);
  }
  return Math.floor(num);
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
      '  npm run backtest:predict -- --players playerA,playerB,playerC [options]',
      '',
      'Options:',
      '  --players-file <path>        newline-delimited player list',
      '  --matches-per-player <n>     default 150',
      '  --feature-limit <n>          default 10',
      '  --min-history <n>            default feature-limit',
      '  --bins <n>                   calibration bins (default 10)',
      '  --train-fraction <f>         train split fraction, e.g. 0.8',
      '  --json-out <path>            write machine-readable report',
    ].join('\n'),
  );
}

await main();
