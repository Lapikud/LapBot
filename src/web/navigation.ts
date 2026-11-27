import {
  announcementParts,
  applicationAdmin,
  formBuilders,
  holdsAny,
  managePermissions,
  type Permission,
} from '~/core/permission';

interface PageLink {
  href: string;
  label: string;
  permission?: Permission | readonly Permission[];
}

export interface Section extends PageLink {
  pages?: readonly PageLink[];
}

export const sections: readonly Section[] = [
  { href: '/', label: 'Help' },
  {
    href: '/announcements',
    label: 'Community',
    pages: [
      {
        href: '/announcements',
        label: 'Announcements',
        permission: announcementParts,
      },
      { href: '/events', label: 'Events' },
      { href: '/events/movies', label: 'Movies' },
      { href: '/polls', label: 'Polls' },
      {
        href: '/events/suggestions',
        label: 'Suggestions',
        permission: 'event:suggestions:manage',
      },
    ],
  },
  { href: '/forms', label: 'Forms', permission: formBuilders },
  {
    href: '/birthdays',
    label: 'Personal',
    pages: [
      { href: '/birthdays', label: 'Birthdays' },
      { href: '/reminders', label: 'Reminders' },
    ],
  },
  {
    href: '/settings',
    label: 'Settings',
    pages: [
      {
        href: '/settings/roles',
        label: 'Role panels',
        permission: applicationAdmin,
      },
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
          (permission === undefined || holdsAny(can, permission)) &&
          (pages === undefined || visibleLinks(pages, can).length > 0),
      );
}

export function containsPath(href: string, path: string): boolean {
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}

export function containsPage(section: Section, path: string): boolean {
  return (
    containsPath(section.href, path) ||
    (section.pages?.some(({ href }) => containsPath(href, path)) ?? false)
  );
}
