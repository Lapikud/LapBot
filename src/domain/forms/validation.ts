import type { FieldDefinition, FormDefinition } from './fields';

export type FieldIssue = { field: string; code: string };
export type ValidationResult<T> =
  { ok: true; values: T } | { ok: false; issues: FieldIssue[] };

export function validateSubmission<T extends Record<string, unknown>>(
  definition: FormDefinition<T>,
  submission: Readonly<Record<string, unknown>>,
): ValidationResult<T> {
  const values: Record<string, unknown> = {};
  const issues: FieldIssue[] = [];

  for (const [key, field] of Object.entries<FieldDefinition<unknown>>(
    definition.fields,
  )) {
    const present = Object.hasOwn(submission, key);
    const result = field.schema.safeParse(
      present ? submission[key] : undefined,
    );

    if (!result.success) {
      issues.push(
        ...result.error.issues.map(({ code }) => ({ field: key, code })),
      );
    } else if (present) {
      Object.defineProperty(values, key, {
        value: result.data,
        enumerable: true,
      });
    }
  }

  // Each field schema validates its corresponding value before this boundary.

  return issues.length === 0
    ? { ok: true, values: values as T }
    : { ok: false, issues };
}
