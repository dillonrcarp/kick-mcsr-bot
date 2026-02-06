import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPlattScaling,
  computeBinaryMetrics,
  computeCalibrationBins,
  fitPlattScaling,
  type PredictionSample,
} from './predictBacktest.js';

let sampleId = 0;

function makeSample(
  probabilityA: number,
  labelA: 0 | 1,
  confidence = 0.5,
): PredictionSample {
  sampleId += 1;
  return {
    matchKey: `m-${sampleId}`,
    playedAt: sampleId,
    playerA: 'a',
    playerB: 'b',
    winner: labelA ? 'a' : 'b',
    probabilityA,
    confidence,
    labelA,
  };
}

describe('predictBacktest metrics', () => {
  it('computes binary metrics correctly', () => {
    const samples = [
      makeSample(0.9, 1, 0.8),
      makeSample(0.8, 1, 0.7),
      makeSample(0.7, 0, 0.6),
      makeSample(0.1, 0, 0.9),
    ];

    const metrics = computeBinaryMetrics(samples);
    assert.equal(metrics.count, 4);
    assert.equal(metrics.accuracy, 0.75);
    assert.ok(metrics.brier > 0);
    assert.ok(metrics.logLoss > 0);
    assert.ok(metrics.avgConfidence > 0.7 && metrics.avgConfidence < 0.8);
  });

  it('builds calibration bins that preserve sample totals', () => {
    const samples = [
      makeSample(0.05, 0),
      makeSample(0.15, 0),
      makeSample(0.35, 0),
      makeSample(0.45, 1),
      makeSample(0.65, 1),
      makeSample(0.85, 1),
    ];
    const bins = computeCalibrationBins(samples, 5);
    assert.equal(bins.length, 5);
    const count = bins.reduce((sum, bin) => sum + bin.count, 0);
    assert.equal(count, samples.length);
  });

  it('fits and applies Platt scaling', () => {
    const train: PredictionSample[] = [];
    for (let i = 0; i < 50; i += 1) {
      train.push(makeSample(0.2, 0, 0.5));
      train.push(makeSample(0.8, 1, 0.5));
    }

    const model = fitPlattScaling(train);
    assert.ok(model);
    const calibrated = applyPlattScaling(train, model!);

    const raw = computeBinaryMetrics(train);
    const adj = computeBinaryMetrics(calibrated);

    assert.ok(adj.logLoss <= raw.logLoss + 1e-6);
    assert.ok(adj.brier <= raw.brier + 1e-6);
  });
});
