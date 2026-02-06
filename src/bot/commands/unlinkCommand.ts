import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { removeLinkedMcName } from '../../storage/linkStore.js';
import { usageText } from '../../commands/commandSyntax.js';

interface UnlinkDeps {
  removeLinkedMcName: typeof removeLinkedMcName;
}

export class UnlinkCommand implements ChatCommand {
  name = 'unlink';
  aliases = [];
  description = 'Remove your linked Minecraft username.';
  category = 'mcsr';

  private readonly deps: UnlinkDeps;

  constructor(deps?: Partial<UnlinkDeps>) {
    this.deps = {
      removeLinkedMcName: deps?.removeLinkedMcName ?? removeLinkedMcName,
    };
  }

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const target = (ctx.username || '').trim();
    if (!target) {
      await ctx.reply(usageText('unlink'));
      return;
    }
    if (args?.[0]?.trim()) {
      await ctx.reply(`${usageText('unlink')} (removes your own linked account only)`);
      return;
    }

    this.deps.removeLinkedMcName(target);
    await ctx.reply(`Removed linked Minecraft user for ${target}.`);
  }
}
