import { MessageFlags, type BaseMessageOptions } from 'discord.js';
import type { Repliable } from '~/discord/contracts';
import type { Message as DomainMessage } from '~/core/message';
import { render } from '~/discord/render';

export async function respond(
  interaction: Repliable,
  content: string | Pick<BaseMessageOptions, 'content' | 'embeds'>,
): Promise<void> {
  const message = {
    ...(typeof content === 'string' ? { content } : content),
    allowedMentions: { parse: [] },
  };

  if (interaction.replied) {
    await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
  }
}

export async function respondView(
  interaction: Repliable,
  view: DomainMessage,
): Promise<void> {
  const { content, embeds, components } = render(view);
  const message = {
    content,
    embeds,
    components,
    allowedMentions: { parse: [] },
  };

  if (interaction.replied) {
    await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
  }
}
