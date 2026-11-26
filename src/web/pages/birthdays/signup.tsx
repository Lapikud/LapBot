import { ChannelOptions } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  server: Server;
}
export function BirthdaySignup({ server }: Readonly<Props>) {
  return (
    <>
      <h2>Sign-up message</h2>
      <p>
        Post a message with an <q>Add my birthday</q> button. It keeps working
        after restarts, so one post is enough.
      </p>
      <form method="post" action="/birthdays/signup">
        <label htmlFor="signup-channel">Channel</label>
        <fieldset class="grid">
          <select id="signup-channel" name="channelId" required>
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
