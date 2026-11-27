import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('names added mentions and leaves Enter available to the datalist', () => {
  const handlers = new Map<string, (event?: unknown) => void>();
  let removeLabel: string | undefined;
  let prevented = false;
  const search = {
    value: '@Team',
    addEventListener: (type: string, listener: (event?: unknown) => void) =>
      handlers.set(type, listener),
  };
  const chips = { append: () => undefined, addEventListener: () => undefined };
  const picker = {
    querySelector: (selector: string) => {
      if (selector === 'input[list]') {
        return search;
      }

      if (selector === '.chips') {
        return chips;
      }

      return null;
    },
    querySelectorAll: () => [
      { value: '@Team', dataset: { mention: 'role:team' } },
    ],
  };
  const document = {
    querySelectorAll: () => [picker],
    createElement: (tag: string) =>
      tag === 'button'
        ? {
            setAttribute: (name: string, value: string) => {
              if (name === 'aria-label') {
                removeLabel = value;
              }
            },
          }
        : { append: () => undefined },
  };
  const script = readFileSync(
    new URL('../src/web/public/mentions.js', import.meta.url),
    'utf8',
  );

  // The script is a checked-in local asset executed against an isolated DOM stub.
  // eslint-disable-next-line sonarjs/code-eval
  runInNewContext(script, { document });
  handlers.get('input')?.();
  handlers.get('keydown')?.({
    key: 'Enter',
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(removeLabel).toBe('Remove @Team');
  expect(prevented).toBe(false);
});
