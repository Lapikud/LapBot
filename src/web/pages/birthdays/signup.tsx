import { ChannelOptions } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  server: Server;
}
export function BirthdaySignup({ server }: Readonly<Props>) {
  return (
    <>
      <h3>Sign-up message</h3>
      <p class="hint">
        Posts a message with an <q>Add my birthday</q> button. One post keeps
        working after restarts.
      </p>
      <form method="post" action="/birthdays/signup">
        <fieldset role="group">
          <select name="channelId" aria-label="Channel" required>
            <ChannelOptions server={server} />
          </select>
          <button type="submit" class="secondary">
            Post
          </button>
        </fieldset>
      </form>
    </>
  );
}
