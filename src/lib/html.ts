const marker = Symbol('html');

export type Html = { readonly [marker]: true; readonly value: string };

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string) =>
  text.replaceAll(/[&<>"']/g, (character) => escapes[character] ?? character);

export const raw = (value: string): Html => ({ [marker]: true, value });

const isHtml = (value: unknown): value is Html =>
  typeof value === 'object' && value !== null && marker in value;

type Value =
  Html | string | number | boolean | null | undefined | readonly Value[];

const isList = (value: Value): value is readonly Value[] =>
  Array.isArray(value);

function render(value: Value): string {
  if (isList(value)) {
    return value.map((item) => render(item)).join('');
  }

  if (isHtml(value)) {
    return value.value;
  }

  if (value === null || value === undefined || value === false) {
    return '';
  }

  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  return raw(
    strings.reduce(
      (out, part, index) =>
        out + part + (index < values.length ? render(values[index]) : ''),
      '',
    ),
  );
}
