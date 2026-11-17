import {
  applicationAdmin,
  managePermissions,
  type Permission,
} from '~/core/permission';

interface PageLink {
  href: string;
  label: string;
  permission?: Permission;
}

export interface Section extends PageLink {
  pages?: readonly PageLink[];
}

export const sections: readonly Section[] = [
  { href: '/', label: 'Overview' },
  {
    href: '/post',
    label: 'Post',
    pages: [
      {
        href: '/post/announcements',
        label: 'Announcements',
        permission: 'announcement:create',
      },
      { href: '/post/events', label: 'Events' },
      {
        href: '/post/event-suggestions',
        label: 'Event suggestions',
        permission: 'event:suggestions:manage',
      },
      { href: '/post/polls', label: 'Polls' },
    ],
  },
  {
    href: '/forms',
    label: 'Forms',
    pages: [
      { href: '/forms/birthdays', label: 'Birthdays' },
      { href: '/forms/movies', label: 'Movies' },
    ],
  },
  { href: '/roles', label: 'Roles', permission: applicationAdmin },
  {
    href: '/settings',
    label: 'Settings',
    permission: managePermissions,
    pages: [
      {
        href: '/settings/permissions',
        label: 'Permissions',
        permission: managePermissions,
      },
      { href: '/settings/logs', label: 'Logs', permission: applicationAdmin },
    ],
  },
];

export function visibleLinks<T extends PageLink>(
  links: readonly T[],
  can: ReadonlySet<Permission> | undefined,
): readonly T[] {
  return can === undefined
    ? []
    : links.filter(
        ({ permission }) => permission === undefined || can.has(permission),
      );
}

export function containsPath(href: string, path: string): boolean {
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}
