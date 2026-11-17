import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { Birthday, BirthdaySettings } from '~/features/birthdays/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { BirthdaySettingsForm } from './form';
import { BirthdaySignup } from './signup';
import { UpcomingBirthdays } from './upcoming';

interface Props {
  readonly settings: BirthdaySettings | undefined;
  readonly upcoming: Birthday[];
  readonly names: string[];
  readonly roles: RoleInfo[];
  readonly server: Server;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function BirthdayPage({
  settings,
  upcoming,
  names,
  roles,
  server,
  can,
  flash,
}: Props) {
  return (
    <Layout can={can} title="Birthdays" path="/forms/birthdays" flash={flash}>
      <p>
        {settings === undefined
          ? 'Birthday announcements are off.'
          : `Announced in ${server.channelName(settings.channelId)} at ${settings.hour}:00.`}{' '}
        Members add their own birthday with /birthday set.
      </p>
      {can.has('birthday:manage') ? (
        <>
          <BirthdaySettingsForm
            settings={settings}
            server={server}
            roles={roles}
          />
          <BirthdaySignup server={server} />
        </>
      ) : null}
      <UpcomingBirthdays upcoming={upcoming} names={names} />
    </Layout>
  );
}
