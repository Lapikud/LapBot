import type { EventSuggestionService } from '~/features/event-suggestions/service';
import type { LogStore } from '~/integrations/logging/store';
import { tz } from '@date-fns/tz';
import { format } from 'date-fns';
import type { Context } from 'hono';
import type { Authorizer } from '~/core/ports/authorization';
import type {
  ChannelInfo,
  Directory,
  MemberInfo,
  RoleInfo,
} from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { AnnouncementService } from '~/features/announcements/service';
import type { BirthdayService } from '~/features/birthdays/service';
import type { MovieService } from '~/features/movies/service';
import type { EventService } from '~/features/events/service';
import type { PermissionService } from '~/features/permissions/service';
import type { PollService } from '~/features/polls/service';
import type { ReminderService } from '~/features/reminders/service';
import type { RoleService } from '~/features/roles/service';
import type { Actor } from '~/core/actor';
import type { Mentions } from '~/core/message';
import type { Permission } from '~/core/permission';
import type { SignIn } from './auth';

export interface WebServices {
  eventSuggestions: EventSuggestionService;
  roles: RoleService;
  announcements: AnnouncementService;
  events: EventService;
  polls: PollService;
  permissions: PermissionService;
  birthdays: BirthdayService;
  movies: MovieService;
  reminders: ReminderService;
}

export interface WebDeps {
  guildId: string;
  timezone: string;
  signIn: SignIn;
  directory: Directory;
  authz: Authorizer;
  services: WebServices;
  log: Logger;
  logs: LogStore;
}

export interface Server {
  channels: ChannelInfo[];
  roles: RoleInfo[];
  members: MemberInfo[];
  roleName: (id: string) => string;
  channelName: (id: string) => string;
}

export function serverOf(
  channels: ChannelInfo[],
  roles: RoleInfo[],
  members: MemberInfo[],
): Server {
  const roleNames = new Map<string, string>(
    roles.map((role) => [role.id, role.name]),
  );
  const channelNames = new Map<string, string>(
    channels.map((channel) => [channel.id, channel.name]),
  );

  return {
    channels,
    roles,
    members,
    roleName: (id: string): string => roleNames.get(id) ?? 'unknown role',
    channelName: (id: string): string => `#${channelNames.get(id) ?? id}`,
  };
}

export interface Env {
  Variables: {
    actor: Actor;
    server: () => Promise<Server>;
    can: ReadonlySet<Permission>;
  };
}

export const allows = (c: Context<Env>, permission: Permission) =>
  c.var.can.has(permission);

export const owns = (
  c: Context<Env>,
  ownerId: string,
  permission: Permission,
) => c.var.actor.userId === ownerId || allows(c, permission);

export interface Flash {
  notice?: string;
  error?: string;
}

export type Form = FormData;

export const field = (form: Form, name: string) => {
  const value = form.get(name);
  const text = typeof value === 'string' ? value.trim() : '';

  return text === '' ? undefined : text;
};

export const checked = (form: Form, name: string) => form.get(name) === '1';

export function mentionsFrom(form: Form): Mentions {
  const picked = form.getAll('mention').map(String);
  const ids = (kind: string) =>
    picked
      .filter((value) => value.startsWith(`${kind}:`))
      .map((value) => value.slice(kind.length + 1));

  return {
    users: ids('user'),
    roles: ids('role'),
    here: picked.includes('here'),
    everyone: picked.includes('everyone'),
  };
}

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
