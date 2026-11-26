import type { Permission } from '~/core/permission';
import type { Form } from '~/features/forms/model';
import { Input } from '~/web/components/controls';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';

interface Props {
  list: Array<Form & { responses: number }>;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function FormListPage({ list, can, flash }: Readonly<Props>) {
  return (
    <Layout can={can} title="Forms" path="/forms" flash={flash}>
      <p>
        Build a form here, post it in a channel, and members fill it in on
        Discord.
      </p>
      {list.length === 0 ? (
        <p>No forms yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Form</th>
              <th>Status</th>
              <th>Responses</th>
            </tr>
          </thead>
          <tbody>
            {list.map((form) => (
              <tr key={form.id}>
                <td>
                  <a href={`/forms/${form.id}`}>{form.title}</a>
                </td>
                <td>{form.status}</td>
                <td>
                  <a href={`/forms/${form.id}/responses`}>{form.responses}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>New form</h2>
      <form method="post" action="/forms">
        <Input label="Title" name="title" maxlength={100} required />
        <button type="submit">Create</button>
      </form>
    </Layout>
  );
}
