import {
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ModalSubmitFields,
  type RoleManager,
} from 'discord.js';
import { UserError } from '~/core/errors';
import { controlId, roleMention, userMention } from '~/core/message';
import type { FormField } from '~/features/forms/model';
import { fieldsPerPage, pagesOf } from '~/features/forms/rules';
import type { FormService } from '~/features/forms/service';
import type { ComponentHandler, Feature } from '~/discord/contracts';
import { toActor } from '~/discord/interactions/actor';
import { respond, respondView } from '~/discord/interactions/responses';

const input = (field: FormField, id: string, roles: RoleManager) => {
  const label = new LabelBuilder().setLabel(field.label);

  if (field.kind === 'grant') {
    return label.setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId(id)
        .setRequired(field.required)
        .setMinValues(field.required ? 1 : 0)
        .setMaxValues(field.options.length)
        .addOptions(
          field.options.map((roleId) => ({
            label: (roles.cache.get(roleId)?.name ?? roleId).slice(0, 100),
            value: roleId,
          })),
        ),
    );
  }

  if (field.kind === 'choice') {
    return label.setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId(id)
        .setRequired(field.required)
        .addOptions(
          field.options.map((option) => ({ label: option, value: option })),
        ),
    );
  }

  if (field.kind === 'user') {
    return label.setUserSelectMenuComponent(
      new UserSelectMenuBuilder().setCustomId(id).setRequired(field.required),
    );
  }

  if (field.kind === 'role') {
    return label.setRoleSelectMenuComponent(
      new RoleSelectMenuBuilder().setCustomId(id).setRequired(field.required),
    );
  }

  const text = new TextInputBuilder()
    .setCustomId(id)
    .setRequired(field.required)
    .setStyle(
      field.kind === 'paragraph'
        ? TextInputStyle.Paragraph
        : TextInputStyle.Short,
    );

  if (field.placeholder !== null) {
    text.setPlaceholder(field.placeholder.slice(0, 100));
  }

  return label.setTextInputComponent(text);
};

const valueOf = (fields: ModalSubmitFields, field: FormField, id: string) => {
  if (field.kind === 'grant') {
    return fields.getStringSelectValues(id).join(' ');
  }

  if (field.kind === 'choice') {
    return fields.getStringSelectValues(id).join(', ');
  }

  if (field.kind === 'user') {
    return [...(fields.getSelectedUsers(id)?.keys() ?? [])]
      .map((user) => userMention(user))
      .join(' ');
  }

  if (field.kind === 'role') {
    return [...(fields.getSelectedRoles(id)?.keys() ?? [])]
      .map((role) => roleMention(role))
      .join(' ');
  }

  return fields.getTextInputValue(id);
};

export function formCommands(forms: FormService): Feature {
  const pending = new Map<string, string[]>();

  const open: ComponentHandler = {
    prefix: 'forms:open',
    execute: async (interaction, [rawId, rawPage]) => {
      if (!interaction.isButton()) {
        return;
      }

      const form = await forms.open(Number(rawId));
      const pages = pagesOf(form.fields);
      const page = Number(rawPage);
      const questions = pages[page];

      if (form.status !== 'open') {
        throw new UserError('This form is closed.');
      }

      if (questions === undefined) {
        throw new UserError('This button is invalid.');
      }

      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(controlId('forms:page', form.id, page))
          .setTitle(
            (pages.length > 1
              ? `${form.title} (${page + 1}/${pages.length})`
              : form.title
            ).slice(0, 45),
          )
          .addLabelComponents(
            ...questions.map((field, index) =>
              input(field, `q${index}`, interaction.guild.roles),
            ),
          ),
      );
    },
  };

  const save: ComponentHandler = {
    prefix: 'forms:page',
    execute: async (interaction, [rawId, rawPage]) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const form = await forms.open(Number(rawId));
      const pages = pagesOf(form.fields);
      const page = Number(rawPage);
      const key = `${interaction.user.id}:${form.id}`;
      const values = page === 0 ? [] : (pending.get(key) ?? []);

      for (const [index, field] of (pages[page] ?? []).entries()) {
        values[page * fieldsPerPage + index] = valueOf(
          interaction.fields,
          field,
          `q${index}`,
        );
      }

      if (page + 1 < pages.length) {
        pending.set(key, values);
        await respondView(interaction, {
          content: `Page ${page + 1} of ${pages.length} saved.`,
          controls: [
            [
              {
                kind: 'button',
                id: controlId('forms:open', form.id, page + 1),
                label: 'Continue',
                style: 'primary',
              },
            ],
          ],
        });

        return;
      }

      pending.delete(key);
      await forms.submit(toActor(interaction.member), form.id, values);
      await respond(
        interaction,
        form.confirmation ?? 'Thanks, your response is saved.',
      );
    },
  };

  return {
    name: 'forms',
    permissions: [
      {
        id: 'form:create',
        description: 'Build your own forms and read their responses',
      },
      {
        id: 'form:manage',
        description: "Edit, delete and read everyone's forms",
        advanced: true,
      },
    ],
    components: [open, save],
  };
}
