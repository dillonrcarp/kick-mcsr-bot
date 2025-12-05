import { loadConfig } from './config/env.js';
import { KickMcsrBot } from './bot/kickBot.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = new KickMcsrBot(config);
  await bot.start();
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
