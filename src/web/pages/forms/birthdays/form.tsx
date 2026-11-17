import type { RoleInfo } from '~/core/ports/directory';
import type { BirthdaySettings } from '~/features/birthdays/model';
import { FormActions } from '~/web/components/actions';
import { Input, Select } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  settings: BirthdaySettings | undefined;
  server: Server;
  roles: RoleInfo[];
}
export function BirthdaySettingsForm({
  settings,
  server,
  roles,
}: Readonly<Props>) {
  return (
    <form method="post" action="/forms/birthdays">
      <ChannelSelect server={server} selected={settings?.channelId} />
      <div class="grid">
        <Select label="Role for the day" name="roleId">
          <option value="">None</option>
          {roles.map(({ id, name }) => (
            <option key={id} value={id} selected={settings?.roleId === id}>
              @{name}
            </option>
          ))}
        </Select>
        <Input
          label="Hour"
          name="hour"
          type="number"
          min={0}
          max={23}
          value={String(settings?.hour ?? 9)}
        />
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
