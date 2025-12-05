import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { removeLinkedMcName } from '../../storage/linkStore.js';

export class UnlinkCommand implements ChatCommand {
  name = 'unlink';
  aliases = [];
  description = 'Remove your linked Minecraft username.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, _args: string[]): Promise<void> {
    removeLinkedMcName(ctx.username);
    await ctx.reply(`Removed linked Minecraft user for ${ctx.username}.`);
  }
}
