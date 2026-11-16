import { Hono } from 'hono';
import {
  back,
  checked,
  field,
  flashOf,
  formatter,
  type Env,
  type WebDeps,
} from './context';
import { ActionButton, ChannelSelect, Checkbox, Layout } from './layout';

export function pollPages({ guildId, services, timezone }: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const open = await services.polls.open(guildId);

      return c.html(
        <Layout title="Polls" path="/polls" flash={flashOf(c)}>
          <form method="post" action="/polls">
            <label>
              Question
              <input name="question" required maxlength={256} />
            </label>
            <label>
              Options (one per line, up to 10)
              <textarea name="options" rows={5} required />
            </label>
            <ChannelSelect guild={c.var.guild} />
            <Checkbox name="multiple" label="Allow several choices" />
            <Checkbox name="anonymous" label="Anonymous" />
            <div class="grid">
              <label>
                Results
                <select name="results">
                  <option value="live">Live</option>
                  <option value="closed">After closing</option>
                </select>
              </label>
              <label>
                Closes
                <input name="closes" placeholder="e.g. 2h, 1d, fri 18:00" />
              </label>
            </div>
            <button type="submit">Start poll</button>
          </form>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Question</th>
                <th>Closes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.question}</td>
                  <td>{date(p.closesAt)}</td>
                  <td>
                    <ActionButton
                      action={`/polls/${p.id}/close`}
                      label="Close"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const closes = field(form, 'closes');
      const options = field(form, 'options') ?? '';
      const poll = await services.polls.create(c.var.actor, {
        question: field(form, 'question') ?? '',
        options: options.split('\n').filter((line) => line.trim() !== ''),
        channelId: field(form, 'channelId') ?? '',
        multiple: checked(form, 'multiple'),
        anonymous: checked(form, 'anonymous'),
        showResults: form.get('results') === 'closed' ? 'closed' : 'live',
        ...(closes !== undefined && { closes }),
      });

      return back(c, '/polls', { notice: `Poll #${poll.id} started.` });
    })
    .post('/:id{[0-9]+}/close', async (c) => {
      const id = Number(c.req.param('id'));

      await services.polls.close(c.var.actor, id);

      return back(c, '/polls', { notice: `Poll #${id} closed.` });
    });
}
