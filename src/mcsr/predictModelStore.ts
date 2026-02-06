import fs from 'node:fs';
import path from 'node:path';

import { featureNames, type PredictModelArtifact } from './predictModel.js';

const DEFAULT_MODEL_PATH = path.resolve('data', 'predict-model.json');

let cachedModel: PredictModelArtifact | null | undefined;
let cachedPath: string | null = null;

export function getPredictModel(): PredictModelArtifact | null {
  const modelPath = resolveModelPath();
  if (cachedModel !== undefined && cachedPath === modelPath) {
    return cachedModel;
  }

  cachedPath = modelPath;
  cachedModel = loadModelFromDisk(modelPath);
  return cachedModel;
}

export function clearPredictModelCache(): void {
  cachedModel = undefined;
  cachedPath = null;
}

function resolveModelPath(): string {
  const configured = process.env.MCSR_PREDICT_MODEL_PATH?.trim();
  return configured ? path.resolve(configured) : DEFAULT_MODEL_PATH;
}

function loadModelFromDisk(modelPath: string): PredictModelArtifact | null {
  if (!fs.existsSync(modelPath)) return null;
  try {
    const raw = fs.readFileSync(modelPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = validateModel(parsed);
    if (!validated) return null;
    return validated;
  } catch (err) {
    console.error('Failed to read predict model artifact:', err);
    return null;
  }
}

function validateModel(input: unknown): PredictModelArtifact | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (!Number.isFinite(obj.intercept)) return null;
  if (!Array.isArray(obj.features) || obj.features.length === 0) return null;
  if (!obj.weights || typeof obj.weights !== 'object') return null;

  const validFeatures = new Set(featureNames());
  const features = (obj.features as unknown[])
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
    .filter((value) => validFeatures.has(value as any));
  if (!features.length) return null;

  const weights = obj.weights as Record<string, unknown>;
  for (const feature of features) {
    if (!Number.isFinite(weights[feature])) return null;
  }

  const calibration = validateCalibration(obj.calibration);

  return {
    version: Number.isFinite(obj.version) ? Number(obj.version) : 1,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    features,
    intercept: Number(obj.intercept),
    weights: Object.fromEntries(features.map((feature) => [feature, Number(weights[feature])])),
    calibration,
    training:
      obj.training && typeof obj.training === 'object'
        ? (obj.training as PredictModelArtifact['training'])
        : undefined,
  };
}

function validateCalibration(value: unknown): PredictModelArtifact['calibration'] {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (!Number.isFinite(obj.a) || !Number.isFinite(obj.b)) return null;
  return {
    a: Number(obj.a),
    b: Number(obj.b),
  };
}
