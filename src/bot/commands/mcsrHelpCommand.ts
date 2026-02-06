import type { ChatCommand, ChatCommandContext } from './commandRegistry.js';
import { CommandRegistry } from './commandRegistry.js';
import { commandLabel } from '../../commands/commandSyntax.js';

export class MCSRHelpCommand implements ChatCommand {
  name = 'mcsrhelp';
  aliases = ['mcsrcommands', 'mcsr'];
  description = 'Show a list of all MCSR commands available.';
  category = 'utility';

  constructor(private readonly registry: CommandRegistry) {}

  async execute(ctx: ChatCommandContext, args: string[]): Promise<void> {
    const elo = commandLabel('elo');
    const lastmatch = commandLabel('lastmatch');
    const today = commandLabel('today');
    const link = commandLabel('link');
    const join = commandLabel('join');
    const copy = [
      'MCSR Commands:',
      `◆ ${elo} {player} ◆ ${lastmatch} {player} ◆ ${today} {player} • Show stats for last 12h ◆ ${link} {mcUsername} • Link your Kick username to a Minecraft username. ◆ ${join} • Invite this bot to your Kick channel by sending ${join} in kickmcsr's chat.`,
    ];
    await replyWithChunks(ctx, copy.join('\n'));
  }
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
