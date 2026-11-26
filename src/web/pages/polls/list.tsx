import type { Poll } from '~/features/polls/model';
import { ActionButton } from '~/web/components/actions';

interface Props {
  open: Poll[];
  date: (value: Date | null) => string;
  canManage: (ownerId: string) => boolean;
}
export function PollList({ open, date, canManage }: Readonly<Props>) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Question</th>
          <th>Closes</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {open.map((p) => (
          <tr key={p.id}>
            <td>{p.id}</td>
            <td>
              <a href={`/polls/${p.id}`}>{p.question}</a>
            </td>
            <td>{date(p.closesAt)}</td>
            <td>
              {canManage(p.creatorId) ? (
                <>
                  <ActionButton action={`/polls/${p.id}/close`} label="Close" />
                  <ActionButton
                    action={`/polls/${p.id}/cancel`}
                    label="Cancel"
                  />
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
