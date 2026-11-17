import type { LogStore } from '~/integrations/logging/store';
import { tz } from '@date-fns/tz';
import { format } from 'date-fns';
import type { Context } from 'hono';
import type { Authorizer } from '~/core/authorization';
import type { ChannelInfo, Directory } from '~/core/directory';
import type { Logger } from '~/core/logger';
import type { AnnouncementService } from '~/features/announcements/service';
import type { BirthdayService } from '~/features/birthdays/service';
import type { MovieService } from '~/features/movies/service';
import type { EventService } from '~/features/events/service';
import type { PermissionService } from '~/features/permissions/service';
import type { PollService } from '~/features/polls/service';
import type { RoleService } from '~/features/roles/service';
import type { Actor } from '~/core/actor';
import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/roles';
import type { SignIn } from './auth';

export type WebServices = {
  roles: RoleService;
  announcements: AnnouncementService;
  events: EventService;
  polls: PollService;
  permissions: PermissionService;
  birthdays: BirthdayService;
  movies: MovieService;
};

export type WebDeps = {
  guildId: string;
  timezone: string;
  signIn: SignIn;
  directory: Directory;
  authz: Authorizer;
  services: WebServices;
  log: Logger;
  logs: LogStore;
};

export type Server = {
  channels: ChannelInfo[];
  roles: RoleInfo[];
  roleName: (id: string) => string;
  channelName: (id: string) => string;
};

export function serverOf(channels: ChannelInfo[], roles: RoleInfo[]): Server {
  const roleNames = new Map<string, string>(
    roles.map((role) => [role.id, role.name]),
  );
  const channelNames = new Map<string, string>(
    channels.map((channel) => [channel.id, channel.name]),
  );

  return {
    channels,
    roles,
    roleName: (id: string): string => roleNames.get(id) ?? 'unknown role',
    channelName: (id: string): string => `#${channelNames.get(id) ?? id}`,
  };
}

export type Env = {
  Variables: { actor: Actor; server: Server; can: ReadonlySet<Permission> };
};

export const allows = (c: Context<Env>, permission: Permission) =>
  c.var.can.has(permission);

export const owns = (
  c: Context<Env>,
  ownerId: string,
  permission: Permission,
) => c.var.actor.userId === ownerId || allows(c, permission);

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

  const separator = path.includes('?') ? '&' : '?';

  return query === '' ? path : `${path}${separator}${query}`;
};

export const back = (c: Context<Env>, path: string, flash: Flash) =>
  c.redirect(withFlash(path, flash), 303);

export const inputTime = (timezone: string) => (date: Date | null) =>
  date === null ? '' : format(date, 'yyyy-MM-dd HH:mm', { in: tz(timezone) });

export const formatter = (timezone: string) => {
  const display = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });

  return (date: Date | null) => (date === null ? '' : display.format(date));
};
