import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { choiceField, integerField, type FormDefinition } from './fields';
import { validateSubmission } from './validation';

describe('semantic form input', () => {
  const visibility = choiceField({
    key: 'visibility',
    label: 'Visibility',
    choices: ['public', 'announce', 'private'] as const,
  });
  const option = choiceField({
    key: 'choices',
    label: 'Choices',
    choices: [11, 22],
  });
  const poll = {
    fields: { choices: { ...option, schema: z.array(option.schema).max(1) } },
  } satisfies FormDefinition<{ choices: number[] }>;

  it('validates string and numeric choices without coercion', () => {
    expect(
      validateSubmission({ fields: { visibility } }, { visibility: 'private' }),
    ).toEqual({ ok: true, values: { visibility: 'private' } });
    expect(validateSubmission(poll, { choices: [22] })).toEqual({
      ok: true,
      values: { choices: [22] },
    });
    expect(validateSubmission(poll, { choices: ['22'] }).ok).toBe(false);
    expect(validateSubmission(poll, { choices: [33] }).ok).toBe(false);
    expect(validateSubmission(poll, { choices: [11, 22] }).ok).toBe(false);
  });

  it('returns field-addressable issues', () => {
    const result = validateSubmission(
      { fields: { visibility } },
      { visibility: 'secret' },
    );

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'visibility', code: 'custom' }],
    });
  });

  it('preserves omitted empty null and empty-array semantics', () => {
    const text = {
      key: 'text' as const,
      label: 'Text',
      kind: 'choice' as const,
      schema: z.string().nullable().optional(),
    };
    const form: FormDefinition<{ text?: string | null }> = { fields: { text } };

    expect(validateSubmission(form, {})).toEqual({ ok: true, values: {} });
    expect(validateSubmission(form, { text: '' })).toEqual({
      ok: true,
      values: { text: '' },
    });
    expect(validateSubmission(form, { text: null })).toEqual({
      ok: true,
      values: { text: null },
    });
    expect(validateSubmission(poll, { choices: [] })).toEqual({
      ok: true,
      values: { choices: [] },
    });
    expect(validateSubmission(poll, {}).ok).toBe(false);
  });

  it('does not copy unknown or inherited properties', () => {
    expect(validateSubmission(poll, { choices: [11], admin: true })).toEqual({
      ok: true,
      values: { choices: [11] },
    });
    const inherited = Object.create({ choices: [11] }) as Record<
      string,
      unknown
    >;

    expect(validateSubmission(poll, inherited).ok).toBe(false);
  });

  it('validates integer bounds without parsing transport strings', () => {
    const day = integerField({ key: 'day', label: 'Day', min: 1, max: 31 });

    expect(validateSubmission({ fields: { day } }, { day: 31 })).toEqual({
      ok: true,
      values: { day: 31 },
    });
    for (const invalid of [0, 32, 1.5, '1', null, Number.NaN]) {
      expect(validateSubmission({ fields: { day } }, { day: invalid }).ok).toBe(
        false,
      );
    }
  });
});
