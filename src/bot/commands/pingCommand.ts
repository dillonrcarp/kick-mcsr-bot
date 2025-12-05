import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';

export class PingCommand implements ChatCommand {
  name = 'ping';
  description = 'Simple latency test.';
  category = 'utility';

  async execute(ctx: ChatCommandContext): Promise<void> {
    await ctx.reply('Pong!');
  }
}
