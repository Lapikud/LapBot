import {
  birthdayVisibilities,
  validateBirthday,
  type BirthdayVisibility,
} from './birthday';
import { UserError } from './errors';
import {
  choiceField,
  integerField,
  validateSubmission,
  type FormDefinition,
} from './forms';

type BirthdayInput = {
  day: number;
  month: number;
  visibility: BirthdayVisibility;
};

export const birthdayForm: FormDefinition<BirthdayInput> = {
  fields: {
    day: integerField({ key: 'day', label: 'Day', min: 1, max: 31 }),
    month: integerField({ key: 'month', label: 'Month', min: 1, max: 12 }),
    visibility: choiceField({
      key: 'visibility',
      label: 'Visibility',
      choices: birthdayVisibilities,
    }),
  },
};

export function parseBirthdaySubmission(input: {
  day: number;
  month: number;
  visibility?: string;
}): BirthdayInput {
  const visibility =
    birthdayVisibilities.find((value) => value === input.visibility) ??
    'public';
  const result = validateSubmission(birthdayForm, { ...input, visibility });

  if (!result.ok) {
    throw new UserError('That is not a valid date.');
  }

  validateBirthday(result.values.month, result.values.day);

  return result.values;
}
