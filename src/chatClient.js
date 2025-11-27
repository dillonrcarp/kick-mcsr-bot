// Minimal stub chat client used by kickChannelManager.
// Replace or extend with your real Kick chat client implementation.

async function join(channel) {
  if (!channel) return;
  const normalized = String(channel).trim().toLowerCase();
  if (!normalized) return;
  console.log(`[chatClient] join called for ${normalized} (stub; no-op)`);
}

async function leave(channel) {
  if (!channel) return;
  const normalized = String(channel).trim().toLowerCase();
  if (!normalized) return;
  console.log(`[chatClient] leave called for ${normalized} (stub; no-op)`);
}

module.exports = {
  chatClient: {
    join,
    leave,
  },
};
