import {
  ChannelType,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type TextChannel,
  type User,
} from 'discord.js';
import type { AppContext } from '../../core/feature.js';
import {
  createPanel,
  findReactionPanel,
  findReactionRole,
  replacePanelRoles,
  setPanelMessage,
} from './service.js';
import { selfAssignProblem } from './guards.js';

// Kept verbatim so the message posted by the previous bot is recognised.
export const legacyMessage =
  'Valige endale rolli:\n1 - Tarkvara\n2 - Helpdesk\n3 - Kultuur';

export function legacyRoles(ctx: Pick<AppContext, 'config'>) {
  const { config } = ctx;
  return [
    { emoji: '1️⃣', roleId: config.TARKVARA_ROLE_ID, label: 'Tarkvara' },
    { emoji: '2️⃣', roleId: config.HELPDESK_ROLE_ID, label: 'Helpdesk' },
    { emoji: '3️⃣', roleId: config.KULTUUR_ROLE_ID, label: 'Kultuur' },
  ].flatMap(({ roleId, ...rest }) =>
    roleId === undefined ? [] : [{ roleId, ...rest }],
  );
}

async function findOrPostMessage(
  ctx: AppContext,
  channel: TextChannel,
  storedId: string | null,
  post: () => Promise<Message>,
): Promise<Message> {
  if (storedId !== null) {
    try {
      return await channel.messages.fetch(storedId);
    } catch (error) {
      ctx.log.warn(
        { err: error, messageId: storedId },
        'Stored role panel message is gone',
      );
    }
  }
  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find(
    (message) =>
      message.author.id === ctx.client.user.id &&
      message.content === legacyMessage,
  );
  return existing ?? post();
}

/**
 * Ensures the env-configured reaction panel exists exactly once. Its message
 * ID is persisted, so later restarts never search the channel or repost.
 */
export async function syncLegacyPanel(ctx: AppContext): Promise<void> {
  const channelId = ctx.config.ROLE_SELECTION_CHANNEL_ID;
  if (channelId === undefined) {
    return;
  }
  const channel = await ctx.client.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildText) {
    ctx.log.error(
      { channelId },
      'ROLE_SELECTION_CHANNEL_ID is not a server text channel',
    );
    return;
  }
  const roles = legacyRoles(ctx);
  for (const { roleId, label } of roles) {
    const role = await channel.guild.roles.fetch(roleId);
    const problem = role ? selfAssignProblem(role) : 'does not exist';
    if (problem !== undefined) {
      ctx.log.error(
        { roleId, label, problem },
        'Legacy panel role is not assignable',
      );
    }
  }

  const panel = (await findReactionPanel(
    ctx.db,
    channel.guildId,
    channelId,
  )) ?? {
    id: await createPanel(ctx.db, {
      guildId: channel.guildId,
      channelId,
      kind: 'reaction',
      title: 'Role selection',
      createdBy: ctx.client.user.id,
    }),
    messageId: null,
  };
  await replacePanelRoles(ctx.db, panel.id, roles);

  const message = await findOrPostMessage(
    ctx,
    channel,
    panel.messageId,
    async () => {
      ctx.log.info({ channelId }, 'Posting role selection message');
      return channel.send(legacyMessage);
    },
  );
  if (message.id !== panel.messageId) {
    await setPanelMessage(ctx.db, panel.id, message.id);
  }
  for (const { emoji } of roles) {
    if (message.reactions.cache.get(emoji)?.me !== true) {
      await message.react(emoji);
    }
  }
}

export async function handleReaction(
  ctx: AppContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean,
): Promise<void> {
  const { message } = reaction;
  const emoji = reaction.emoji.name;
  if (user.bot || message.guildId === null || emoji === null) {
    return;
  }
  // One indexed lookup filters out reactions on every other message.
  const roleId = await findReactionRole(ctx.db, {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    emoji,
  });
  if (roleId === undefined) {
    return;
  }
  const guild = await ctx.client.guilds.fetch(message.guildId);
  const role = await guild.roles.fetch(roleId);
  const problem = role ? selfAssignProblem(role) : 'does not exist';
  if (!role || problem !== undefined) {
    ctx.log.warn({ roleId, problem }, 'Skipping reaction role change');
    return;
  }
  const member = await guild.members.fetch(user.id);
  if (member.user.bot) {
    return;
  }
  if (add) {
    await member.roles.add(role, 'Role selection reaction');
  } else {
    await member.roles.remove(role, 'Role selection reaction removed');
  }
  ctx.log.info(
    { guildId: guild.id, userId: user.id, role: role.name, add },
    add ? 'Assigned role' : 'Removed role',
  );
}
