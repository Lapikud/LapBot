import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type MessageMentionOptions,
} from 'discord.js';
import type { Control, Embed, Mentions, Message } from '~/core/message';

const buttonStyles = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export function allowedMentions(
  mentions: Mentions = {},
): MessageMentionOptions {
  return {
    parse: [],
    users: [...(mentions.users ?? [])],
    roles: [...(mentions.roles ?? [])],
  };
}

function embed(source: Embed): EmbedBuilder {
  const built = new EmbedBuilder();

  if (source.title !== undefined) {
    built.setTitle(source.title.slice(0, 256));
  }

  if (source.description !== undefined && source.description !== '') {
    built.setDescription(source.description.slice(0, 4096));
  }

  if (source.url !== undefined) {
    built.setURL(source.url);
  }

  if (source.color !== undefined) {
    built.setColor(source.color);
  }

  if (source.footer !== undefined) {
    built.setFooter({ text: source.footer });
  }

  return built.addFields(
    (source.fields ?? []).map((field) => ({
      name: field.name,
      value: field.value.slice(0, 1024),
      inline: field.inline ?? false,
    })),
  );
}

function control(source: Control): MessageActionRowComponentBuilder {
  if (source.kind === 'button') {
    return new ButtonBuilder()
      .setCustomId(source.id)
      .setLabel(source.label)
      .setStyle(buttonStyles[source.style]);
  }

  return new StringSelectMenuBuilder()
    .setCustomId(source.id)
    .setPlaceholder(source.placeholder)
    .setMinValues(source.min)
    .setMaxValues(source.max)
    .addOptions(
      source.options.map((option) => ({
        label: option.label.slice(0, 100),
        value: option.value,
        default: option.default ?? false,
      })),
    );
}

export function render(message: Message) {
  return {
    content: message.content ?? '',
    embeds: (message.embeds ?? []).map((source) => embed(source)),
    components: (message.controls ?? []).map((row) =>
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        row.map((source) => control(source)),
      ),
    ),
    allowedMentions: allowedMentions(message.mentions),
    ...(message.suppressEmbeds === true && {
      flags: MessageFlags.SuppressEmbeds as const,
    }),
  };
}
