import { describe, expect, it } from 'vitest';
import { parseBirthdaySubmission } from '~/features/birthdays/form';
import { validatePollResponse } from '~/features/polls/form';

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
