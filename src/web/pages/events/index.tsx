import type { Permission } from '~/core/permission';
import type { Event } from '~/features/events/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Textarea } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import { EventList } from './list';

interface Props {
  upcoming: Event[];
  date: (value: Date | null) => string;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
  canManage: (ownerId: string) => boolean;
}

export function EventPage({
  upcoming,
  date,
  server,
  can,
  flash,
  canManage,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Events"
      path="/events"
      flash={flash}
      actions={
        can.has('event:create') ? <a href="/events/new">New event</a> : null
      }
    >
      <EventList
        upcoming={upcoming}
        date={date}
        server={server}
        canManage={canManage}
      />
      <h2>Suggest an idea</h2>
      <form method="post" action="/events/suggest">
        <Textarea
          label="Idea"
          name="text"
          rows={2}
          maxlength={1500}
          required
          placeholder="e.g. a board game night"
        />
        <ChannelSelect server={server} />
        <p class="hint">Posted in the channel without pinging anyone.</p>
        <button type="submit" class="secondary">
          Suggest
        </button>
      </form>
    </Layout>
  );
}
