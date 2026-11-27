import {
  announcementParts,
  applicationAdmin,
  formBuilders,
  holdsAny,
  managePermissions,
  type Permission,
} from '~/core/permission';
import { Layout } from '~/web/layout';

interface Feature {
  name: string;
  text: string;
  command?: string;
  href?: string;
  needs?: Permission | readonly Permission[];
}

const features: readonly Feature[] = [
  {
    name: 'Announcements',
    text: 'Write a post, preview it, then publish it now or schedule it. Drafts can still move channel. Every post ends with a toimetaja line naming its author.',
    command: '/announce',
    href: '/announcements',
    needs: announcementParts,
  },
  {
    name: 'Events',
    text: 'Post an event with RSVP buttons. People who are going get a reminder, and public events can go to the club Google Calendar.',
    command: '/event create',
    href: '/events',
  },
  {
    name: 'Suggest an event',
    text: 'Suggest something to do. The board reviews suggestions.',
    command: '/event suggest',
  },
  {
    name: 'Event suggestions',
    text: 'Review, mark and dismiss event suggestions from members.',
    href: '/events/suggestions',
    needs: 'event:suggestions:manage',
  },
  {
    name: 'Polls',
    text: 'Ask a question with up to 10 options. Show results live or after it closes.',
    command: '/poll create',
    href: '/polls',
  },
  {
    name: 'Movies',
    text: 'Suggest movies, vote on the next one and plan a movie night.',
    command: '/movie suggest',
    href: '/events/movies',
  },
  {
    name: 'Birthdays',
    text: 'Add your birthday and choose who sees it. The bot congratulates members on the day.',
    command: '/birthday set',
    href: '/birthdays',
  },
  {
    name: 'Forms',
    text: 'Build a form, post it in a channel, and read the answers here. Members fill it in on Discord.',
    href: '/forms',
    needs: formBuilders,
  },
  {
    name: 'Reminders',
    text: 'Get a reminder by DM, or in a channel with mentions. Reminders can repeat.',
    command: '/remindme',
    href: '/reminders',
  },
  {
    name: 'Roles',
    text: 'React to the role panel to pick your roles. Remove the reaction to leave.',
  },
  {
    name: 'Role panels',
    text: 'Choose which roles members can pick themselves, and with which emoji.',
    href: '/settings/roles',
    needs: applicationAdmin,
  },
  {
    name: 'Permissions',
    text: 'Decide what everyone may do by default, and what each role adds.',
    command: '/permissions',
    href: '/settings/permissions',
    needs: managePermissions,
  },
];

interface Counts {
  pending: number;
  events: number;
  polls: number;
}

interface Props {
  can?: ReadonlySet<Permission>;
  now?: Counts;
}

export function HelpPage({ can, now }: Readonly<Props>) {
  const allowed = can ?? new Set<Permission>();

  return (
    <Layout can={can} signedIn={can !== undefined} title="Help" path="/">
      <p class="lead">
        LAPbot is the Lapikud Discord bot. Use Discord for commands and this
        dashboard to manage posts, forms, and settings.
      </p>
      {can === undefined ? (
        <p>
          <a href="/login" role="button">
            Sign in with Discord
          </a>
        </p>
      ) : null}
      {now === undefined ? null : (
        <>
          <h2>Right now</h2>
          <ul class="now">
            {holdsAny(allowed, announcementParts) ? (
              <li>
                <a href="/announcements">
                  {now.pending} drafts and scheduled announcements
                </a>
              </li>
            ) : null}
            <li>
              <a href="/events">{now.events} upcoming events</a>
            </li>
            <li>
              <a href="/polls">{now.polls} open polls</a>
            </li>
          </ul>
        </>
      )}
      <h2>{can === undefined ? 'What it does' : 'What you can do'}</h2>
      <div class="features">
        {features
          .filter(
            ({ needs }) => needs === undefined || holdsAny(allowed, needs),
          )
          .map(({ name, text, command, href }) => (
            <article key={name}>
              <h3>{name}</h3>
              <p>{text}</p>
              {command === undefined && href === undefined ? null : (
                <footer>
                  {command === undefined ? null : <code>{command}</code>}
                  {href === undefined ? null : <a href={href}>Open</a>}
                </footer>
              )}
            </article>
          ))}
      </div>
      <h2>Mentions</h2>
      <p>
        Mention anyone by typing @ in Discord or in the Mention box here.
        Pinging @everyone, @here or a role that isn't mentionable needs
        Discord's Mention Everyone permission in that channel.
      </p>
      <h2>Missing something?</h2>
      <p>
        What you see depends on your permissions. Ask the board to give your
        role more on the Permissions page.
      </p>
    </Layout>
  );
}
