import { describe, expect, it, vi } from 'vitest';
import { UserError } from '~/core/errors';
import type { Scheduler } from '~/core/ports/scheduler';
import type { NewPoll } from '~/features/polls/model';
import { createPollRepository } from '~/features/polls/repository';
import { createPollService } from '~/features/polls/service';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../fakes';

const base = (overrides: Partial<NewPoll> = {}): NewPoll => ({
  guildId: snowflake(),
  channelId: snowflake(),
  creatorId: snowflake(),
  question: 'Lunch?',
  options: [{ label: 'Pizza' }, { label: 'Sushi' }, { label: 'Tacos' }],
  ...overrides,
});

describe.skipIf(noDatabase)('poll repository', () => {
  const polls = () => createPollRepository(testDb());

  it('replaces a single-choice vote instead of adding another', async () => {
    const poll = await polls().insert(base());
    const [pizza, sushi] = poll.options.map((o) => o.id);
    const user = snowflake();

    await polls().vote(poll.id, user, [pizza ?? 0, pizza ?? 0]);
    expect(await polls().choices(poll.id, user)).toEqual([pizza]);
    await polls().vote(poll.id, user, [sushi ?? 0]);
    expect(await polls().choices(poll.id, user)).toEqual([sushi]);
    await expect(
      polls().vote(poll.id, user, [pizza ?? 0, sushi ?? 0]),
    ).rejects.toThrow('only one');
  });

  it('rejects options from another poll and votes after closing', async () => {
    const poll = await polls().insert(base());
    const other = await polls().insert(base());

    await expect(
      polls().vote(poll.id, snowflake(), [other.options[0]?.id ?? 0]),
    ).rejects.toThrow('not part');
    expect(await polls().finish(poll.id, 'closed')).toBeDefined();
    expect(await polls().finish(poll.id, 'closed')).toBeUndefined();
    await expect(
      polls().vote(poll.id, snowflake(), [poll.options[0]?.id ?? 0]),
    ).rejects.toBeInstanceOf(UserError);
  });

  it('keeps counts exact under concurrent voting', async () => {
    const poll = await polls().insert(base());
    const [pizza, sushi] = poll.options.map((o) => o.id);
    const user = snowflake();

    await Promise.all([
      ...Array.from({ length: 20 }, () =>
        polls().vote(poll.id, snowflake(), [pizza ?? 0]),
      ),
      ...Array.from({ length: 10 }, (_, n) =>
        polls().vote(poll.id, user, [(n % 2 === 0 ? pizza : sushi) ?? 0]),
      ),
    ]);
    expect((await polls().results(poll)).voters).toBe(21);
    expect(await polls().choices(poll.id, user)).toHaveLength(1);
  });
});

describe.skipIf(noDatabase)('poll service', () => {
  const setup = () => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const repository = createPollRepository(testDb());
    const service = createPollService({
      polls: repository,
      scheduler,
      messenger,
      directory: fakeDirectory(),
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });

    return {
      service,
      messenger,
      scheduler,
      repository,
      creator: actor({ guildId: snowflake(), userId: snowflake() }),
    };
  };

  it('publishes, schedules closing and hides live counts when asked', async () => {
    const { service, scheduler, creator } = setup();
    const poll = await service.create(creator, {
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      channelId: 'c',
      showResults: 'closed',
      closes: '1d',
    });

    expect(scheduler.schedule).toHaveBeenCalledOnce();

    const { view } = await service.vote(
      actor({ guildId: creator.guildId, userId: snowflake() }),
      poll.id,
      [poll.options[0]?.id ?? 0],
    );

    expect(view.content).not.toContain('▰');
  });

  it('hides voters of anonymous polls even from managers', async () => {
    const { service, creator } = setup();
    const poll = await service.create(creator, {
      question: 'Q',
      options: ['A', 'B'],
      channelId: 'c',
      anonymous: true,
    });

    await service.vote(
      actor({ guildId: creator.guildId, userId: snowflake() }),
      poll.id,
      [poll.options[0]?.id ?? 0],
    );
    expect((await service.summary(creator, poll.id)).voters).toBeUndefined();
  });
});
