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
  { href: '/', label: 'Help' },
  {
    href: '/announcements',
    label: 'Announcements',
    permission: 'announcement:post',
  },
  {
    href: '/events',
    label: 'Events',
    pages: [
      { href: '/events', label: 'Events' },
      { href: '/events/movies', label: 'Movies' },
      {
        href: '/events/suggestions',
        label: 'Suggestions',
        permission: 'event:suggestions:manage',
      },
    ],
  },
  { href: '/polls', label: 'Polls' },
  { href: '/birthdays', label: 'Birthdays' },
  { href: '/reminders', label: 'Reminders' },
  {
    href: '/settings',
    label: 'Settings',
    pages: [
      { href: '/settings/roles', label: 'Roles', permission: applicationAdmin },
      {
        href: '/settings/permissions',
        label: 'Permissions',
        permission: managePermissions,
      },
      { href: '/settings/logs', label: 'Logs', permission: applicationAdmin },
    ],
  },
];

export function visibleLinks<T extends Section>(
  links: readonly T[],
  can: ReadonlySet<Permission> | undefined,
): readonly T[] {
  return can === undefined
    ? []
    : links.filter(
        ({ permission, pages }) =>
          (permission === undefined || can.has(permission)) &&
          (pages === undefined || visibleLinks(pages, can).length > 0),
      );
}

export function containsPath(href: string, path: string): boolean {
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}
