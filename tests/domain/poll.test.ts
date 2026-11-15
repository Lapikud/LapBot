import { describe, expect, it } from 'vitest';
import {
  isPollOpen,
  normalizeTitle,
  tally,
  validatePollOptions,
} from '~/domain';

describe('poll rules', () => {
  it('reports winners and ties', () => {
    const options = [{ id: 1 }, { id: 2 }, { id: 3 }];

    expect(
      tally(
        options,
        new Map([
          [1, 2],
          [2, 2],
        ]),
        4,
      ),
    ).toMatchObject({ tie: true, winners: [{ id: 1 }, { id: 2 }] });
    expect(tally(options, new Map([[3, 1]]), 1)).toMatchObject({
      tie: false,
      winners: [{ id: 3 }],
    });
    expect(tally(options, new Map(), 0).winners).toEqual([]);
  });

  it('validates options', () => {
    expect(() => validatePollOptions(['only'])).toThrow('between 2');
    expect(() => validatePollOptions(['A', 'a'])).toThrow('distinct');
    expect(validatePollOptions([' A ', 'B'])).toEqual(['A', 'B']);
  });

  it('treats a passed deadline as closed', () => {
    expect(
      isPollOpen({ status: 'open', closesAt: new Date(Date.now() - 1000) }),
    ).toBe(false);
    expect(isPollOpen({ status: 'open', closesAt: null })).toBe(true);
  });

  it('normalises movie titles', () => {
    expect(normalizeTitle('The Matrix!')).toBe(
      normalizeTitle('  the   MATRIX '),
    );
  });
});
