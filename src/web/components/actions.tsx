import type { Child } from 'hono/jsx';

export function ActionButton({
  action,
  label,
}: Readonly<{ action: string; label: string }>) {
  return (
    <form method="post" action={action}>
      <button type="submit" class="secondary outline">
        {label}
      </button>
    </form>
  );
}

export function FormActions({ children }: Readonly<{ children: Child }>) {
  return <div class="actions">{children}</div>;
}
