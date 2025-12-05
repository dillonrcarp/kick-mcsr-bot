import axios from 'axios';
import type { LastMatch } from '../types/mcsr.js';

const DEFAULT_BASE = 'https://mcsrranked.com/api';

export interface LeaderboardOptions {
  board?: 'elo' | 'phase' | 'predicted' | 'record';
  country?: string | null;
}

export interface LeaderboardEntry extends Record<string, unknown> {}

function apiBase(): string {
  const configured = process.env.MCSR_API_BASE;
  const base = configured && configured.trim() ? configured : DEFAULT_BASE;
  return base.replace(/\/+$/, '');
}

export async function fetchPlayerSummary(username: string): Promise<Record<string, any> | null> {
  if (!username) return null;
  const url = `${apiBase()}/users/${encodeURIComponent(username)}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return payload;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw err;
  }
}

export async function fetchLeaderboardTop(
  limit = 5,
  options: LeaderboardOptions = {},
): Promise<LeaderboardEntry[]> {
  const board = (options.board || 'elo').toLowerCase();
  let path = '/leaderboard';

  switch (board) {
    case 'phase':
      path = '/leaderboard/phase';
      break;
    case 'predicted':
      path = '/leaderboard/phase/predicted';
      break;
    case 'record':
      path = '/leaderboard/record';
      break;
    default:
      path = '/leaderboard';
      break;
  }

  const params = new URLSearchParams();
  if (options.country) {
    params.append('country', options.country);
  }
  const query = params.toString();
  const url = `${apiBase()}${path}${query ? `?${query}` : ''}`;
  const clamped = Math.max(1, Math.min(limit, board === 'phase' || board === 'predicted' ? 12 : 10));

  const { data } = await axios.get(url, { timeout: 8000 });
  const payload = data?.data ?? data;
  if (!payload) return [];

  const list =
    (Array.isArray(payload.users) && payload.users) ||
    (Array.isArray(payload.records) && payload.records) ||
    (Array.isArray(payload) && payload) ||
    [];

  return list.slice(0, clamped);
}

export async function fetchLastMatch(username: string): Promise<LastMatch | null> {
  if (!username) return null;
  const url = `${apiBase()}/matches?player=${encodeURIComponent(username)}&limit=1`;
  const { data } = await axios.get(url, { timeout: 8000 });
  const payload = data?.data ?? data;
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return payload[0];
}
