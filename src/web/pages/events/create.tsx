import type { Permission } from '~/core/permission';
import { reminderChoices } from '~/features/events/service';
import { Checkbox } from '~/web/components/choices';
import { Input, Select } from '~/web/components/controls';
import { MentionPicker } from '~/web/components/mentions';
import { ChannelSelect } from '~/web/components/selectors';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { EventFields } from './fields';

export type DayCheck =
  | { start: string; heading: string; entries: string[] }
  | { start: string; error: string };

interface Props {
  time: (value: Date | null) => string;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
  calendar: boolean;
  day?: DayCheck;
}

function DayResult({ day }: Readonly<{ day: DayCheck }>) {
  if ('error' in day) {
    return <p role="alert">{day.error}</p>;
  }

  return (
    <article>
      <strong>{day.heading}</strong>
      {day.entries.length === 0 ? (
        <p>Nothing else that day.</p>
      ) : (
        <ul>
          {day.entries.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function NewEventPage({
  time,
  server,
  can,
  flash,
  calendar,
  day,
}: Readonly<Props>) {
  return (
    <Layout can={can} title="New event" path="/events" flash={flash}>
      <form method="get" action="/events/new">
        <Input
          label="Check a day"
          name="day"
          placeholder="e.g. fri 18:00"
          help="Shows what is already on that day."
          value={day?.start}
        />
        <button type="submit" class="secondary">
          Check day
        </button>
      </form>
      {day && <DayResult day={day} />}
      <form method="post" action="/events">
        <EventFields time={time} {...(day && { start: day.start })} />
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
        <MentionPicker server={server} />
        <fieldset>
          {calendar && (
            <Checkbox
              name="calendar"
              label="Also add it to the club Google Calendar"
            />
          )}
          <Checkbox name="icons" label="Show 🗓️ 🕐 📍 icons" checked />
        </fieldset>
        <button type="submit">Create event</button>
      </form>
    </Layout>
  );
}
