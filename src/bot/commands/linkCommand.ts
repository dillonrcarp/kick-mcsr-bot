import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { setLinkedMcName } from '../../storage/linkStore.js';
import { usageText } from '../../commands/commandSyntax.js';
import { isValidPlayerName, INVALID_NAME_MESSAGE } from './targetResolver.js';

export class LinkCommand implements ChatCommand {
  name = 'link';
  aliases = [];
  description = 'Link your Kick username to a Minecraft username.';
  category = 'mcsr';

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const mcName = args?.[0]?.trim();
    if (!mcName) {
      await ctx.reply(usageText('link', 'MinecraftUsername'));
      return;
    }
    if (!isValidPlayerName(mcName)) {
      await ctx.reply(INVALID_NAME_MESSAGE);
      return;
    }

    setLinkedMcName(ctx.username, mcName);
    await ctx.reply(`Linked Kick user ${ctx.username} to Minecraft user ${mcName}.`);
  }
}
