import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import { visibleRecords } from '~/core/helpers/visibility';
import {
  allows,
  back,
  checked,
  field,
  flashOf,
  mentionsFrom,
  formatter,
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewPollPage } from './create';
import { PollPage } from './index';
import { PollResultsPage } from './results';

export function pollRoutes({
  guildId,
  services,
  timezone,
  directory,
}: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const open = await visibleRecords(
        directory,
        c.var.actor,
        await services.polls.open(guildId),
      );

      return c.html(
        <PollPage
          open={open}
          date={date}
          can={c.var.can}
          flash={flashOf(c)}
          canManage={(ownerId) => owns(c, ownerId, 'poll:manage')}
        />,
      );
    })
    .get('/new', async (c) => {
      if (!allows(c, 'poll:create')) {
        throw new UserError('You need the "poll:create" permission.');
      }

      return c.html(
        <NewPollPage
          server={await c.var.server(true)}
          can={c.var.can}
          flash={flashOf(c)}
        />,
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
        mentions: mentionsFrom(form),
      });

      return back(c, '/polls', { notice: `Poll #${poll.id} started.` });
    })
    .get(String.raw`/:id{\d+}`, async (c) => {
      const { poll, results, voters } = await services.polls.summary(
        c.var.actor,
        Number(c.req.param('id')),
      );
      const named =
        voters &&
        new Map(
          await Promise.all(
            [...voters].map(
              async ([option, ids]) =>
                [
                  option,
                  await Promise.all(
                    ids.map(
                      async (id) =>
                        (await directory.displayName(guildId, id)) ??
                        'a former member',
                    ),
                  ),
                ] as const,
            ),
          ),
        );

      return c.html(
        <PollResultsPage
          poll={poll}
          results={results}
          voters={named}
          can={c.var.can}
        />,
      );
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.polls.cancel(c.var.actor, id);

      return back(c, '/polls', { notice: `Poll #${id} cancelled.` });
    })
    .post('/:id{\\d+}/close', async (c) => {
      const id = Number(c.req.param('id'));

      await services.polls.close(c.var.actor, id);

      return back(c, '/polls', { notice: `Poll #${id} closed.` });
    });
}
