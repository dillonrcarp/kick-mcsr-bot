import fs from 'node:fs';
import path from 'node:path';

const MAX_HEARTBEAT_AGE_MS = 120000;

function fail(message: string): never {
  console.error(`[HEALTHCHECK] ${message}`);
  process.exit(1);
}

function loadSnapshot(): any {
  const filePath = path.resolve('data', 'health.json');
  if (!fs.existsSync(filePath)) {
    fail('health file missing');
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    fail(`health file unreadable: ${(err as Error)?.message ?? 'unknown error'}`);
  }
}

function main(): void {
  const snapshot = loadSnapshot();
  const now = Date.now();

  if (!snapshot.lastHeartbeatAt || now - snapshot.lastHeartbeatAt > MAX_HEARTBEAT_AGE_MS) {
    fail('heartbeat stale');
  }

  if (snapshot.stale) {
    fail('connection stale');
  }

  if (snapshot.status !== 'ok') {
    fail(`unhealthy status=${snapshot.status} state=${snapshot.state ?? 'unknown'}`);
  }

  if (snapshot.state !== 'connected') {
    fail(`disconnected state=${snapshot.state ?? 'unknown'}`);
  }

  console.log(
    `[HEALTHCHECK] ok state=${snapshot.state} lastHeartbeat=${snapshot.lastHeartbeatAt} lastEvent=${snapshot.lastEventAt}`,
  );
}

main();
