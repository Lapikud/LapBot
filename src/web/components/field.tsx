import type { Child } from 'hono/jsx';

export interface FieldProps {
  id: string;
  label: Child;
  help?: string | undefined;
  error?: string | undefined;
  children: Child;
}

export function Field({
  id,
  label,
  help,
  error,
  children,
}: Readonly<FieldProps>) {
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
