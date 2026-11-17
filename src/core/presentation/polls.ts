import {
  controlId,
  discordTime,
  isPollOpen,
  maxContentLength,
  UserError,
  type Message,
} from '~/domain';
import type { NewPoll, Poll, PollResults, PollWithOptions } from '~/core/ports';
function bar(votes: number, total: number): string {
  const filled =
    total <= 0
      ? 0
      : Math.max(0, Math.min(10, Math.round((votes / total) * 10)));

  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

export function describeOutcome(results: PollResults, leader: string): string {
  const label = results.tie ? 'Tie' : leader;

  return `**${label}:** ${results.winners.map((w) => w.label).join(', ')}`;
}

function statusLine(poll: Poll, open: boolean): string {
  if (open) {
    return poll.closesAt === null
      ? 'Open'
      : `Closes ${discordTime(poll.closesAt, 'R')}`;
  }

  return poll.status === 'cancelled' ? 'Cancelled' : 'Closed';
}

export function pollView(
  poll: PollWithOptions,
  results: PollResults,
  now: Date,
): Message {
  const open = isPollOpen(poll, now);
  const showCounts = poll.showResults === 'live' || !open;
  const lines = results.options.map((option, index) => {
    const heading = `**${index + 1}. ${option.label}**`;

    return showCounts
      ? `${heading}\n${bar(option.votes, results.voters)} ${option.votes}`
      : heading;
  });
  const outcome =
    !open && results.winners.length > 0
      ? [describeOutcome(results, 'Winner')]
      : [];
  const footer = [
    `Poll #${poll.id}`,
    poll.multiple ? 'multiple choice' : 'single choice',
    poll.anonymous ? 'anonymous' : 'votes visible to organizers',
    `${results.voters} voter${results.voters === 1 ? '' : 's'}`,
    statusLine(poll, open),
  ].join(' · ');

  return {
    content: [
      `# ${poll.question}`,
      lines.join('\n\n'),
      ...outcome,
      `-# ${footer}`,
    ].join('\n\n'),
    controls: open
      ? [
          [
            {
              kind: 'select',
              id: controlId('polls:vote', poll.id),
              placeholder: poll.multiple ? 'Choose one or more' : 'Choose one',
              min: 1,
              max: poll.multiple ? poll.options.length : 1,
              options: poll.options.map((option) => ({
                label: `${option.position + 1}. ${option.label}`,
                value: String(option.id),
              })),
            },
          ],
          [
            {
              kind: 'button',
              id: controlId('polls:clear', poll.id),
              label: 'Clear my vote',
              style: 'secondary',
            },
          ],
        ]
      : [],
  };
}

// Option details are static; only the final message owns voting controls and counts.
export function pollDetails(
  input: Pick<NewPoll, 'question' | 'options'>,
): Message[] {
  if (
    !input.options.some(
      (option) => option.url !== undefined && option.url !== null,
    )
  ) {
    return [];
  }

  const heading = `## ${input.question} · options`;
  const pages: string[] = [];
  let page = heading;

  for (const [index, option] of input.options.entries()) {
    const label = `${index + 1}. ${option.label}`;
    const line =
      option.url !== undefined && option.url !== null
        ? `[${label}](<${option.url}>)`
        : label;

    if (heading.length + line.length + 1 > maxContentLength) {
      throw new UserError('An option link is too long to post on Discord.');
    }

    if (page.length + line.length + 1 > maxContentLength) {
      pages.push(page);
      page = heading;
    }

    page += `\n${line}`;
  }

  pages.push(page);

  return pages.map((content) => ({ content, suppressEmbeds: true }));
}
