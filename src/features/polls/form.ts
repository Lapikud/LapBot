import { z } from 'zod';
import { UserError } from '~/core/errors';
import { choiceField, type FormDefinition } from '~/core/forms/fields';
import { validateSubmission } from '~/core/forms/validation';

type Option = { id: number; label: string };

export function pollResponseForm(
  options: readonly Option[],
  multiple: boolean,
): FormDefinition<{ choices: number[] }> {
  const choice = choiceField({
    key: 'choices',
    label: 'Choices',
    choices: options.map(({ id }) => id),
  });
  const choices = z.array(choice.schema);

  return {
    fields: {
      choices: { ...choice, schema: multiple ? choices : choices.max(1) },
    },
  };
}

export function validatePollResponse(
  options: readonly Option[],
  multiple: boolean,
  optionIds: readonly number[],
): number[] {
  const choices = [...new Set(optionIds)];
  const result = validateSubmission(pollResponseForm(options, multiple), {
    choices,
  });

  if (!result.ok) {
    throw new UserError(
      result.issues.some(({ code }) => code === 'too_big')
        ? 'This poll allows only one choice.'
        : 'That option is not part of this poll.',
    );
  }

  return result.values.choices;
}
