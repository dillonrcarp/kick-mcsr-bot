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
  if (!trimmed.startsWith('!')) return null;

  const [rawName, ...args] = trimmed.split(/\s+/);
  const name = rawName.slice(1).toLowerCase();
  if (!name) return null;
  return { name, args, raw: trimmed };
}
