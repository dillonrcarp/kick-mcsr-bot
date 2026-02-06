import { PRIMARY_COMMAND_PREFIX } from '../../commands/commandSyntax.js';

export interface ChatCommandContext {
  channel: string;
  username: string;
  message: string;
  reply(text: string): Promise<void>;
}

export interface ChatCommand {
  name: string;
  aliases?: string[];
  description?: string;
  category?: string;
  execute(ctx: ChatCommandContext, args: string[]): Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, ChatCommand>();

  register(command: ChatCommand): void {
    const names = [command.name, ...(command.aliases || [])];
    for (const label of names) {
      const normalized = label?.trim().toLowerCase();
      if (!normalized) continue;
      this.commands.set(normalized, command);
    }
  }

  get(name: string): ChatCommand | undefined {
    const normalized = name?.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.commands.get(normalized);
  }

  async handleMessage(
    ctx: ChatCommandContext,
    prefix: string | string[] = PRIMARY_COMMAND_PREFIX,
  ): Promise<boolean> {
    const raw = ctx.message?.trim();
    if (!raw) return false;

    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    const usedPrefix = prefixes.find((p) => raw.startsWith(p));
    if (!usedPrefix) return false;

    const withoutPrefix = raw.slice(usedPrefix.length).trim();
    if (!withoutPrefix) return false;

    const [name, ...args] = withoutPrefix.split(/\s+/);
    const command = this.get(name);
    if (!command) return false;

    try {
      await command.execute(ctx, args);
    } catch (err) {
      console.error(`Command "${name}" failed:`, err);
      try {
        await ctx.reply('Command error, try again later.');
      } catch (replyErr) {
        console.error('Failed to send error reply', replyErr);
      }
    }

    return true;
  }

  listCommands(): ChatCommand[] {
    return Array.from(new Set(this.commands.values()));
  }
}
