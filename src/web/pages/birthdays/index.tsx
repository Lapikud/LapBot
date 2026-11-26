import type { Permission } from '~/core/permission';
import type { Birthday, BirthdaySettings } from '~/features/birthdays/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { BirthdaySettingsForm } from './form';
import { BirthdaySignup } from './signup';
import { UpcomingBirthdays } from './upcoming';

interface Props {
  settings: BirthdaySettings | undefined;
  upcoming: Birthday[];
  names: string[];
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function BirthdayPage({
  settings,
  upcoming,
  names,
  server,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout can={can} title="Birthdays" path="/birthdays" flash={flash}>
      <p>
        {settings === undefined
          ? 'Birthday announcements are off.'
          : `Announced in ${server.channelName(settings.channelId)} at ${settings.hour}:00.`}{' '}
        Members add their own birthday with /birthday set.
      </p>
      {can.has('birthday:manage') ? (
        <>
          <BirthdaySettingsForm settings={settings} server={server} />
          <BirthdaySignup server={server} />
        </>
      ) : null}
      <UpcomingBirthdays upcoming={upcoming} names={names} />
    </Layout>
  );
}
