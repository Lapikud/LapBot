import { z } from 'zod';
import { UserError } from '~/core/errors';

interface Option {
  id: number;
  label: string;
}

export function pollResponseForm(
  options: readonly Option[],
  multiple: boolean,
) {
  const allowed = new Set<unknown>(options.map(({ id }) => id));
  const choices = z.array(z.custom<number>((value) => allowed.has(value)));

  return z.object({
    choices: multiple ? choices : choices.max(1),
  });
}

export function validatePollResponse(
  options: readonly Option[],
  multiple: boolean,
  optionIds: readonly number[],
): number[] {
  const result = pollResponseForm(options, multiple).safeParse({
    choices: [...new Set(optionIds)],
  });

  if (!result.success) {
    throw new UserError(
      result.error.issues.some(({ code }) => code === 'too_big')
        ? 'This poll allows only one choice.'
        : 'That option is not part of this poll.',
    );
  }

  return result.data.choices;
}
