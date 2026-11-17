import { describe, expect, it, vi } from 'vitest';
import type { PollWithOptions } from '~/features/polls/model';
import { pollDetails, renderPoll as pollView } from '~/features/polls/message';

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
  it('renders poll expiry from explicit time regardless of the ambient clock', () => {
    const option = {
      id: 11,
      pollId: 1,
      position: 0,
      label: 'Pizza',
      ref: null,
      url: null,
    };
    const poll: PollWithOptions = {
      id: 1,
      guildId: 'g',
      channelId: 'c',
      messageId: null,
      creatorId: 'u',
      question: 'Lunch?',
      multiple: false,
      anonymous: false,
      showResults: 'closed',
      closesAt: new Date('2000-01-02T12:00:00Z'),
      status: 'open',
      source: null,
      createdAt: new Date('2000-01-01T00:00:00Z'),
      options: [option],
    };
    const results = {
      options: [{ ...option, votes: 1 }],
      voters: 1,
      winners: [{ ...option, votes: 1 }],
      tie: false,
    };
    const beforeClose = new Date('2000-01-02T11:59:59Z');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const open = pollView(poll, results, beforeClose);

      expect(open.controls).toHaveLength(2);
      expect(open.content).not.toContain('Winner');
      expect(open.content).not.toContain('▰');
      vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
      expect(pollView(poll, results, beforeClose)).toEqual(open);
      const closed = pollView(poll, results, new Date('2000-01-02T12:00:00Z'));

      expect(closed.controls).toEqual([]);
      expect(closed.content).toContain('**Winner:** Pizza');
      expect(closed.content).toContain('▰');
    } finally {
      vi.useRealTimers();
    }
  });
});
