import {
  Input,
  Select,
  Textarea,
} from '~/presentation/web/components/controls';
import { ActionButton } from '~/presentation/web/components/actions';
import { Checkbox } from '~/presentation/web/components/choices';
import { visibleRecords } from '~/core/helpers/visibility';
import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import {
  allows,
  back,
  checked,
  field,
  flashOf,
  formatter,
  owns,
  type Env,
  type WebDeps,
} from '~/presentation/web/context';
import { Layout } from '~/presentation/web/layout';
import { ChannelSelect } from '~/presentation/web/components/selectors';

export function pollPages({ guildId, services, timezone, directory }: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const open = await visibleRecords(
        directory,
        c.var.actor,
        await services.polls.open(guildId),
      );

      return c.html(
        <Layout
          can={c.var.can}
          title="Polls"
          path="/post/polls"
          flash={flashOf(c)}
          actions={
            allows(c, 'poll:create') ? (
              <a href="/post/polls/new">New poll</a>
            ) : null
          }
        >
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
                    {owns(c, p.creatorId, 'poll:manage') ? (
                      <>
                        <ActionButton
                          action={`/post/polls/${p.id}/close`}
                          label="Close"
                        />
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Layout>,
      );
    })
    .get('/new', (c) => {
      if (!allows(c, 'poll:create')) {
        throw new UserError('You need the "poll:create" permission.');
      }

      return c.html(
        <Layout
          can={c.var.can}
          title="New poll"
          path="/post/polls"
          flash={flashOf(c)}
        >
          <form method="post" action="/post/polls">
            <Input label="Question" name="question" required maxlength={256} />
            <Textarea
              label="Options (one per line, up to 10)"
              name="options"
              rows={5}
              required
            />
            <ChannelSelect server={c.var.server} />
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

      return back(c, '/post/polls', { notice: `Poll #${poll.id} started.` });
    })
    .post('/:id{\\d+}/close', async (c) => {
      const id = Number(c.req.param('id'));

      await services.polls.close(c.var.actor, id);

      return back(c, '/post/polls', { notice: `Poll #${id} closed.` });
    });
}
