import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchUserMatches, RateLimitError } from './api.js';

type StubGet = (url: string) => Promise<{ data: any }>;

function createPagingStub(data: any[]): { stub: StubGet; calls: Array<{ offset: number; limit: number }> } {
  const calls: Array<{ offset: number; limit: number }> = [];
  const stub: StubGet = async (url: string) => {
    const parsed = new URL(url);
    const limit = Number(parsed.searchParams.get('limit') ?? '0');
    const offset = Number(parsed.searchParams.get('offset') ?? '0');
    calls.push({ offset, limit });
    const page = data.slice(offset, offset + limit);
    return { data: page };
  };
  return { stub, calls };
}

describe('fetchUserMatches', () => {
  it('paginates and respects the requested limit', async () => {
    const sample = Array.from({ length: 45 }, (_, idx) => ({ id: idx + 1, type: 2 }));
    const { stub, calls } = createPagingStub(sample);

    const matches = await fetchUserMatches('PlayerOne', 25, { httpGet: stub });

    assert.equal(matches.length, 25);
    assert.deepEqual(
      matches.map((m) => m.id),
      Array.from({ length: 25 }, (_, idx) => idx + 1),
    );
    assert.deepEqual(
      calls.map((c) => c.offset),
      [0, 20],
      'expected two pages: 0 and 20',
    );
  });

  it('filters out non-ranked matches when rankedOnly is set', async () => {
    const sample = [
      { id: 1, type: 2 },
      { id: 2, type: 1 },
      { id: 3, type: 2 },
      { id: 4 }, // unknown type, keep
      { id: 5, type: 3 },
      { id: 6, type: 2 },
    ];
    const { stub } = createPagingStub(sample);

    const matches = await fetchUserMatches('PlayerOne', 10, {
      httpGet: stub,
      pageSize: 3,
      rankedOnly: true,
    });

    assert.deepEqual(
      matches.map((m) => m.id),
      [1, 3, 4, 6],
    );
  });

  it('stops when pages are exhausted', async () => {
    const sample = Array.from({ length: 5 }, (_, idx) => ({ id: idx + 1, type: 2 }));
    const { stub, calls } = createPagingStub(sample);

    const matches = await fetchUserMatches('PlayerOne', 50, { httpGet: stub });

    assert.equal(matches.length, 5);
    assert.deepEqual(
      calls.map((c) => c.offset),
      [0],
      'expected a single page because the first page was short',
    );
  });

  it('stops after repeated filtered pages to avoid runaway pagination', async () => {
    const calls: Array<{ offset: number; limit: number }> = [];
    const stub: StubGet = async (url: string) => {
      const parsed = new URL(url);
      const limit = Number(parsed.searchParams.get('limit') ?? '0');
      const offset = Number(parsed.searchParams.get('offset') ?? '0');
      calls.push({ offset, limit });
      // Always return a full page of unranked matches that will be filtered out.
      return { data: Array.from({ length: limit }, () => ({ type: 1 })) };
    };

    const matches = await fetchUserMatches('PlayerOne', 50, { httpGet: stub, rankedOnly: true, pageSize: 10 });

    assert.equal(matches.length, 0);
    assert.ok(calls.length <= 5, `expected to stop after a few filtered pages, got ${calls.length}`);
  });

  it('surfaces rate limit errors with retry hints', async () => {
    const rateLimited: StubGet = async () => {
      const error: any = new Error('rate limit');
      error.response = { status: 429, headers: { 'retry-after': '10' } };
      throw error;
    };

    await assert.rejects(() => fetchUserMatches('PlayerOne', 10, { httpGet: rateLimited }), (err) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.retryAfterMs, 10000);
      return true;
    });
  });
});
