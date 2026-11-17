import type { Permission } from '~/core/permission';
import type { Event } from '~/features/events/model';
import { Checkbox } from '~/web/components/choices';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { EventFields } from './fields';

interface Props {
  readonly event: Event;
  readonly time: (value: Date | null) => string;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function EditEventPage({ event, time, can, flash }: Props) {
  return (
    <Layout
      can={can}
      title={`Edit event #${event.id}`}
      path="/post/events"
      flash={flash}
    >
      <form method="post" action={`/post/events/${event.id}`}>
        <EventFields event={event} time={time} />
        <fieldset>
          <Checkbox
            name="icons"
            label="Show 🗓️ 🕐 📍 icons"
            checked={event.icons}
          />
        </fieldset>
        <button type="submit">Save changes</button>
      </form>
    </Layout>
  );
}
