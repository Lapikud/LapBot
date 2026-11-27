import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

type Listener = (event?: unknown) => void;

interface Stub {
  handlers: Map<string, Listener>;
  attributes: Map<string, string>;
  dataset: Record<string, string>;
  children: Stub[];
  hidden: boolean;
  id: string;
  value: string;
}

function element(attributes: Record<string, string> = {}): Stub {
  const stub = {
    handlers: new Map<string, Listener>(),
    attributes: new Map(Object.entries(attributes)),
    dataset: {},
    children: [],
    hidden: true,
    id: '',
    value: '',
  };

  return Object.assign(stub, {
    setAttribute: (name: string, value: string) =>
      stub.attributes.set(name, value),
    getAttribute: (name: string) => stub.attributes.get(name),
    removeAttribute: (name: string) => stub.attributes.delete(name),
    addEventListener: (type: string, listener: Listener) =>
      stub.handlers.set(type, listener),
    append: () => undefined,
    scrollIntoView: () => undefined,
  });
}

it('debounces member suggestions and opens the chosen member', async () => {
  const input = element({ 'aria-controls': 'member-options' });
  const list = element();
  const timers: Array<() => Promise<void> | void> = [];
  const fetched: string[] = [];
  let submitted = false;

  Object.assign(input, {
    dataset: { source: '/settings/permissions/members' },
    form: {
      requestSubmit: () => {
        submitted = true;
      },
    },
  });
  Object.assign(list, {
    id: 'member-options',
    replaceChildren: (...items: Stub[]) => {
      list.children = items;
    },
  });

  const script = readFileSync(
    new URL('../src/web/public/combobox.js', import.meta.url),
    'utf8',
  );

  // The script is a checked-in local asset executed against an isolated DOM stub.
  // eslint-disable-next-line sonarjs/code-eval
  runInNewContext(script, {
    document: {
      querySelectorAll: () => [input],
      getElementById: () => list,
      createElement: () => element(),
    },
    setTimeout: (callback: () => Promise<void> | void) => timers.push(callback),
    clearTimeout: () => timers.splice(0),
    AbortController,
    fetch: (url: string) => {
      fetched.push(url);

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([{ id: '123', name: 'Mari Tamm', username: 'mari' }]),
      });
    },
  });

  input.value = 'ma';
  input.handlers.get('input')?.();
  input.value = 'mar';
  input.handlers.get('input')?.();
  await timers[0]?.();

  expect(timers).toHaveLength(1);
  expect(fetched).toEqual(['/settings/permissions/members?q=mar']);
  expect(list.hidden).toBe(false);
  expect(input.attributes.get('aria-expanded')).toBe('true');

  const key = (name: string) =>
    input.handlers.get('keydown')?.({
      key: name,
      preventDefault: () => undefined,
    });

  key('ArrowDown');
  key('Enter');

  expect(input.value).toBe('123');
  expect(submitted).toBe(true);
  expect(list.hidden).toBe(true);
});
