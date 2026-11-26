import type { BirthdaySettings } from '~/features/birthdays/model';
import { FormActions } from '~/web/components/actions';
import { Select } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  settings: BirthdaySettings | undefined;
  server: Server;
}
export function BirthdaySettingsForm({ settings, server }: Readonly<Props>) {
  const selectedHour = settings?.hour ?? 9;

  return (
    <form method="post" action="/birthdays">
      <ChannelSelect
        server={server}
        {...(settings && { selected: settings.channelId })}
      />
      <div class="grid">
        <Select label="Announcement time" name="hour" required>
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour} selected={hour === selectedHour}>
              {`${String(hour).padStart(2, '0')}:00`}
            </option>
          ))}
        </Select>
      </div>
      <FormActions>
        <button type="submit" name="action" value="save">
          Save
        </button>
        {settings === undefined ? null : (
          <button
            type="submit"
            name="action"
            value="disable"
            class="secondary outline"
          >
            Turn off
          </button>
        )}
      </FormActions>
    </form>
  );
}
