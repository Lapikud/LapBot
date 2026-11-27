import type { Actor } from '~/core/actor';
import { UserError } from '~/core/errors';
import { guard } from '~/core/helpers/authorization';
import { requirePostable } from '~/core/helpers/posting';
import { selfAssignProblem } from '~/core/helpers/roles';
import {
  controlId,
  userMention,
  withMentions,
  type Mentions,
  type Message,
} from '~/core/message';
import type { Authorizer } from '~/core/ports/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger } from '~/core/ports/messenger';
import type {
  Form,
  FormField,
  FormRepository,
  FormResponse,
  FormStatus,
} from './model';
import { validateAnswers, validateFields } from './rules';

const manage = 'form:manage';

export interface FormSettings {
  title: string;
  description: string | null;
  confirmation: string | null;
  fields: readonly FormField[];
  responseChannelId: string | null;
  mentions: Mentions;
}

interface Deps {
  forms: FormRepository;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
}

export function formMessage(form: Form): Message {
  return {
    content: [`# ${form.title}`, form.description].filter(Boolean).join('\n'),
    controls:
      form.status === 'open' && form.fields.length > 0
        ? [
            [
              {
                kind: 'button',
                id: controlId('forms:open', form.id, 0),
                label: 'Fill in',
                style: 'primary',
              },
            ],
          ]
        : [],
  };
}

function responseMessage(form: Form, response: FormResponse): Message {
  return {
    content: [
      `**${form.title}**: response from ${userMention(response.userId)}`,
      ...response.answers.map(
        ({ label, value }) => `**${label}:** ${value === '' ? '-' : value}`,
      ),
    ]
      .join('\n')
      .slice(0, 2000),
  };
}

export function createFormService(deps: Deps) {
  const { forms, messenger, directory, authz, log } = deps;

  const requireForm = async (id: number) => {
    const form = await forms.find(id);

    if (!form || form.status === 'deleted') {
      throw new UserError(`Form #${id} does not exist.`);
    }

    return form;
  };

  const grantsOf = (fields: readonly FormField[]) =>
    fields.flatMap((field) => (field.kind === 'grant' ? field.options : []));

  const requireRoleAdmin = (actor: Actor, fields: readonly FormField[]) => {
    if (grantsOf(fields).length > 0 && !actor.administrator) {
      throw new UserError(
        'Only server administrators can edit forms that give roles.',
      );
    }
  };

  const problemsOf = async (guildId: string, roleIds: readonly string[]) =>
    Promise.all(
      roleIds.map(async (roleId) => {
        const role = await directory.role(guildId, roleId);

        return {
          roleId,
          problem: role ? selfAssignProblem(role) : 'does not exist',
        };
      }),
    );

  const grant = async (actor: Actor, form: Form, values: readonly string[]) => {
    const member = { guildId: actor.guildId, userId: actor.userId };
    const chosen = new Set(
      form.fields.flatMap((field, index) =>
        field.kind === 'grant' ? (values[index] ?? '').split(' ') : [],
      ),
    );
    const checked = await problemsOf(actor.guildId, grantsOf(form.fields));
    const usable = [];

    for (const { roleId, problem } of checked) {
      if (problem === undefined) {
        usable.push(roleId);
      } else {
        log.warn({ roleId, problem }, 'Skipping form role change');
      }
    }

    const added = usable.filter((roleId) => chosen.has(roleId));
    const removed = usable.filter((roleId) => !chosen.has(roleId));
    const reason = `Form: ${form.title}`;

    if (added.length > 0) {
      await directory.addRoles(member, added, reason);
    }

    if (removed.length > 0) {
      await directory.removeRoles(member, removed, reason);
    }
  };

  const refresh = async (form: Form) => {
    if (form.channelId !== null && form.messageId !== null) {
      await messenger.edit(form.channelId, form.messageId, formMessage(form));
    }
  };

  return {
    open: requireForm,
    list: guard(authz, manage, () => forms.list()),
    get: guard(authz, manage, (_actor, id: number) => requireForm(id)),
    create: guard(authz, manage, async (actor, title: string) => {
      if (title.trim() === '' || title.length > 100) {
        throw new UserError('Give the form a title of 1-100 characters.');
      }

      return forms.insert({ title: title.trim(), createdBy: actor.userId });
    }),
    update: guard(
      authz,
      manage,
      async (actor, id: number, settings: FormSettings) => {
        const current = await requireForm(id);

        if (settings.title.trim() === '' || settings.title.length > 100) {
          throw new UserError('Give the form a title of 1-100 characters.');
        }

        if (settings.responseChannelId !== null) {
          await requirePostable(
            directory,
            actor,
            settings.responseChannelId,
            settings.mentions,
          );
        }

        if ((settings.confirmation?.length ?? 0) > 2000) {
          throw new UserError(
            'Keep the message after submitting under 2000 characters.',
          );
        }

        const fields = validateFields(settings.fields);

        requireRoleAdmin(actor, [...current.fields, ...fields]);

        const checked = await problemsOf(actor.guildId, grantsOf(fields));
        const problem = checked.find((c) => c.problem !== undefined)?.problem;

        if (problem !== undefined) {
          throw new UserError(`A chosen role ${problem}.`);
        }

        const updated = await forms.update(id, {
          title: settings.title.trim(),
          description: settings.description,
          confirmation: settings.confirmation,
          fields,
          responseChannelId: settings.responseChannelId,
          mentions:
            settings.responseChannelId === null ? {} : settings.mentions,
        });

        await refresh(updated);

        return updated;
      },
    ),
    post: guard(authz, manage, async (actor, id: number, channelId: string) => {
      const form = await requireForm(id);

      if (form.fields.length === 0) {
        throw new UserError('Add a question before posting the form.');
      }

      await requirePostable(directory, actor, channelId);

      const sent = await messenger.send(channelId, formMessage(form));

      return forms.update(id, { channelId, messageId: sent.messageId });
    }),
    setStatus: guard(
      authz,
      manage,
      async (_actor, id: number, status: FormStatus) => {
        await requireForm(id);

        const updated = await forms.update(id, { status });

        await refresh(updated);

        return updated;
      },
    ),
    remove: guard(authz, manage, async (actor, id: number) => {
      const form = await requireForm(id);

      requireRoleAdmin(actor, form.fields);

      if (form.channelId !== null && form.messageId !== null) {
        await messenger.remove(form.channelId, form.messageId);
      }

      await forms.update(id, {
        status: 'deleted',
        channelId: null,
        messageId: null,
      });
    }),
    submit: async (actor: Actor, id: number, values: readonly string[]) => {
      const form = await requireForm(id);

      if (form.status !== 'open') {
        throw new UserError('This form is closed.');
      }

      const response = await forms.respond({
        formId: form.id,
        userId: actor.userId,
        answers: validateAnswers(form.fields, values),
      });

      if (form.responseChannelId !== null) {
        await messenger
          .send(
            form.responseChannelId,
            withMentions(responseMessage(form, response), form.mentions),
          )
          .catch((error: unknown) => {
            log.error({ error, formId: form.id }, 'Could not post response');
          });
      }

      try {
        await grant(actor, form, values);
      } catch (error) {
        log.error({ error, formId: form.id }, 'Could not update form roles');
        throw new UserError(
          'Your response is saved, but I could not update your roles.',
        );
      }

      return response;
    },
    responses: guard(authz, manage, async (_actor, id: number) => ({
      form: await requireForm(id),
      responses: await forms.responses(id),
    })),
  };
}

export type FormService = ReturnType<typeof createFormService>;
