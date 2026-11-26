import { checked, field, type Form } from '~/web/context';

export const textFields = [
  'title',
  'start',
  'end',
  'description',
  'location',
] as const;

export function fieldsOf(form: Form) {
  const capacity = field(form, 'capacity');

  return {
    ...Object.fromEntries(
      textFields.flatMap((name) => {
        const value = field(form, name);

        return value === undefined ? [] : [[name, value]];
      }),
    ),
    icons: checked(form, 'icons'),
    ...(capacity !== undefined && { capacity: Number(capacity) }),
  };
}

export function changesOf(form: Form) {
  const capacity = field(form, 'capacity');

  return {
    ...fieldsOf(form),
    ...(form.has('description') && {
      description: field(form, 'description') ?? null,
    }),
    ...(form.has('location') && { location: field(form, 'location') ?? null }),
    ...(form.has('end') && { end: field(form, 'end') ?? null }),
    ...(form.has('capacity') && {
      capacity: capacity === undefined ? null : Number(capacity),
    }),
  };
}
