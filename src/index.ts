import { loadEnv } from './config/env.js';
import { KickBot } from './bot/kickBot.js';

async function main(): Promise<void> {
  const config = loadEnv();
  installProcessGuards();
  const bot = new KickBot(config);
  await bot.start();
}

main().catch((err) => {
  console.error('Bot crashed:', err);
  process.exit(1);
});

function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}
