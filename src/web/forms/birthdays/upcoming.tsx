import type { Birthday } from '~/features/birthdays/model';

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

interface Props {
  readonly upcoming: Birthday[];
  readonly names: string[];
}
export function UpcomingBirthdays({ upcoming, names }: Props) {
  return (
    <>
      <h2>Coming up</h2>
      {upcoming.length === 0 ? (
        <p>No public birthdays saved yet.</p>
      ) : (
        <table>
          <tbody>
            {upcoming.map((birthday, index) => (
              <tr key={birthday.userId}>
                <td>{names[index]}</td>
                <td>
                  {dayMonth.format(
                    new Date(Date.UTC(2024, birthday.month - 1, birthday.day)),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
