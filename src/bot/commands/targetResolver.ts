import { getPlayerSummary } from '../../mcsr/api.js';
import { getLinkedMcName } from '../../storage/linkStore.js';
import type { ChatCommandContext } from './commandRegistry.js';

export const OWNER_LINK_TOOLTIP =
  'No channel-owner Minecraft account found. Channel owner should link their Minecraft username with !link MinecraftUsername.';
export const SELF_LINK_TOOLTIP =
  'No linked account found for you. Use !link MinecraftUsername to set yours.';

type ResolvedNameSource = 'linked' | 'username';

interface ResolvedName {
  name: string;
  source: ResolvedNameSource;
}

export type SingleTargetSource =
  | 'explicit'
  | 'owner_linked'
  | 'owner_username'
  | 'self_linked'
  | 'self_username';

export type SingleTargetResolution =
  | {
      ok: true;
      name: string;
      source: SingleTargetSource;
    }
  | {
      ok: false;
      message: string;
    };

export async function resolveSinglePlayerTarget(
  ctx: ChatCommandContext,
  args: string[],
): Promise<SingleTargetResolution> {
  const arg = args?.[0]?.trim();
  const wantsSelf = arg?.toLowerCase() === 'me';
  const explicitTarget = arg && !wantsSelf ? arg : null;

  if (explicitTarget) {
    return { ok: true, name: explicitTarget, source: 'explicit' };
  }

  if (wantsSelf) {
    const sender = await resolveSenderTarget(ctx);
    if (sender) {
      return {
        ok: true,
        name: sender.name,
        source: sender.source === 'linked' ? 'self_linked' : 'self_username',
      };
    }
    return { ok: false, message: SELF_LINK_TOOLTIP };
  }

  const owner = await resolveChannelOwnerTarget(ctx);
  if (owner) {
    return {
      ok: true,
      name: owner.name,
      source: owner.source === 'linked' ? 'owner_linked' : 'owner_username',
    };
  }
  return { ok: false, message: OWNER_LINK_TOOLTIP };
}

export async function resolveChannelOwnerTarget(
  ctx: ChatCommandContext,
): Promise<{ name: string; source: ResolvedNameSource } | null> {
  const channelOwner = normalize(ctx.channel);
  if (!channelOwner) return null;

  const ownerLinked = getLinkedMcName(channelOwner);
  if (ownerLinked) {
    return { name: ownerLinked, source: 'linked' };
  }

  const summary = await getPlayerSummary(channelOwner);
  if (summary) {
    return { name: channelOwner, source: 'username' };
  }
  return null;
}

export async function resolveSenderTarget(
  ctx: ChatCommandContext,
): Promise<{ name: string; source: ResolvedNameSource } | null> {
  const sender = normalize(ctx.username);
  if (!sender) return null;

  const senderLinked = getLinkedMcName(sender);
  if (senderLinked) {
    return { name: senderLinked, source: 'linked' };
  }

  const summary = await getPlayerSummary(sender);
  if (summary) {
    return { name: sender, source: 'username' };
  }
  return null;
}

function normalize(value?: string | null): string {
  return (value || '').trim();
}
