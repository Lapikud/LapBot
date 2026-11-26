import { recurrences } from '~/core/helpers/time';
import type { Permission } from '~/core/permission';
import type { Reminder } from '~/features/reminders/model';
import { ActionButton } from '~/web/components/actions';
import { Input, Select, Textarea } from '~/web/components/controls';
import { MentionPicker } from '~/web/components/mentions';
import { ChannelOptions } from '~/web/components/selectors';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';

interface Props {
  reminders: Reminder[];
  server: Server;
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function ReminderPage({
  reminders,
  server,
  date,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout can={can} title="Reminders" path="/reminders" flash={flash}>
      {reminders.length === 0 ? (
        <p>You have no active reminders.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Message</th>
              <th>When</th>
              <th>Where</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reminders.map((r) => (
              <tr key={r.id}>
                <td>
                  <form
                    method="post"
                    action={`/reminders/${r.id}`}
                    class="inline-edit"
                  >
                    <input
                      name="message"
                      value={r.message}
                      aria-label="Message"
                      maxlength={1000}
                      required
                    />
                    <input
                      name="when"
                      placeholder={date(r.runAt)}
                      aria-label="New time"
                    />
                    <button type="submit" class="secondary">
                      Save
                    </button>
                  </form>
                </td>
                <td>
                  {date(r.runAt)}
                  {r.recurrence === null ? null : (
                    <small> · {r.recurrence}</small>
                  )}
                </td>
                <td>
                  {r.channelId === null
                    ? 'DM'
                    : server.channelName(r.channelId)}
                </td>
                <td>
                  <ActionButton
                    action={`/reminders/${r.id}/cancel`}
                    label="Cancel"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>New reminder</h2>
      <form method="post" action="/reminders">
        <Textarea
          label="Message"
          name="message"
          rows={2}
          maxlength={1000}
          required
        />
        <div class="grid">
          <Input
            label="When"
            name="when"
            placeholder="e.g. 2h, tomorrow 9:00"
          />
          <Select label="Repeat" name="repeat">
            <option value="">Never</option>
            {recurrences.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        {can.has('reminder:channel') ? (
          <>
            <Select label="Where" name="channelId">
              <option value="">Direct message</option>
              <ChannelOptions server={server} />
            </Select>
            <MentionPicker server={server} />
          </>
        ) : null}
        <button type="submit">Remind me</button>
      </form>
    </Layout>
  );
}
