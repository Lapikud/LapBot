import { describe, expect, it } from 'vitest';
import { parseBirthdaySubmission, validatePollResponse } from '~/domain';

describe('feature input composition', () => {
  it('keeps birthday fallback privacy and calendar validity', () => {
    expect(parseBirthdaySubmission({ day: 29, month: 2 })).toEqual({
      day: 29,
      month: 2,
      visibility: 'public',
    });
    expect(
      parseBirthdaySubmission({ day: 1, month: 1, visibility: 'unknown' })
        .visibility,
    ).toBe('public');
    expect(
      parseBirthdaySubmission({ day: 1, month: 1, visibility: 'private' })
        .visibility,
    ).toBe('private');
    expect(() => parseBirthdaySubmission({ day: 30, month: 2 })).toThrow(
      'That is not a valid date.',
    );
    expect(() => parseBirthdaySubmission({ day: 32, month: 1 })).toThrow(
      'That is not a valid date.',
    );
  });

  it('normalizes duplicate choices and preserves numeric identities', () => {
    const options = [
      { id: 11, label: 'A' },
      { id: 22, label: 'B' },
    ];

    expect(validatePollResponse(options, false, [22, 22])).toEqual([22]);
    expect(validatePollResponse(options, true, [22, 11])).toEqual([22, 11]);
    expect(validatePollResponse(options, false, [])).toEqual([]);
    expect(() => validatePollResponse(options, false, [11, 22])).toThrow(
      'This poll allows only one choice.',
    );
    expect(() => validatePollResponse(options, true, [33])).toThrow(
      'That option is not part of this poll.',
    );
  });
});
