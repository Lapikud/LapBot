import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  Authenticator,
  ChannelInfo,
  Directory,
  Logger,
} from '~/core/ports';
import type {
  AnnouncementService,
  EventService,
  PermissionService,
  PollService,
} from '~/core/services';
import { UserError, type Actor, type RoleInfo } from '~/domain';
import { html, raw, type Html } from '~/lib';
import { page, type Flash } from './layout';
import { messagePreview, type Names } from './preview';

export type WebServices = {
  announcements: AnnouncementService;
  events: EventService;
  polls: PollService;
  permissions: PermissionService;
};

type Deps = {
  guildId: string;
  auth: Authenticator;
  directory: Directory;
  services: WebServices;
  log: Logger;
};

type Form = URLSearchParams;

type Context = {
  actor: Actor;
  form: Form;
  path: string;
  flash: Flash;
  csrf: Html;
  guild: { channels: ChannelInfo[]; roles: RoleInfo[]; names: Names };
};

type Result = { status?: number; body: Html } | { redirect: string };

type Route = {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handle: (context: Context, params: string[]) => Promise<Result>;
};

const maxBodyBytes = 64 * 1024;

const date = (value: Date | null) =>
  value === null ? '' : value.toISOString().slice(0, 16).replace('T', ' ');

const field = (form: Form, name: string) => {
  const value = form.get(name)?.trim() ?? '';

  return value === '' ? undefined : value;
};

const location = (path: string, flash: Flash) => {
  const query = new URLSearchParams(Object.entries(flash)).toString();

  return query === '' ? path : `${path}?${query}`;
};

const redirect = (path: string, flash: Flash): Result => ({
  redirect: location(path, flash),
});

function channelSelect(context: Context, name = 'channelId') {
  return html`<label
    >Channel
    <select name="${name}" required>
      ${context.guild.channels.map(
        (channel) =>
          html`<option value="${channel.id}">#${channel.name}</option>`,
      )}
    </select></label
  >`;
}

function mentionPicker(context: Context, selected: readonly string[] = []) {
  const roles = context.guild.roles.filter(
    (role) => !role.everyone && !role.managed,
  );

  return html`<fieldset>
    <legend>Mention</legend>
    <label><input type="checkbox" name="everyone" value="1" /> @everyone</label>
    ${roles.map(
      (role) =>
        html`<label
          ><input
            type="checkbox"
            name="role"
            value="${role.id}"
            ${selected.includes(role.id) ? raw(' checked') : ''}
          />
          @${role.name}</label
        >`,
    )}
  </fieldset>`;
}

const psaActions = (context: Context, psa: { id: number; status: string }) => {
  if (!['draft', 'scheduled'].includes(psa.status)) {
    return html``;
  }

  const publish = button(
    context,
    ['', 'psa', psa.id, 'publish'].join('/'),
    'Publish',
  );
  const cancel = button(
    context,
    ['', 'psa', psa.id, 'cancel'].join('/'),
    'Cancel',
  );

  return html`${publish} ${cancel}`;
};

const button = (context: Context, action: string, label: string) =>
  html`<form method="post" action="${action}">
    ${context.csrf}<button>${label}</button>
  </form>`;

function psaDraft(context: Context) {
  return {
    channelId: field(context.form, 'channelId') ?? '',
    title: field(context.form, 'title') ?? '',
    content: context.form.get('content') ?? '',
    mentionRoleIds: context.form.getAll('role'),
    mentionEveryone: context.form.get('everyone') === '1',
  };
}

function psaForm(context: Context, preview?: Html) {
  const draft = psaDraft(context);

  return html`<form method="post" action="/psa">
      ${context.csrf} ${channelSelect(context)}
      <label
        >Title <input name="title" maxlength="256" value="${draft.title}"
      /></label>
      <label
        >Message
        <textarea name="content" rows="8" maxlength="1900" required>
${draft.content}</textarea>
      </label>
      ${mentionPicker(context, draft.mentionRoleIds)}
      <label
        >Publish later
        <input name="when" placeholder="e.g. 2h or 2026-11-20 18:00"
      /></label>
      <div>
        <button name="action" value="preview">Preview</button>
        <button name="action" value="draft">Save draft</button>
        <button name="action" value="schedule">Schedule</button>
        <button class="primary" name="action" value="publish">
          Publish now
        </button>
      </div>
    </form>
    ${preview ?? ''}`;
}

export function createWebApp(deps: Deps) {
  const { services, directory, log } = deps;
  const csrfToken = randomBytes(24).toString('hex');

  const guildData = async () => {
    const [channels, roles] = await Promise.all([
      directory.channels(deps.guildId),
      directory.roles(deps.guildId),
    ]);

    return {
      channels,
      roles,
      names: {
        roles: new Map(roles.map((role) => [role.id, role.name])),
        channels: new Map(
          channels.map((channel) => [channel.id, channel.name]),
        ),
      },
    };
  };

  const channelName = (context: Context, id: string) =>
    `#${context.guild.names.channels.get(id) ?? id}`;

  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/$/,
      handle: async (context) => {
        const [announcements, events, polls] = await Promise.all([
          services.announcements.list(deps.guildId),
          services.events.upcoming(deps.guildId),
          services.polls.open(deps.guildId),
        ]);
        const pending = announcements.filter(
          (a) => a.status === 'scheduled' || a.status === 'draft',
        );

        return {
          body: page(
            'Overview',
            context.path,
            context.flash,
            html`<ul>
              <li>
                <a href="/psa"
                  >${pending.length} PSA drafts and scheduled posts</a
                >
              </li>
              <li><a href="/events">${events.length} upcoming events</a></li>
              <li><a href="/polls">${polls.length} open polls</a></li>
            </ul>`,
          ),
        };
      },
    },
    {
      method: 'GET',
      pattern: /^\/psa$/,
      handle: async (context) => {
        const list = await services.announcements.list(deps.guildId);

        return {
          body: page(
            'Public service announcements',
            context.path,
            context.flash,
            html` ${psaForm(context)}
              <h2>Recent</h2>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Status</th>
                    <th>Channel</th>
                    <th>Title</th>
                    <th>When</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${list.map(
                    (a) =>
                      html`<tr>
                        <td>${a.id}</td>
                        <td>
                          ${a.status}
                          ${
                            a.failure === null
                              ? ''
                              : html`<br /><small>${a.failure}</small>`
                          }
                        </td>
                        <td>${channelName(context, a.channelId)}</td>
                        <td>${a.title ?? a.content.slice(0, 60)}</td>
                        <td>${date(a.publishedAt ?? a.scheduledAt)}</td>
                        <td>${psaActions(context, a)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
          ),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/psa$/,
      handle: async (context) => {
        const action = context.form.get('action');
        const draft = psaDraft(context);

        if (action === 'preview') {
          const view = services.announcements.view({
            ...draft,
            title: draft.title === '' ? null : draft.title,
            id: 0,
            guildId: deps.guildId,
            authorId: context.actor.userId,
            status: 'draft',
            scheduledAt: null,
            publishedAt: null,
            messageId: null,
            failure: null,
            createdAt: new Date(),
          });

          return {
            body: page(
              'Public service announcements',
              '/psa',
              context.flash,
              psaForm(
                context,
                html`<h2>Preview</h2>
                  ${messagePreview(view, context.guild.names)}`,
              ),
            ),
          };
        }

        const created = await services.announcements.draft(
          context.actor,
          draft,
        );

        if (action === 'publish') {
          await services.announcements.publish(context.actor, created.id);

          return redirect('/psa', { notice: `PSA #${created.id} published.` });
        }

        if (action === 'schedule') {
          const scheduled = await services.announcements.schedule(
            context.actor,
            created.id,
            field(context.form, 'when') ?? '',
          );

          return redirect('/psa', {
            notice: `PSA #${created.id} scheduled for ${date(scheduled.scheduledAt)} UTC.`,
          });
        }

        return redirect('/psa', { notice: `Draft #${created.id} saved.` });
      },
    },
    {
      method: 'POST',
      pattern: /^\/psa\/(\d+)\/(publish|cancel)$/,
      handle: async (context, [id = '', action]) => {
        await (action === 'publish'
          ? services.announcements.publish(context.actor, Number(id))
          : services.announcements.cancel(context.actor, Number(id)));

        return redirect('/psa', {
          notice: `PSA #${id} ${action === 'publish' ? 'published' : 'cancelled'}.`,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/events$/,
      handle: async (context) => {
        const upcoming = await services.events.upcoming(deps.guildId);

        return {
          body: page(
            'Events',
            context.path,
            context.flash,
            html` <form method="post" action="/events">
                ${context.csrf}
                <label
                  >Title <input name="title" required maxlength="200"
                /></label>
                <label
                  >Start
                  <input name="start" required placeholder="2026-11-20 18:00"
                /></label>
                <label>End <input name="end" placeholder="optional" /></label>
                <label
                  >Description
                  <textarea
                    name="description"
                    rows="3"
                    maxlength="2000"
                  ></textarea>
                </label>
                <label
                  >Location <input name="location" maxlength="200"
                /></label>
                ${channelSelect(context)}
                <label
                  >Capacity <input name="capacity" type="number" min="1"
                /></label>
                <label
                  >Reminders (minutes before)
                  <input name="reminders" value="60"
                /></label>
                <label
                  ><input type="checkbox" name="native" value="1" /> Also create
                  a Discord event</label
                >
                <div><button class="primary">Create event</button></div>
              </form>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Starts</th>
                    <th>Channel</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${upcoming.map(
                    (e) =>
                      html`<tr>
                        <td>${e.id}</td>
                        <td>${e.title}</td>
                        <td>${date(e.startsAt)} UTC</td>
                        <td>${channelName(context, e.channelId)}</td>
                        <td>
                          ${button(context, `/events/${e.id}/cancel`, 'Cancel')}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
          ),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/events$/,
      handle: async (context) => {
        const optional = [
          'end',
          'description',
          'location',
          'reminders',
        ] as const;
        const capacity = field(context.form, 'capacity');
        const event = await services.events.create(context.actor, {
          title: field(context.form, 'title') ?? '',
          start: field(context.form, 'start') ?? '',
          channelId: field(context.form, 'channelId') ?? '',
          native: context.form.get('native') === '1',
          ...(capacity !== undefined && { capacity: Number(capacity) }),
          ...Object.fromEntries(
            optional.flatMap((name) => {
              const value = field(context.form, name);

              return value === undefined ? [] : [[name, value]];
            }),
          ),
        });

        return redirect('/events', { notice: `Event #${event.id} created.` });
      },
    },
    {
      method: 'POST',
      pattern: /^\/events\/(\d+)\/cancel$/,
      handle: async (context, [id = '']) => {
        await services.events.cancel(context.actor, Number(id));

        return redirect('/events', { notice: `Event #${id} cancelled.` });
      },
    },
    {
      method: 'GET',
      pattern: /^\/polls$/,
      handle: async (context) => {
        const open = await services.polls.open(deps.guildId);

        return {
          body: page(
            'Polls',
            context.path,
            context.flash,
            html` <form method="post" action="/polls">
                ${context.csrf}
                <label
                  >Question <input name="question" required maxlength="256"
                /></label>
                <label
                  >Options (one per line)
                  <textarea name="options" rows="5" required></textarea>
                </label>
                ${channelSelect(context)}
                <label
                  ><input type="checkbox" name="multiple" value="1" /> Allow
                  several choices</label
                >
                <label
                  ><input type="checkbox" name="anonymous" value="1" />
                  Anonymous</label
                >
                <label
                  >Results
                  <select name="results">
                    <option value="live">Live</option>
                    <option value="closed">After closing</option>
                  </select></label
                >
                <label
                  >Closes <input name="closes" placeholder="e.g. 1d"
                /></label>
                <div><button class="primary">Start poll</button></div>
              </form>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Question</th>
                    <th>Closes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${open.map(
                    (p) =>
                      html`<tr>
                        <td>${p.id}</td>
                        <td>${p.question}</td>
                        <td>${date(p.closesAt)}</td>
                        <td>
                          ${button(context, `/polls/${p.id}/close`, 'Close')}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
          ),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/polls$/,
      handle: async (context) => {
        const closes = field(context.form, 'closes');
        const poll = await services.polls.create(context.actor, {
          question: field(context.form, 'question') ?? '',
          options: (context.form.get('options') ?? '')
            .split('\n')
            .filter((line) => line.trim() !== ''),
          channelId: field(context.form, 'channelId') ?? '',
          multiple: context.form.get('multiple') === '1',
          anonymous: context.form.get('anonymous') === '1',
          showResults:
            context.form.get('results') === 'closed' ? 'closed' : 'live',
          ...(closes !== undefined && { closes }),
        });

        return redirect('/polls', { notice: `Poll #${poll.id} started.` });
      },
    },
    {
      method: 'POST',
      pattern: /^\/polls\/(\d+)\/close$/,
      handle: async (context, [id = '']) => {
        await services.polls.close(context.actor, Number(id));

        return redirect('/polls', { notice: `Poll #${id} closed.` });
      },
    },
    {
      method: 'GET',
      pattern: /^\/permissions$/,
      handle: async (context) => {
        const grants = await services.permissions.list(context.actor);
        const roleName = (id: string) =>
          context.guild.names.roles.get(id) ?? id;

        return {
          body: page(
            'Permissions',
            context.path,
            context.flash,
            html` <p>Discord administrators hold every permission.</p>
              <form method="post" action="/permissions">
                ${context.csrf}
                <label
                  >Role
                  <select name="roleId">
                    ${context.guild.roles.filter((r) => !r.managed).map((r) => html`<option value="${r.id}">@${r.name}</option>`)}
                  </select></label
                >
                <label
                  >Permission
                  <select name="permission">
                    ${services.permissions.catalogue().map((p) => html`<option value="${p.id}">${p.id} — ${p.description}</option>`)}
                  </select></label
                >
                <div>
                  <button class="primary" name="action" value="grant">
                    Grant
                  </button>
                </div>
              </form>
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Permission</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${grants.map(
                    (g) =>
                      html`<tr>
                        <td>@${roleName(g.roleId)}</td>
                        <td>${g.permission}</td>
                        <td>
                          <form method="post" action="/permissions">
                            ${context.csrf}<input
                              type="hidden"
                              name="roleId"
                              value="${g.roleId}"
                            /><input
                              type="hidden"
                              name="permission"
                              value="${g.permission}"
                            /><button name="action" value="revoke">
                              Revoke
                            </button>
                          </form>
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
          ),
        };
      },
    },
    {
      method: 'POST',
      pattern: /^\/permissions$/,
      handle: async (context) => {
        const action =
          context.form.get('action') === 'revoke' ? 'revoke' : 'grant';
        const permission = field(context.form, 'permission') ?? '';
        const changed = await services.permissions[action](
          context.actor,
          field(context.form, 'roleId') ?? '',
          permission,
        );

        const verb = action === 'grant' ? 'Granted' : 'Revoked';

        return redirect('/permissions', {
          notice: changed ? `${verb} ${permission}.` : 'Nothing changed.',
        });
      },
    },
  ];

  const readForm = (request: IncomingMessage): Promise<Form> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      request.on('data', (chunk: Buffer) => {
        size += chunk.length;

        if (size > maxBodyBytes) {
          reject(new UserError('That form is too large.'));
          request.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      request.on('end', () => {
        resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      });
      request.on('error', reject);
    });

  const send = (
    response: ServerResponse,
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...headers,
    });
    response.end(body);
  };

  const sameOrigin = (request: IncomingMessage) => {
    const origin = request.headers.origin;

    return (
      origin === undefined || new URL(origin).host === request.headers.host
    );
  };

  const findRoute = (method: string, path: string) =>
    routes
      .map((route) => ({
        route,
        params: route.method === method ? route.pattern.exec(path) : null,
      }))
      .find((candidate) => candidate.params !== null);

  const plain = (
    response: ServerResponse,
    status: number,
    title: string,
    body: Html,
  ) => {
    send(response, status, page(title, '', {}, body).value);
  };

  const actorFor = (request: IncomingMessage) =>
    deps.auth.authenticate({
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join(', ') : value,
        ]),
      ),
    });

  const serve = async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> => {
    const method = request.method === 'POST' ? 'POST' : 'GET';
    const match = findRoute(method, url.pathname);

    if (!match?.params) {
      plain(
        response,
        404,
        'Not found',
        html`<p><a href="/">Back to the overview</a></p>`,
      );

      return;
    }

    const actor = await actorFor(request);

    if (!actor) {
      plain(
        response,
        401,
        'Sign in required',
        html`<p>Sign-in is not set up.</p>`,
      );

      return;
    }

    const form =
      method === 'POST' ? await readForm(request) : new URLSearchParams();

    if (
      method === 'POST' &&
      (!sameOrigin(request) || form.get('csrf') !== csrfToken)
    ) {
      plain(
        response,
        403,
        'Forbidden',
        html`<p>This form expired. Reload the page and try again.</p>`,
      );

      return;
    }

    const flash: Flash = Object.fromEntries(
      ['notice', 'error'].flatMap((key) => {
        const value = url.searchParams.get(key);

        return value === null ? [] : [[key, value]];
      }),
    );
    const result = await match.route.handle(
      {
        actor,
        form,
        path: url.pathname,
        flash,
        csrf: html`<input type="hidden" name="csrf" value="${csrfToken}" />`,
        guild: await guildData(),
      },
      match.params.slice(1),
    );

    if ('redirect' in result) {
      send(response, 303, '', { Location: result.redirect });
    } else {
      send(response, result.status ?? 200, result.body.value);
    }
  };

  return {
    handle: async (
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<void> => {
      const url = new URL(request.url ?? '/', 'http://localhost');

      try {
        await serve(request, response, url);
      } catch (error) {
        if (error instanceof UserError) {
          const section = url.pathname.split('/').slice(0, 2).join('/') || '/';

          send(response, 303, '', {
            Location: location(section, { error: error.message }),
          });

          return;
        }

        const ref = randomUUID().slice(0, 8);

        log.error(
          { err: error, ref, path: url.pathname },
          'Web request failed',
        );
        plain(
          response,
          500,
          'Something went wrong',
          html`<p>Reference: ${ref}</p>`,
        );
      }
    },
  };
}

export type WebApp = ReturnType<typeof createWebApp>;
