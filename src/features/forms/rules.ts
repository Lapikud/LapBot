import { UserError } from '~/core/errors';
import type { Answer, FormField } from './model';

export const fieldsPerPage = 5;
export const maxFields = 25;
export const maxChoices = 25;

export function validateFields(fields: readonly FormField[]): FormField[] {
  if (fields.length > maxFields) {
    throw new UserError(`A form can have at most ${maxFields} questions.`);
  }

  const labels = fields.map((field) => field.label.trim().toLowerCase());

  if (new Set(labels).size !== labels.length) {
    throw new UserError('Each question needs a different label.');
  }

  return fields.map((field) => {
    const label = field.label.trim();
    const options = field.options.map((o) => o.trim()).filter(Boolean);

    if (label === '' || label.length > 45) {
      throw new UserError('Questions need a label of 1-45 characters.');
    }

    if (
      field.kind === 'choice' &&
      (options.length < 2 || options.length > maxChoices)
    ) {
      throw new UserError(
        `"${label}" needs 2-${maxChoices} choices, one per line.`,
      );
    }

    return {
      ...field,
      label,
      options: field.kind === 'choice' ? options : [],
    };
  });
}

export function pagesOf<T>(fields: readonly T[]): T[][] {
  return Array.from(
    { length: Math.ceil(fields.length / fieldsPerPage) },
    (_, page) => fields.slice(page * fieldsPerPage, (page + 1) * fieldsPerPage),
  );
}

export function validateAnswers(
  fields: readonly FormField[],
  values: readonly string[],
): Answer[] {
  return fields.map((field, index) => {
    const value = (values[index] ?? '').trim();

    if (field.required && value === '') {
      throw new UserError(`"${field.label}" is required.`);
    }

    if (
      field.kind === 'number' &&
      value !== '' &&
      !Number.isFinite(Number(value))
    ) {
      throw new UserError(`"${field.label}" must be a number.`);
    }

    if (
      field.kind === 'choice' &&
      value !== '' &&
      !field.options.includes(value)
    ) {
      throw new UserError(`"${field.label}" has an unknown choice.`);
    }

    return { label: field.label, value };
  });
}
