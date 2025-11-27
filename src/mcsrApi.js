const axios = require('axios');

const { MCSR_API_BASE = 'https://mcsrranked.com/api' } = process.env;

/**
 * Fetches a player's summary from the MCSR Ranked API.
 * Returns null if not found.
 */
async function fetchPlayerSummary(username) {
  if (!username) return null;
  const base = MCSR_API_BASE.replace(/\/+$/, '');
  const url = `${base}/users/${encodeURIComponent(username)}`;

  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    // API returns { status, data }; actual payload is in data.data
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch top leaderboard entries.
 * @param {number} limit number of entries to return (default 5).
 */
async function fetchLeaderboardTop(limit = 5, options = {}) {
  const base = MCSR_API_BASE.replace(/\/+$/, '');
  const board = (options.board || 'elo').toLowerCase();
  let path = '/leaderboard';

  switch (board) {
    case 'phase':
      path = '/leaderboard/phase';
      break;
    case 'predicted':
    case 'phasepredicted':
    case 'phase_predicted':
      path = '/leaderboard/phase/predicted';
      break;
    case 'record':
      path = '/leaderboard/record';
      break;
    case 'elo':
    default:
      path = '/leaderboard';
      break;
  }

  const params = new URLSearchParams();
  if (options.country) params.append('country', options.country);
  const url = `${base}${path}${params.toString() ? `?${params.toString()}` : ''}`;
  const clamped = Math.max(1, Math.min(limit, 10));

  const { data } = await axios.get(url, { timeout: 8000 });
  const payload = data?.data ?? data;
  if (!payload) return [];

  // Records endpoint might return {records: [...]}; others use users
  const list =
    (Array.isArray(payload.users) && payload.users) ||
    (Array.isArray(payload.records) && payload.records) ||
    (Array.isArray(payload) && payload) ||
    [];

  return list.slice(0, clamped);
}

/**
 * Fetches the most recent match for a player.
 * @param {string} username Player nickname
 * @returns {Promise<object|null>}
 */
async function fetchLastMatch(username) {
  if (!username) return null;
  const base = MCSR_API_BASE.replace(/\/+$/, '');
  const url = `${base}/matches?player=${encodeURIComponent(username)}&limit=1`;
  const { data } = await axios.get(url, { timeout: 8000 });
  const payload = data?.data ?? data;
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return payload[0];
}

module.exports = { fetchPlayerSummary, fetchLeaderboardTop, fetchLastMatch };
