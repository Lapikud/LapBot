import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { RoleService } from '~/features/roles/service';
import { createEventListener } from './listener';
import type { Feature } from '~/discord/contracts';

function reactionOf(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  const { message } = reaction;
  const emoji = reaction.emoji.name;

  if (user.bot || message.guildId === null || emoji === null) {
    return null;
  }

  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    emoji,
    userId: user.id,
  };
}

export function roleEvents(
  roles: RoleService,
  guildId: string | undefined,
): Feature {
  const added = createEventListener(
    Events.MessageReactionAdd,
    async (_ctx, reaction, user) => {
      const key = reactionOf(reaction, user);

      if (key) {
        await roles.reacted(key, true);
      }
    },
  );
  const removed = createEventListener(
    Events.MessageReactionRemove,
    async (_ctx, reaction, user) => {
      const key = reactionOf(reaction, user);

      if (key) {
        await roles.reacted(key, false);
      }
    },
  );

  return {
    name: 'roles',
    events: [added, removed],
    ...(guildId !== undefined && { start: () => roles.syncPanels(guildId) }),
  };
}
