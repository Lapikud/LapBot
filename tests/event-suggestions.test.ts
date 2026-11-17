import { describe, expect, it, vi } from 'vitest';
import { createEventSuggestionService } from '~/features/event-suggestions/service';
import type {
  EventSuggestion,
  EventSuggestionRepository,
} from '~/features/event-suggestions/model';
import {
  actor,
  allowAll,
  denyAll,
  fakeDirectory,
  fakeMessenger,
} from './fakes';

function fixture(authz = allowAll) {
  const rows: EventSuggestion[] = [];
  const repository: EventSuggestionRepository = {
    insert: vi.fn<EventSuggestionRepository['insert']>(async (input) => {
      const row: EventSuggestion = {
        ...input,
        id: rows.length + 1,
        messageId: null,
        status: 'new',
        createdAt: new Date(),
      };

      rows.push(row);

      return row;
    }),
    list: vi.fn<EventSuggestionRepository['list']>(
      async (guildId, offset, limit) =>
        rows
          .filter((row) => row.guildId === guildId)
          .slice(offset, offset + limit),
    ),
    update: vi.fn<EventSuggestionRepository['update']>(
      async (guildId, id, changes) => {
        const row = rows.find(
          (item) => item.guildId === guildId && item.id === id,
        );

        if (!row) {
          throw new Error('not found');
        }

        Object.assign(row, changes);

        return row;
      },
    ),
  };
  const { messenger } = fakeMessenger();
  const service = createEventSuggestionService({
    suggestions: repository,
    authz,
    directory: fakeDirectory(),
    messenger,
  });

  return { rows, repository, messenger, service };
}

describe('event suggestions', () => {
  it('saves a trimmed idea and posts plain content without opting into mentions', async () => {
    const { service, messenger, rows } = fixture();
    const result = await service.suggest(actor(), 'c', '  Park @everyone  ');

    expect(result.posted).toBe(true);
    expect(rows[0]?.text).toBe('Park @everyone');
    expect(rows[0]?.messageId).not.toBeNull();
    expect(messenger.send).toHaveBeenCalledWith('c', {
      content: 'Event suggestion from <@u>:\nPark @everyone',
    });
  });
  it('retains saved ideas when public delivery fails', async () => {
    const { service, messenger, rows } = fixture();

    messenger.send.mockRejectedValueOnce(new Error('offline'));
    expect((await service.suggest(actor(), 'c', 'Park')).posted).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBeNull();
  });
  it('allows ordinary members to suggest but denies inbox and review access', async () => {
    const { service } = fixture(denyAll);

    await expect(service.suggest(actor(), 'c', 'Park')).resolves.toMatchObject({
      posted: true,
    });
    await expect(service.list(actor())).rejects.toThrow('denied');
    await expect(service.review(actor(), 1, 'reviewed')).rejects.toThrow(
      'denied',
    );
  });
  it('rejects empty and oversized input before persistence', async () => {
    const { service, rows } = fixture();

    await expect(service.suggest(actor(), 'c', ' ')).rejects.toThrow();
    await expect(
      service.suggest(actor(), 'c', 'a'.repeat(1501)),
    ).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });
  it('scopes listing and review to the actor guild', async () => {
    const { service, repository } = fixture();

    await service.suggest(actor(), 'c', 'Park');
    expect(await service.list(actor({ guildId: 'other' }))).toEqual([]);
    await expect(
      service.review(actor({ guildId: 'other' }), 1, 'dismissed'),
    ).rejects.toThrow();
    await service.review(actor(), 1, 'reviewed');
    await service.review(actor(), 1, 'new');
    await service.list(actor(), 2);
    expect(repository.list).toHaveBeenLastCalledWith('g', 50, 25);
  });
});
