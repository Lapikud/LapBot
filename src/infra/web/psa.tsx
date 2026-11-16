import { Hono } from 'hono';
import type { Child } from 'hono/jsx';
import type { Announcement } from '~/core/ports';
import {
  back,
  checked,
  field,
  flashOf,
  formatter,
  type Env,
  type Form,
  type Server,
  type WebDeps,
} from './context';
import { ActionButton, ChannelSelect, Checkbox, Layout } from './layout';
import { MessagePreview } from './preview';

const title = 'Public service announcements';

function draftOf(form: Form) {
  const content = form.get('content');

  return {
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

  return (
    <fieldset>
      <legend>Mention</legend>
      <Checkbox
        name="everyone"
        label="@everyone"
        checked={draft?.mentionEveryone ?? false}
      />
      {roles.map(({ id, name }) => (
        <Checkbox
          key={id}
          name="role"
          value={id}
          label={`@${name}`}
          checked={draft?.mentionRoleIds.includes(id) ?? false}
        />
      ))}
    </fieldset>
  );
}

const actions = [
  ['preview', 'Preview', 'secondary outline'],
  ['draft', 'Save draft', 'secondary'],
  ['schedule', 'Schedule', 'secondary'],
  ['publish', 'Publish now', undefined],
] as const;

function Composer({
  server,
  draft,
  preview,
}: Readonly<{ server: Server; draft?: Draft; preview?: Child }>) {
  return (
    <form method="post" action="/psa">
      <ChannelSelect server={server} />
      <label>
        Title
        <input name="title" maxlength={256} value={draft?.title} />
      </label>
      <label>
        Message
        <textarea name="content" rows={8} maxlength={1900} required>
          {draft?.content}
        </textarea>
      </label>
      <MentionPicker server={server} draft={draft} />
      <label>
        Publish later
        <input name="when" placeholder="e.g. 2h, tomorrow 9:00, fri 18:00" />
      </label>
      {preview}
      <div role="group">
        {actions.map(([value, label, variant]) => (
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
      </div>
    </form>
  );
}

function Recent({
  list,
  server,
  date,
}: Readonly<{
  list: Announcement[];
  server: Server;
  date: (value: Date | null) => string;
}>) {
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
                  <ActionButton
                    action={`/psa/${a.id}/publish`}
                    label="Publish"
                  />
                  <ActionButton action={`/psa/${a.id}/cancel`} label="Cancel" />
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
    .get('/', async (c) => {
      const list = await services.announcements.list(guildId);

      return c.html(
        <Layout title={title} path="/psa" flash={flashOf(c)}>
          <Composer server={c.var.server} />
          <h2>Recent</h2>
          <Recent list={list} server={c.var.server} date={date} />
        </Layout>,
      );
    })
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
          <Layout title={title} path="/psa">
            <Composer
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

        return back(c, '/psa', { notice: `PSA #${created.id} published.` });
      }

      if (action === 'schedule') {
        const scheduled = await services.announcements.schedule(
          actor,
          created.id,
          field(form, 'when') ?? '',
        );

        return back(c, '/psa', {
          notice: `PSA #${created.id} scheduled for ${date(scheduled.scheduledAt)}.`,
        });
      }

      return back(c, '/psa', { notice: `Draft #${created.id} saved.` });
    })
    .post('/:id{[0-9]+}/:action{publish|cancel}', async (c) => {
      const id = Number(c.req.param('id'));
      const publish = c.req.param('action') === 'publish';

      await (publish
        ? services.announcements.publish(c.var.actor, id)
        : services.announcements.cancel(c.var.actor, id));

      return back(c, '/psa', {
        notice: `PSA #${id} ${publish ? 'published' : 'cancelled'}.`,
      });
    });
}
