import {
  controlId,
  maxContentLength,
  userMention,
  type Message,
} from '~/core/message';
import { discordTime, sameCalendarDay } from '~/core/time';
import {
  rsvpStatuses,
  type Event,
  type RsvpCounts,
  type RsvpStatus,
} from './model';

export const rsvpLabels: Record<RsvpStatus, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
};

export function eventView(event: Event, counts: RsvpCounts): Message {
  const cancelled = event.status === 'cancelled';
  const icon = (emoji: string) => (event.icons ? `${emoji} ` : '');
  const endStyle =
    event.endsAt !== null &&
    sameCalendarDay(event.startsAt, event.endsAt, event.timezone)
      ? 't'
      : 'f';
  const end =
    event.endsAt === null ? '' : ` – ${discordTime(event.endsAt, endStyle)}`;
  const going =
    event.capacity === null
      ? String(counts.going)
      : `${counts.going} / ${event.capacity}`;
  const prefix = cancelled ? '[Cancelled] ' : '';
  const lines = [
    `# ${prefix}${event.title}`,
    ...(event.description === null ? [] : [event.description, '']),
    `${icon('🗓️')}${discordTime(event.startsAt, 'D')} (${discordTime(event.startsAt, 'R')})`,
    `${icon('🕐')}${discordTime(event.startsAt, 't')}${end}`,
    ...(event.location === null ? [] : [`${icon('📍')}${event.location}`]),
    '',
    `**Going:** ${going} · **Maybe:** ${counts.maybe}`,
    `-# Event #${event.id} · organized by ${userMention(event.organizerId)}`,
  ];

  return {
    content: lines.join('\n'),
    controls: cancelled
      ? []
      : [
          rsvpStatuses.map((status) => ({
            kind: 'button' as const,
            id: controlId('events:rsvp', event.id, status),
            label: rsvpLabels[status],
            style:
              status === 'going'
                ? ('success' as const)
                : ('secondary' as const),
          })),
        ],
  };
}

export function reminderText(
  event: Event,
  minutes: number,
  going: readonly string[],
) {
  const link =
    event.messageId === null
      ? ''
      : ` https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
  const head = `⏰ **${event.title}** starts ${discordTime(event.startsAt, 'R')} (${minutes} min reminder).${link}`;
  const pinged: string[] = [];
  let length = head.length + 1;

  for (const id of going) {
    const mention = `${userMention(id)} `;

    if (length + mention.length > maxContentLength) {
      break;
    }

    pinged.push(id);
    length += mention.length;
  }

  return {
    content: [head, pinged.map((id) => userMention(id)).join(' ')]
      .filter(Boolean)
      .join('\n'),
    pinged,
  };
}
