import type { Permission } from '~/core/permission';
import { reminderChoices } from '~/features/events/service';
import { Checkbox } from '~/web/components/choices';
import { Select } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { EventFields } from './fields';

interface Props {
  time: (value: Date | null) => string;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function NewEventPage({ time, server, can, flash }: Readonly<Props>) {
  return (
    <Layout can={can} title="New event" path="/post/events" flash={flash}>
      <form method="post" action="/post/events">
        <EventFields time={time} />
        <div class="grid">
          <ChannelSelect server={server} />
          <Select label="Reminders" name="reminders">
            {reminderChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>
        <fieldset>
          <Checkbox name="native" label="Also create a Discord event" />
          <Checkbox name="icons" label="Show 🗓️ 🕐 📍 icons" checked />
        </fieldset>
        <button type="submit">Create event</button>
      </form>
    </Layout>
  );
}
