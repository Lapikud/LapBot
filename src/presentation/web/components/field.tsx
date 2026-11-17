import type { Child } from 'hono/jsx';

export interface FieldProps {
  readonly id: string;
  readonly label: Child;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly children: Child;
}

export function Field({ id, label, help, error, children }: FieldProps) {
  return (
    <label htmlFor={id}>
      {label}
      {children}
      {help === undefined ? null : <small id={`${id}-help`}>{help}</small>}
      {error === undefined ? null : (
        <small id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
