import { describe, expect, it } from 'vitest';
import { pollDetails } from '~/core/presentation';

describe('pure publication presentation', () => {
  it('keeps ordered option links in detail messages without controls', () => {
    const input = {
      question: 'Watch?',
      options: [
        { label: 'Papa John', url: 'https://youtu.be/W7bSunrD4WY' },
        { label: 'Plain' },
      ],
    };
    const before = structuredClone(input);

    expect(pollDetails(input)).toEqual([
      {
        content:
          '## Watch? · options\n[1. Papa John](<https://youtu.be/W7bSunrD4WY>)\n2. Plain',
        suppressEmbeds: true,
      },
    ]);
    expect(input).toEqual(before);
  });
});
