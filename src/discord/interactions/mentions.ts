import {
  CheckboxGroupBuilder,
  LabelBuilder,
  MentionableSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitFields,
  type SlashCommandStringOption,
} from 'discord.js';
import { parseMentions, type Mentions } from '~/core/message';

export const mentionOption = (o: SlashCommandStringOption) =>
  o
    .setName('mention')
    .setDescription('Who to ping, e.g. @Tarkvara @someone @here');

export function typedMentions(
  interaction: ChatInputCommandInteraction,
): { mentions: Mentions } | undefined {
  const text = interaction.options.getString('mention');

  return text === null ? undefined : { mentions: parseMentions(text) };
}

export function mentionInputs(): LabelBuilder[] {
  return [
    new LabelBuilder()
      .setLabel('Mention')
      .setMentionableSelectMenuComponent(
        new MentionableSelectMenuBuilder()
          .setCustomId('mentions')
          .setRequired(false)
          .setMaxValues(25),
      ),
    new LabelBuilder()
      .setLabel('Ping')
      .setCheckboxGroupComponent(
        new CheckboxGroupBuilder()
          .setCustomId('pings')
          .setRequired(false)
          .setMinValues(0)
          .setOptions(
            { label: '@here', value: 'here' },
            { label: '@everyone', value: 'everyone' },
          ),
      ),
  ];
}

export function mentionsOf(fields: ModalSubmitFields): Mentions {
  const picked = fields.getSelectedMentionables('mentions');
  const pings = new Set(fields.getCheckboxGroup('pings'));

  return {
    users: [...(picked?.users.keys() ?? [])],
    roles: [...(picked?.roles.keys() ?? [])],
    here: pings.has('here'),
    everyone: pings.has('everyone'),
  };
}
