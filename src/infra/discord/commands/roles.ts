import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { RoleService } from '~/core/roles';
import { defineListener } from '../define';
import type { Feature } from '../module';

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

export function roleCommands(roles: RoleService): Feature {
  const added = defineListener(
    Events.MessageReactionAdd,
    async (_ctx, reaction, user) => {
      const key = reactionOf(reaction, user);

      if (key) {
        await roles.reacted(key, true);
      }
    },
  );
  const removed = defineListener(
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
    start: () => roles.syncLegacyPanel(),
  };
}
