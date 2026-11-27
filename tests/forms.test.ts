import { describe, expect, it, vi } from 'vitest';
import { parseBirthdaySubmission } from '~/features/birthdays/form';
import { validatePollResponse } from '~/features/polls/form';
import type { FormField } from '~/features/forms/model';
import {
  pagesOf,
  validateAnswers,
  validateFields,
} from '~/features/forms/rules';
import { createFormService, type FormService } from '~/features/forms/service';
import { formCommands } from '~/discord/commands/forms';
import { questionsOf } from '~/web/pages/forms/routes';
import type { AppContext, ComponentInteraction } from '~/discord/contracts';
import { createFormRepository } from '~/integrations/db/forms/repository';
import { noDatabase, testDb } from './db';
import { actor, fakeMessenger, serviceFakes } from './fakes';

describe('birthday submissions', () => {
  it('keeps leap days and defaults unknown visibility to public', () => {
    expect(
      parseBirthdaySubmission({ day: 29, month: 2, visibility: 'unknown' }),
    ).toEqual({ day: 29, month: 2, visibility: 'public' });
    expect(parseBirthdaySubmission({ day: 1, month: 1 })).toEqual({
      day: 1,
      month: 1,
      visibility: 'public',
    });
    for (const visibility of ['public', 'announce', 'private']) {
      expect(
        parseBirthdaySubmission({ day: 1, month: 1, visibility }),
      ).toHaveProperty('visibility', visibility);
    }
  });

  it.each([
    [31, 4],
    [0, 1],
    [32, 1],
    [1, 0],
    [1, 13],
    [1.5, 1],
    [1, 1.5],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid date %s/%s', (day, month) => {
    expect(() => parseBirthdaySubmission({ day, month })).toThrow(
      'That is not a valid date.',
    );
  });
});

describe('poll responses', () => {
  const options = [
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ];

  it('deduplicates choices, preserves order and allows clearing a vote', () => {
    expect(validatePollResponse(options, false, [1, 1])).toEqual([1]);
    expect(validatePollResponse(options, true, [2, 1, 2])).toEqual([2, 1]);
    expect(validatePollResponse(options, false, [])).toEqual([]);
  });

  it('preserves error precedence when too many choices include an invalid option', () => {
    expect(() => validatePollResponse(options, false, [1, 2])).toThrow(
      'This poll allows only one choice.',
    );
    expect(() => validatePollResponse(options, false, [1, 3])).toThrow(
      'This poll allows only one choice.',
    );
    expect(() => validatePollResponse(options, true, [1, 3])).toThrow(
      'That option is not part of this poll.',
    );
  });
});

describe('built forms', () => {
  const question = (overrides: Partial<FormField> = {}): FormField => ({
    label: 'Name',
    kind: 'short',
    required: true,
    options: [],
    placeholder: null,
    ...overrides,
  });

  it('checks questions and splits them into pages of five', () => {
    expect(() => validateFields([question({ label: ' ' })])).toThrow();
    expect(() =>
      validateFields([question(), question({ label: 'name' })]),
    ).toThrow('different label');
    expect(() =>
      validateFields([question({ kind: 'choice', options: ['only'] })]),
    ).toThrow('2-25 choices');
    expect(
      validateFields([
        question({ kind: 'choice', options: [' a', 'b', ''] }),
      ])[0]?.options,
    ).toEqual(['a', 'b']);
    expect(pagesOf([1, 2, 3, 4, 5, 6, 7]).map((page) => page.length)).toEqual([
      5, 2,
    ]);
  });

  it('checks answers against their questions', () => {
    const fields = [
      question(),
      question({ label: 'Age', kind: 'number', required: false }),
      question({ label: 'Pick', kind: 'choice', options: ['a', 'b'] }),
    ];

    expect(validateAnswers(fields, ['Mari', '', 'a'])).toEqual([
      { label: 'Name', value: 'Mari' },
      { label: 'Age', value: '' },
      { label: 'Pick', value: 'a' },
    ]);
    expect(() => validateAnswers(fields, ['', '', 'a'])).toThrow('required');
    expect(() => validateAnswers(fields, ['x', 'old', 'a'])).toThrow('number');
    expect(() => validateAnswers(fields, ['x', '', 'c'])).toThrow('choice');
  });

  describe.skipIf(noDatabase)('form service', () => {
    it('stores responses, posts them, and rejects closed forms', async () => {
      const { messenger } = fakeMessenger();
      const service = createFormService({
        ...serviceFakes(),
        messenger,
        forms: createFormRepository(testDb()),
      });
      const admin = actor({ administrator: true });
      const form = await service.create(admin, 'Sign-up');

      await service.update(admin, form.id, {
        title: 'Sign-up',
        description: null,
        fields: [question()],
        responseChannelId: 'answers',
        mentions: {},
      });
      await service.submit(actor({ userId: 'm' }), form.id, ['Mari']);
      expect(messenger.send).toHaveBeenCalledWith('answers', {
        content: '**Sign-up**: response from <@m>\n**Name:** Mari',
      });
      await service.setStatus(admin, form.id, 'closed');
      await expect(service.submit(actor(), form.id, ['x'])).rejects.toThrow(
        'closed',
      );
      const { responses } = await service.responses(admin, form.id);

      expect(responses.map(({ answers }) => answers)).toEqual([
        [{ label: 'Name', value: 'Mari' }],
      ]);
    });
  });
});

describe('filling in forms on Discord', () => {
  it('collects answers across pages before submitting', async () => {
    const fields = Array.from({ length: 6 }, (_, index): FormField => ({
      label: `Q${index}`,
      kind: 'short',
      required: false,
      options: [],
      placeholder: null,
    }));
    const submit = vi.fn(async () => undefined);
    const feature = formCommands({
      open: async () => ({ id: 1, title: 'Long', status: 'open', fields }),
      submit,
    } as unknown as FormService);
    const save = feature.components?.find((c) => c.prefix === 'forms:page');
    const member = {
      id: 'm',
      guild: { id: 'g', ownerId: 'o' },
      roles: { cache: new Map(), highest: { position: 0 } },
      permissions: { has: () => false },
    };
    const page = (number: number) =>
      ({
        isModalSubmit: () => true,
        user: { id: 'm' },
        member,
        replied: false,
        deferred: false,
        reply: vi.fn(async () => undefined),
        fields: {
          getTextInputValue: (id: string) => `${number}-${id}`,
        },
      }) as unknown as ComponentInteraction;

    await save?.execute(page(0), ['1', '0'], {} as AppContext);
    expect(submit).not.toHaveBeenCalled();
    await save?.execute(page(1), ['1', '1'], {} as AppContext);
    expect(submit).toHaveBeenCalledWith(expect.anything(), 1, [
      '0-q0',
      '0-q1',
      '0-q2',
      '0-q3',
      '0-q4',
      '1-q0',
    ]);
  });
});

describe('form builder submissions', () => {
  const submitted = (extra: Record<string, string>) => {
    const form = new FormData();

    for (const [key, value] of Object.entries({
      rows: '4',
      'label-0': 'A',
      'label-1': 'B',
      'label-2': 'C',
      'label-3': '',
      ...extra,
    })) {
      form.set(key, value);
    }

    return questionsOf(form).map(({ label }) => label);
  };

  it('moves, removes and skips the empty add row', () => {
    expect(submitted({})).toEqual(['A', 'B', 'C']);
    expect(submitted({ move: 'up:1' })).toEqual(['B', 'A', 'C']);
    expect(submitted({ move: 'down:1' })).toEqual(['A', 'C', 'B']);
    expect(submitted({ move: 'up:0' })).toEqual(['A', 'B', 'C']);
    expect(submitted({ remove: '1' })).toEqual(['A', 'C']);
    expect(submitted({ 'label-3': 'D' })).toEqual(['A', 'B', 'C', 'D']);
  });
});
