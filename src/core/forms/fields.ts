import { z } from 'zod';

export type FieldDefinition<T> = {
  key: string;
  label: string;
  kind: 'integer' | 'choice';
  schema: z.ZodType<T>;
};

export type FormDefinition<T extends Record<string, unknown>> = {
  fields: { [K in keyof T]: FieldDefinition<T[K]> & { key: K } };
};

export function choiceField<V extends string | number, K extends string>({
  key,
  label,
  choices,
}: {
  key: K;
  label: string;
  choices: readonly V[];
}): FieldDefinition<V> & { key: K } {
  const allowed: readonly unknown[] = choices;

  return {
    key,
    label,
    kind: 'choice',
    schema: z.custom<V>((value) => allowed.includes(value)),
  };
}

export function integerField<K extends string>({
  key,
  label,
  min,
  max,
}: {
  key: K;
  label: string;
  min: number;
  max: number;
}): FieldDefinition<number> & { key: K } {
  return {
    key,
    label,
    kind: 'integer',
    schema: z.number().int().min(min).max(max),
  };
}
