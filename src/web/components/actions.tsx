import type { Child } from 'hono/jsx';

export function ActionButton({
  action,
  label,
  subject,
  confirm,
}: Readonly<{
  action: string;
  label: string;
  subject?: string;
  confirm?: string;
}>) {
  return (
    <form method="post" action={action}>
      <button
        type="submit"
        class="secondary outline"
        aria-label={subject === undefined ? undefined : `${label} ${subject}`}
        data-confirm={confirm}
      >
        {label}
      </button>
    </form>
  );
}

export function FormActions({ children }: Readonly<{ children: Child }>) {
  return <div class="actions">{children}</div>;
}
