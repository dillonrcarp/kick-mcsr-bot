import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { CommandRegistry } from './commandRegistry.js';

export class MCSRHelpCommand implements ChatCommand {
  name = 'mcsrhelp';
  aliases = ['mcsrcommands', 'mcsr'];
  description = 'Show a list of all MCSR commands available.';
  category = 'utility';

  constructor(private readonly registry: CommandRegistry) {}

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const commands = this.registry
      .listCommands()
      .filter((command) => (command.category ?? 'mcsr') === 'mcsr');

    if (!commands.length) {
      await ctx.reply('No MCSR commands are currently registered.');
      return;
    }

    const target = args?.[0]?.trim()?.toLowerCase();
    if (target) {
      const match = commands.find(
        (command) =>
          command.name.toLowerCase() === target ||
          (command.aliases || []).some((alias) => alias.toLowerCase() === target),
      );
      if (!match) {
        await ctx.reply(`Unknown command "${target}". Use +mcsrhelp to list available commands.`);
        return;
      }
      await ctx.reply(formatCommandDetails(match));
      return;
    }

    const lines = commands.map((command) => formatCommandSummary(command));
    await replyWithChunks(ctx, ['MCSR Commands:', ...lines].join('\n'));
  }
}

function formatCommandSummary(command: ChatCommand): string {
  const aliasText =
    command.aliases && command.aliases.length > 0
      ? ` aliases: ${command.aliases.map((alias) => `+${alias}`).join(', ')}`
      : '';
  const description = command.description ?? 'No description provided.';
  return `  +${command.name}${aliasText} - ${description}`;
}

function formatCommandDetails(command: ChatCommand): string {
  const aliases =
    command.aliases && command.aliases.length > 0 ? command.aliases.map((alias) => `+${alias}`).join(', ') : 'None';
  return [
    `Command: +${command.name}`,
    `Aliases: ${aliases}`,
    `Description: ${command.description ?? 'No description provided.'}`,
  ].join('\n');
}

async function replyWithChunks(ctx: ChatCommandContext, text: string): Promise<void> {
  const maxLength = 350;
  const lines = text.split('\n');
  let buffer = '';

  for (const line of lines) {
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (candidate.length > maxLength) {
      if (buffer) {
        await ctx.reply(buffer);
      }
      if (line.length > maxLength) {
        await ctx.reply(line);
        buffer = '';
      } else {
        buffer = line;
      }
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    await ctx.reply(buffer);
  }
}
