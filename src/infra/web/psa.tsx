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
  type Guild,
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

function MentionPicker(
  props: Readonly<{ guild: Guild; draft: Draft | undefined }>,
) {
  const roles = props.guild.roles.filter(
    (role) => !role.everyone && !role.managed,
  );

  return (
    <fieldset>
      <legend>Mention</legend>
      <Checkbox
        name="everyone"
        label="@everyone"
        checked={props.draft?.mentionEveryone ?? false}
      />
      {roles.map((role) => (
        <Checkbox
          name="role"
          value={role.id}
          label={`@${role.name}`}
          checked={props.draft?.mentionRoleIds.includes(role.id) ?? false}
        />
      ))}
    </fieldset>
  );
}

function Composer(
  props: Readonly<{ guild: Guild; draft?: Draft; preview?: Child }>,
) {
  return (
    <form method="post" action="/psa">
      <ChannelSelect guild={props.guild} />
      <label>
        Title
        <input name="title" maxlength={256} value={props.draft?.title} />
      </label>
      <label>
        Message
        <textarea name="content" rows={8} maxlength={1900} required>
          {props.draft?.content}
        </textarea>
      </label>
      <MentionPicker guild={props.guild} draft={props.draft} />
      <label>
        Publish later
        <input name="when" placeholder="e.g. 2h, tomorrow 9:00, fri 18:00" />
      </label>
      {props.preview}
      <div role="group">
        <button name="action" value="preview">
          Preview
        </button>
        <button name="action" value="draft">
          Save draft
        </button>
        <button name="action" value="schedule">
          Schedule
        </button>
        <button name="action" value="publish">
          Publish now
        </button>
      </div>
    </form>
  );
}

function Recent(
  props: Readonly<{
    list: Announcement[];
    guild: Guild;
    date: (value: Date | null) => string;
  }>,
) {
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
        {props.list.map((a) => (
          <tr>
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
            <td>{props.guild.channelName(a.channelId)}</td>
            <td>{a.title ?? a.content.slice(0, 60)}</td>
            <td>{props.date(a.publishedAt ?? a.scheduledAt)}</td>
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
          <Composer guild={c.var.guild} />
          <h2>Recent</h2>
          <Recent list={list} guild={c.var.guild} date={date} />
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const action = form.get('action');
      const draft = draftOf(form);
      const { actor, guild } = c.var;

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
              guild={guild}
              draft={draft}
              preview={
                <>
                  <h2>Preview</h2>
                  <MessagePreview message={view} guild={guild} />
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
