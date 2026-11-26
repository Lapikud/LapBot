import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { channelMention, type Mentions } from '~/core/message';
import type { Directory } from '~/core/ports/directory';

export async function requireMentions(
  directory: Directory,
  actor: Actor,
  channelId: string,
  mentions: Mentions = {},
): Promise<void> {
  const roles = await Promise.all(
    (mentions.roles ?? []).map((id) => directory.role(actor.guildId, id)),
  );

  if (roles.includes(undefined)) {
    throw new UserError('One of the mentioned roles no longer exists.');
  }

  const restricted =
    mentions.here === true ||
    mentions.everyone === true ||
    roles.some((role) => role?.everyone === true || role?.mentionable !== true);

  if (restricted && !(await directory.canMentionEveryone(actor, channelId))) {
    throw new UserError(
      `You need Mention Everyone in ${channelMention(channelId)} to ping @everyone, @here or that role.`,
    );
  }
}

export async function requirePostable(
  directory: Directory,
  actor: Actor,
  channelId: string,
  mentions?: Mentions,
): Promise<void> {
  if (!(await directory.canPost(actor, channelId))) {
    throw new UserError(
      `You cannot post in ${channelMention(channelId)} yourself.`,
    );
  }

  await requireMentions(directory, actor, channelId, mentions);
}
