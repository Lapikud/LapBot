import { expect, it } from 'vitest';
import { createLogStore } from '~/integrations/logging/store';

it('searches literal text across fields and paginates matching entries', () => {
  const store = createLogStore(':memory:');

  try {
    for (let index = 0; index < 102; index++) {
      store.write(
        JSON.stringify({
          time: index,
          level: 30,
          msg: 'Literal %_ NEEDLE',
          service: 'source',
        }),
      );
    }

    store.write(
      JSON.stringify({
        time: 103,
        level: 10,
        msg: 'Literal %_ NEEDLE',
        service: 'source',
      }),
    );
    const page = store.page({ level: 30, query: '%_ needle source' });

    expect(page.entries).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    const next = store.page({
      level: 30,
      query: '%_ needle source',
      before: page.entries.at(-1)?.id,
    });

    expect(next.entries).toHaveLength(2);
    expect(next.hasMore).toBe(false);
  } finally {
    store.close();
  }
});
