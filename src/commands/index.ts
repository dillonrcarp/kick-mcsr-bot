import { SUPPORTED_COMMAND_PREFIXES } from './commandSyntax.js';

export interface CommandContext {
  sender: string;
  channel: string;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  raw?: string;
}

export function parseCommand(raw?: string | null): ParsedCommand | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const prefix = SUPPORTED_COMMAND_PREFIXES.find((value) => trimmed.startsWith(value));
  if (!prefix) return null;

  const [rawName, ...args] = trimmed.split(/\s+/);
  const name = rawName.slice(prefix.length).toLowerCase();
  if (!name) return null;
  return { name, args, raw: trimmed };
}
