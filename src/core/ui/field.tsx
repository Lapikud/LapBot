import type { Child } from 'hono/jsx';

export type FieldProps = Readonly<{
  id: string;
  label: Child;
  help?: string | undefined;
  error?: string | undefined;
  children: Child;
}>;

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
