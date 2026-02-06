export const PRIMARY_COMMAND_PREFIX = '+';
export const LEGACY_COMMAND_PREFIX = '!';
export const SUPPORTED_COMMAND_PREFIXES = [
  PRIMARY_COMMAND_PREFIX,
  LEGACY_COMMAND_PREFIX,
] as const;

const LINK_COMMAND_NAME = 'link';
const LINK_USAGE_ARGS = 'MinecraftUsername';

export function commandLabel(name: string): string {
  return `${PRIMARY_COMMAND_PREFIX}${name.trim().toLowerCase()}`;
}

export function usageText(name: string, args?: string): string {
  const suffix = args?.trim() ? ` ${args.trim()}` : '';
  return `Usage: ${commandLabel(name)}${suffix}`;
}

export const LINK_COMMAND_USAGE = `${commandLabel(LINK_COMMAND_NAME)} ${LINK_USAGE_ARGS}`;
export const LINK_HINT_TEXT = `link with ${LINK_COMMAND_USAGE}`;
export const LINK_SET_YOURS_TEXT = `Use ${LINK_COMMAND_USAGE} to set yours.`;
