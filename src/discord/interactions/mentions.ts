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

export function mentionInputs(current: Mentions = {}): LabelBuilder[] {
  const select = new MentionableSelectMenuBuilder()
    .setCustomId('mentions')
    .setRequired(false)
    .setMaxValues(25);

  if ((current.roles ?? []).length > 0) {
    select.addDefaultRoles(...(current.roles ?? []));
  }

  if ((current.users ?? []).length > 0) {
    select.addDefaultUsers(...(current.users ?? []));
  }

  return [
    new LabelBuilder()
      .setLabel('Mention')
      .setMentionableSelectMenuComponent(select),
    new LabelBuilder().setLabel('Ping').setCheckboxGroupComponent(
      new CheckboxGroupBuilder()
        .setCustomId('pings')
        .setRequired(false)
        .setMinValues(0)
        .setOptions(
          { label: '@here', value: 'here', default: current.here === true },
          {
            label: '@everyone',
            value: 'everyone',
            default: current.everyone === true,
          },
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
