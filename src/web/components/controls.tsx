import type { Child, JSX } from 'hono/jsx';
import { Field } from './field';

interface Presentation {
  name: string;
  id?: string;
  label: Child;
  help?: string;
  error?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}
type InputProps = Presentation & JSX.IntrinsicElements['input'];
type TextareaProps = Presentation & JSX.IntrinsicElements['textarea'];
type SelectProps = Presentation & JSX.IntrinsicElements['select'];

function describedBy(
  id: string,
  help: string | undefined,
  error: string | undefined,
  existing: unknown,
) {
  return (
    [
      existing,
      help === undefined ? undefined : `${id}-help`,
      error === undefined ? undefined : `${id}-error`,
    ]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .join(' ') || undefined
  );
}

export function Input({
  label,
  help,
  error,
  id,
  ...props
}: Readonly<InputProps>) {
  const controlId = id ?? props.name;

  return (
    <Field id={controlId} label={label} help={help} error={error}>
      <input
        {...props}
        id={controlId}
        aria-describedby={describedBy(
          controlId,
          help,
          error,
          props['aria-describedby'],
        )}
        aria-invalid={error === undefined ? props['aria-invalid'] : true}
      />
    </Field>
  );
}

export function Textarea({
  label,
  help,
  error,
  id,
  ...props
}: Readonly<TextareaProps>) {
  const controlId = id ?? props.name;

  return (
    <Field id={controlId} label={label} help={help} error={error}>
      <textarea
        {...props}
        id={controlId}
        aria-describedby={describedBy(
          controlId,
          help,
          error,
          props['aria-describedby'],
        )}
        aria-invalid={error === undefined ? props['aria-invalid'] : true}
      />
    </Field>
  );
}

export function Select({
  label,
  help,
  error,
  id,
  ...props
}: Readonly<SelectProps>) {
  const controlId = id ?? props.name;

  return (
    <Field id={controlId} label={label} help={help} error={error}>
      <select
        {...props}
        id={controlId}
        aria-describedby={describedBy(
          controlId,
          help,
          error,
          props['aria-describedby'],
        )}
        aria-invalid={error === undefined ? props['aria-invalid'] : true}
      />
    </Field>
  );
}
