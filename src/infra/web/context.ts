import type { Context } from 'hono';
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
import type { Actor, RoleInfo } from '~/domain';

export type WebServices = {
  announcements: AnnouncementService;
  events: EventService;
  polls: PollService;
  permissions: PermissionService;
};

export type WebDeps = {
  guildId: string;
  timezone: string;
  auth: Authenticator;
  directory: Directory;
  services: WebServices;
  log: Logger;
};

export type Guild = {
  channels: ChannelInfo[];
  roles: RoleInfo[];
  roleName: (id: string) => string;
  channelName: (id: string) => string;
};

export type Env = { Variables: { actor: Actor; guild: Guild } };

export type Flash = { notice?: string; error?: string };

export type Form = FormData;

export const field = (form: Form, name: string) => {
  const value = form.get(name);
  const text = typeof value === 'string' ? value.trim() : '';

  return text === '' ? undefined : text;
};

export const checked = (form: Form, name: string) => form.get(name) === '1';

export const flashOf = (c: Context<Env>): Flash => {
  const notice = c.req.query('notice');
  const error = c.req.query('error');

  return {
    ...(notice !== undefined && { notice }),
    ...(error !== undefined && { error }),
  };
};

export const withFlash = (path: string, flash: Flash) => {
  const query = new URLSearchParams(Object.entries(flash)).toString();

  return query === '' ? path : `${path}?${query}`;
};

export const back = (c: Context<Env>, path: string, flash: Flash) =>
  c.redirect(withFlash(path, flash), 303);

export const formatter = (timezone: string) => {
  const format = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });

  return (date: Date | null) => (date === null ? '' : format.format(date));
};
