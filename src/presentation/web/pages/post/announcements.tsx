import {
  FormActions,
  ActionButton,
} from '~/presentation/web/components/actions';
import { Input, Textarea } from '~/presentation/web/components/controls';
import { MultiSelect } from '~/presentation/web/components/choices';
import { Hono } from 'hono';
import type { Child } from 'hono/jsx';
import type { Announcement } from '~/features/announcements/model';
import { UserError } from '~/core/errors';
import type { Permission } from '~/core/permission';
import {
  allows,
  back,
  checked,
  field,
  flashOf,
  formatter,
  type Env,
  type Form,
  type Server,
  type WebDeps,
} from '~/presentation/web/context';
import { Layout } from '~/presentation/web/layout';
import { ChannelSelect } from '~/presentation/web/components/selectors';
import { MessagePreview } from '~/presentation/web/components/preview';

const title = 'Announcements';

function draftOf(form: Form) {
  const content = form.get('content');

  return {
    when: field(form, 'when') ?? '',
    channelId: field(form, 'channelId') ?? '',
    title: field(form, 'title') ?? '',
    content: typeof content === 'string' ? content : '',
    mentionRoleIds: form.getAll('role').map(String),
    mentionEveryone: checked(form, 'everyone'),
  };
}

type Draft = ReturnType<typeof draftOf>;

function MentionPicker({
  server,
  draft,
}: Readonly<{ server: Server; draft: Draft | undefined }>) {
  const roles = server.roles.filter((role) => !role.everyone && !role.managed);
  const selected = new Set([
    ...(draft?.mentionEveryone === true ? ['1'] : []),
    ...(draft?.mentionRoleIds ?? []),
  ]);

  return (
    <MultiSelect
      label="Mention"
      placeholder="Nobody"
      selected={selected}
      choices={[
        { name: 'everyone', value: '1', label: '@everyone' },
        ...roles.map(({ id, name }) => ({
          name: 'role',
          value: id,
          label: `@${name}`,
        })),
      ]}
    />
  );
}

const actions: ReadonlyArray<
  readonly [
    value: string,
    label: string,
    variant: string | undefined,
    needs?: Permission,
  ]
> = [
  ['preview', 'Preview', 'secondary outline'],
  ['draft', 'Save draft', 'secondary'],
  ['schedule', 'Schedule', 'secondary', 'announcement:schedule'],
  ['publish', 'Publish now', undefined, 'announcement:publish'],
];

function Composer({
  server,
  can,
  draft,
  preview,
}: Readonly<{
  server: Server;
  can: ReadonlySet<Permission>;
  draft?: Draft;
  preview?: Child;
}>) {
  return (
    <form method="post" action="/post/announcements">
      <ChannelSelect server={server} selected={draft?.channelId} />
      <Input label="Title" name="title" maxlength={256} value={draft?.title} />
      <Textarea
        label="Message"
        name="content"
        rows={8}
        maxlength={1900}
        required
      >
        {draft?.content}
      </Textarea>
      <MentionPicker server={server} draft={draft} />
      <Input
        label="Publish later"
        name="when"
        value={draft?.when}
        placeholder="e.g. 2h, tomorrow 9:00, fri 18:00"
      />
      {preview}
      <FormActions>
        {actions
          .filter(([, , , needs]) => needs === undefined || can.has(needs))
          .map(([value, label, variant]) => (
            <button
              key={value}
              type="submit"
              name="action"
              value={value}
              class={variant}
            >
              {label}
            </button>
          ))}
      </FormActions>
    </form>
  );
}

function Recent({
  list,
  server,
  date,
  can,
  userId,
}: Readonly<{
  list: Announcement[];
  server: Server;
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  userId: string;
}>) {
  const publisher = can.has('announcement:publish');

  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Status</th>
          <th>Channel</th>
          <th>Title</th>
          <th>When</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.id}>
            <td>{a.id}</td>
            <td>
              {a.status}
              {a.failure === null ? null : (
                <>
                  <br />
                  <small>{a.failure}</small>
                </>
              )}
            </td>
            <td>{server.channelName(a.channelId)}</td>
            <td>{a.title ?? a.content.slice(0, 60)}</td>
            <td>{date(a.publishedAt ?? a.scheduledAt)}</td>
            <td>
              {a.status === 'draft' || a.status === 'scheduled' ? (
                <>
                  {publisher ? (
                    <ActionButton
                      action={`/post/announcements/${a.id}/publish`}
                      label="Publish"
                    />
                  ) : null}
                  {publisher || a.authorId === userId ? (
                    <ActionButton
                      action={`/post/announcements/${a.id}/cancel`}
                      label="Cancel"
                    />
                  ) : null}
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function psaPages({ guildId, services, timezone }: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .use(async (c, next) => {
      if (!allows(c, 'announcement:create')) {
        throw new UserError('You need the "announcement:create" permission.');
      }

      await next();
    })
    .get('/', async (c) => {
      const list = await services.announcements.list(c.var.actor);

      return c.html(
        <Layout
          can={c.var.can}
          title={title}
          path="/post/announcements"
          flash={flashOf(c)}
          actions={<a href="/post/announcements/new">New PSA</a>}
        >
          <Recent
            list={list}
            server={c.var.server}
            date={date}
            can={c.var.can}
            userId={c.var.actor.userId}
          />
        </Layout>,
      );
    })
    .get('/new', (c) =>
      c.html(
        <Layout
          can={c.var.can}
          title="New PSA"
          path="/post/announcements"
          flash={flashOf(c)}
        >
          <Composer server={c.var.server} can={c.var.can} />
        </Layout>,
      ),
    )
    .post('/', async (c) => {
      const form = await c.req.formData();
      const action = form.get('action');
      const draft = draftOf(form);
      const { actor, server } = c.var;

      if (action === 'preview') {
        const view = services.announcements.view({
          ...draft,
          title: draft.title === '' ? null : draft.title,
          id: 0,
          guildId,
          authorId: actor.userId,
          status: 'draft',
          scheduledAt: null,
          publishedAt: null,
          messageId: null,
          failure: null,
          createdAt: new Date(),
        });

        return c.html(
          <Layout can={c.var.can} title="New PSA" path="/post/announcements">
            <Composer
              can={c.var.can}
              server={server}
              draft={draft}
              preview={
                <>
                  <h2>Preview</h2>
                  <MessagePreview message={view} server={server} />
                </>
              }
            />
          </Layout>,
        );
      }

      const created = await services.announcements.draft(actor, draft);

      if (action === 'publish') {
        await services.announcements.publish(actor, created.id);

        return back(c, '/post/announcements', {
          notice: `PSA #${created.id} published.`,
        });
      }

      if (action === 'schedule') {
        const scheduled = await services.announcements.schedule(
          actor,
          created.id,
          field(form, 'when') ?? '',
        );

        return back(c, '/post/announcements', {
          notice: `PSA #${created.id} scheduled for ${date(scheduled.scheduledAt)}.`,
        });
      }

      return back(c, '/post/announcements', {
        notice: `Draft #${created.id} saved.`,
      });
    })
    .post(String.raw`/:id{\d+}/publish`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.announcements.publish(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} published.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.announcements.cancel(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} cancelled.`,
      });
    });
}
