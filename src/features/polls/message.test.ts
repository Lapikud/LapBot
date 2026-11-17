import { expect, it, vi } from 'vitest';
import type { PollWithOptions, PollRepository } from './model';
import { pollView, createPollService } from './service';
import { tally } from './rules';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../../tests/fakes';

const poll: PollWithOptions = {
  id: 1,
  guildId: 'g',
  channelId: 'c',
  messageId: null,
  creatorId: 'u',
  question: 'Q'.repeat(256),
  multiple: true,
  anonymous: false,
  showResults: 'live',
  closesAt: null,
  status: 'open',
  source: null,
  createdAt: new Date(),
  options: Array.from({ length: 10 }, (_, position) => ({
    id: position + 1,
    pollId: 1,
    position,
    label: `${position} ${'x'.repeat(53)}`,
    ref: null,
    url: `https://example.com/${'x'.repeat(200)}`,
  })),
};

it('keeps the voting message and all tied winners within Discord limits', () => {
  const results = tally(
    poll.options,
    new Map(poll.options.map((o) => [o.id, 1])),
    1,
  );

  for (const status of ['open', 'closed', 'cancelled'] as const) {
    const view = pollView({ ...poll, status }, results);

    expect((view.content ?? '').length).toBeLessThanOrEqual(2000);
    expect(view.content).toContain('▰'.repeat(10));
    for (const option of poll.options) {
      expect(view.content).toContain(option.label);
    }
  }
});

it('renders a bounded bar even if an older snapshot has too few voters', () => {
  const view = pollView(poll, tally(poll.options, new Map([[1, 2]]), 1));

  expect(view.content).toContain('▰'.repeat(10));
  expect(view.content).not.toContain('▰'.repeat(11));
});

it('publishes complete links across detail posts with one final voting message', async () => {
  const { messenger } = fakeMessenger();
  const repository: PollRepository = {
    insert: async () => poll,
    results: async () => tally(poll.options, new Map(), 0),
    setMessage: vi.fn(),
    find: vi.fn(),
    vote: vi.fn(),
    choices: vi.fn(),
    voters: vi.fn(),
    finish: vi.fn(),
    open: vi.fn(),
    latestBySource: vi.fn(),
  };
  const service = createPollService({
    polls: repository,
    messenger,
    scheduler: { schedule: vi.fn(), cancel: vi.fn() },
    directory: fakeDirectory(),
    authz: allowAll,
    log: silentLog,
    timezone: 'Europe/Tallinn',
  });
  const published = await service.publish(actor(), poll);
  const posts = messenger.send.mock.calls.map(([, message]) => message);

  expect(posts.length).toBeGreaterThan(2);
  expect(
    posts.filter((message) => (message.controls?.length ?? 0) > 0),
  ).toHaveLength(1);
  expect(posts.at(-1)?.controls?.length).toBeGreaterThan(0);
  for (const post of posts) {
    expect((post.content ?? '').length).toBeLessThanOrEqual(2000);
  }

  for (const option of poll.options) {
    expect(
      posts
        .slice(0, -1)
        .map((message) => message.content)
        .join('\n'),
    ).toContain(option.url);
  }

  expect(repository.setMessage).toHaveBeenCalledWith(
    poll.id,
    published.messageId,
  );
});
