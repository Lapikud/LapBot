import type { Child } from 'hono/jsx';

export function Confirm({
  label,
  question,
  name,
  children,
}: Readonly<{
  label: string;
  question: string;
  name?: string | undefined;
  children: Child;
}>) {
  return (
    <details class="confirm">
      <summary role="button" class="secondary outline" aria-label={name}>
        {label}
      </summary>
      <p>{question}</p>
      {children}
    </details>
  );
}

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
  const name = subject === undefined ? undefined : `${label} ${subject}`;

  if (confirm === undefined) {
    return (
      <form method="post" action={action}>
        <button type="submit" class="secondary outline" aria-label={name}>
          {label}
        </button>
      </form>
    );
  }

  return (
    <Confirm label={label} question={confirm} name={name}>
      <form method="post" action={action}>
        <button type="submit">Yes, {label.toLowerCase()}</button>
      </form>
    </Confirm>
  );
}

export function FormActions({ children }: Readonly<{ children: Child }>) {
  return <div class="actions">{children}</div>;
}
