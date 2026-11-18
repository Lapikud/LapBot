import { Checkbox } from '~/web/components/choices';
import { Input, Select, Textarea } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  server: Server;
}
export function PollForm({ server }: Readonly<Props>) {
  return (
    <form method="post" action="/post/polls">
      <Input label="Question" name="question" required maxlength={256} />
      <Textarea
        label="Options (one per line, up to 10)"
        name="options"
        rows={5}
        required
      />
      <ChannelSelect server={server} />
      <fieldset>
        <Checkbox name="multiple" label="Allow several choices" />
        <Checkbox name="anonymous" label="Anonymous" />
      </fieldset>
      <div class="grid">
        <Select label="Results" name="results">
          <option value="live">Live</option>
          <option value="closed">After closing</option>
        </Select>
        <Input
          label="Closes"
          name="closes"
          placeholder="e.g. 2h, 1d, fri 18:00"
        />
      </div>
      <button type="submit">Start poll</button>
    </form>
  );
}
