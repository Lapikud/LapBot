import type { Permission } from '~/core/permission';
import type { Poll, PollResults } from '~/features/polls/model';
import { describeOutcome } from '~/features/polls/message';
import { Layout } from '~/web/layout';

interface Props {
  poll: Poll;
  results: PollResults;
  voters: ReadonlyMap<number, string[]> | undefined;
  can: ReadonlySet<Permission>;
}

export function PollResultsPage({
  poll,
  results,
  voters,
  can,
}: Readonly<Props>) {
  const leader = poll.status === 'open' ? 'Leading' : 'Winner';

  return (
    <Layout can={can} title={poll.question} path="/polls">
      <table>
        <tbody>
          {results.options.map((option) => (
            <tr key={option.id}>
              <td>{option.label}</td>
              <td>
                <progress value={option.votes} max={results.voters || 1} />
              </td>
              <td>{option.votes}</td>
              {voters === undefined ? null : (
                <td>{(voters.get(option.id) ?? []).join(', ')}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {results.winners.length === 0
          ? 'No votes yet.'
          : describeOutcome(results, leader)}
      </p>
    </Layout>
  );
}
