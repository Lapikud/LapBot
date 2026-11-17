import type { Child } from 'hono/jsx';

export function Checkbox({
  name,
  label,
  checked = false,
  value = '1',
}: Readonly<{
  name: string;
  label: Child;
  checked?: boolean;
  value?: string;
}>) {
  return (
    <label>
      <input type="checkbox" name={name} value={value} checked={checked} />
      {label}
    </label>
  );
}

export type Choice = { name: string; value: string; label: string };

export function MultiSelect({
  label,
  placeholder,
  choices,
  selected,
}: Readonly<{
  label: string;
  placeholder: string;
  choices: readonly Choice[];
  selected: ReadonlySet<string>;
}>) {
  const picked = choices.filter(({ value }) => selected.has(value));

  return (
    <fieldset>
      <legend>{label}</legend>
      <details class="dropdown">
        <summary>
          {picked.length === 0
            ? placeholder
            : picked.map((choice) => choice.label).join(', ')}
        </summary>
        <ul>
          {choices.map((choice) => (
            <li key={`${choice.name}:${choice.value}`}>
              <label>
                <input
                  type="checkbox"
                  name={choice.name}
                  value={choice.value}
                  checked={selected.has(choice.value)}
                />
                {choice.label}
              </label>
            </li>
          ))}
        </ul>
      </details>
    </fieldset>
  );
}
