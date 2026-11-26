import type { Permission } from '~/core/permission';
import type { Form, FormResponse } from '~/features/forms/model';
import { Layout } from '~/web/layout';

interface Props {
  form: Form;
  responses: FormResponse[];
  labels: string[];
  names: string[];
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
}

export function ResponsesPage({
  form,
  responses,
  labels,
  names,
  date,
  can,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title={`${form.title}: responses`}
      path="/forms"
      actions={<a href={`/forms/${form.id}/responses.csv`}>Download CSV</a>}
    >
      {responses.length === 0 ? (
        <p>No responses yet.</p>
      ) : (
        <div class="overflow-auto">
          <div class="table-wrapper" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Member</th>
                  {labels.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((response, index) => (
                  <tr key={response.id}>
                    <td>{date(response.createdAt)}</td>
                    <td>{names[index]}</td>
                    {labels.map((label) => (
                      <td key={label}>
                        {response.answers.find((a) => a.label === label)?.value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
