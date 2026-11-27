import type { Permission } from '~/core/permission';
import type { Birthday, BirthdaySettings } from '~/features/birthdays/model';
import { MyBirthday } from './mine';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { BirthdaySettingsForm } from './form';
import { BirthdaySignup } from './signup';
import { UpcomingBirthdays } from './upcoming';

interface Props {
  settings: BirthdaySettings | undefined;
  upcoming: Birthday[];
  names: string[];
  mine: Birthday | undefined;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function BirthdayPage({
  settings,
  upcoming,
  names,
  mine,
  server,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout can={can} title="Birthdays" path="/birthdays" flash={flash}>
      <MyBirthday mine={mine} />
      <UpcomingBirthdays upcoming={upcoming} names={names} />
      <h2>Announcements</h2>
      <p>
        {settings === undefined
          ? 'Birthday announcements are off.'
          : `Announced in ${server.channelName(settings.channelId)} at ${String(settings.hour).padStart(2, '0')}:00.`}
      </p>
      {can.has('birthday:manage') ? (
        <>
          <BirthdaySettingsForm settings={settings} server={server} />
          <BirthdaySignup server={server} />
        </>
      ) : null}
    </Layout>
  );
}
