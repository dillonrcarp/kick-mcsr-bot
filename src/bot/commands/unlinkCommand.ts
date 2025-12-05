import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { removeLinkedMcName } from '../../storage/linkStore.js';

export class UnlinkCommand implements ChatCommand {
  name = 'unlink';
  aliases = [];
  description = 'Remove your linked Minecraft username.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const target = args?.[0]?.trim() || ctx.username;
    if (!target) {
      await ctx.reply('Usage: !unlink KickUsername');
      return;
    }
    removeLinkedMcName(target);
    await ctx.reply(`Removed linked Minecraft user for ${target}.`);
  }
}
