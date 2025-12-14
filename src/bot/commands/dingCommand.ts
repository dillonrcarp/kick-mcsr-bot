import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';

// Lightweight health/latency check-style command that responds to "!ding".
export class DingCommand implements ChatCommand {
  name = 'ding';
  description = 'Respond with dong!';
  category = 'utility';

  async execute(ctx: ChatCommandContext): Promise<void> {
    await ctx.reply('dong!');
  }
}
