import { Hono } from 'hono';
import { fieldKinds, type FormResponse } from '~/features/forms/model';
import {
  back,
  checked,
  field,
  flashOf,
  formatter,
  mentionsFrom,
  type Env,
  type Form as Submitted,
  type WebDeps,
  withFlash,
} from '~/web/context';
import { FormEditPage } from './edit';
import { FormListPage } from './index';
import { ResponsesPage } from './responses';

export function questionsOf(form: Submitted) {
  const rows = Array.from(
    { length: Number(field(form, 'rows') ?? 0) },
    (_, i) => {
      const kind =
        fieldKinds.find((k) => k === field(form, `kind-${i}`)) ?? 'short';

      return {
        label: field(form, `label-${i}`) ?? '',
        kind,
        required: checked(form, `required-${i}`),
        options:
          kind === 'grant'
            ? form.getAll(`grants-${i}`).map(String)
            : (field(form, `options-${i}`) ?? '').split('\n'),
        placeholder: field(form, `placeholder-${i}`) ?? null,
      };
    },
  );
  const [direction, at] = (field(form, 'move') ?? '').split(':');
  const from = Number(at);
  const to = direction === 'up' ? from - 1 : from + 1;
  const [a, b] = [rows[from], rows[to]];

  if (a !== undefined && b !== undefined) {
    [rows[from], rows[to]] = [b, a];
  }

  return rows.filter(
    (question, i) =>
      String(i) !== field(form, 'remove') && question.label !== '',
  );
}

function anchorOf(form: Submitted) {
  const [direction, at] = (field(form, 'move') ?? '').split(':');
  const rows = Number(field(form, 'rows') ?? 0);

  if (direction !== undefined && at !== undefined) {
    return `#question-${Number(at) + (direction === 'up' ? -1 : 1)}`;
  }

  if (field(form, 'remove') !== undefined) {
    return '#questions';
  }

  return (field(form, `label-${rows - 1}`) ?? '') === '' ? '' : '#add';
}

const labelsOf = (responses: readonly FormResponse[]) => [
  ...new Set(responses.flatMap(({ answers }) => answers.map((a) => a.label))),
];

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function formRoutes({
  services,
  directory,
  guildId,
  timezone,
}: WebDeps) {
  const { forms } = services;
  const date = formatter(timezone);
  const namesOf = (responses: readonly FormResponse[]) =>
    Promise.all(
      responses.map(
        async ({ userId }) =>
          (await directory.displayName(guildId, userId)) ?? userId,
      ),
    );

  return new Hono<Env>()
    .get('/', async (c) =>
      c.html(
        <FormListPage
          list={await forms.list(c.var.actor)}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      ),
    )
    .post('/', async (c) => {
      const form = await forms.create(
        c.var.actor,
        field(await c.req.formData(), 'title') ?? '',
      );

      return back(c, `/forms/${form.id}`, { notice: 'Form created.' });
    })
    .get(String.raw`/:id{\d+}`, async (c) => {
      const id = Number(c.req.param('id'));
      const { form, responses } = await forms.responses(c.var.actor, id);

      return c.html(
        <FormEditPage
          form={form}
          responses={responses.length}
          server={await c.var.server()}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .post(String.raw`/:id{\d+}`, async (c) => {
      const id = Number(c.req.param('id'));
      const form = await c.req.formData();

      await forms.update(c.var.actor, id, {
        title: field(form, 'title') ?? '',
        description: field(form, 'description') ?? null,
        confirmation: field(form, 'confirmation') ?? null,
        fields: questionsOf(form),
        responseChannelId: field(form, 'responseChannelId') ?? null,
        mentions: mentionsFrom(form),
      });

      const saved = withFlash(`/forms/${id}`, { notice: 'Form saved.' });

      return c.redirect(saved + anchorOf(form), 303);
    })
    .post(String.raw`/:id{\d+}/post`, async (c) => {
      const id = Number(c.req.param('id'));

      await forms.post(
        c.var.actor,
        id,
        field(await c.req.formData(), 'channelId') ?? '',
      );

      return back(c, `/forms/${id}`, { notice: 'Form posted.' });
    })
    .post(String.raw`/:id{\d+}/status`, async (c) => {
      const id = Number(c.req.param('id'));
      const status =
        field(await c.req.formData(), 'status') === 'closed'
          ? 'closed'
          : 'open';

      await forms.setStatus(c.var.actor, id, status);

      return back(c, `/forms/${id}`, {
        notice: status === 'closed' ? 'Form closed.' : 'Form reopened.',
      });
    })
    .post(String.raw`/:id{\d+}/delete`, async (c) => {
      await forms.remove(c.var.actor, Number(c.req.param('id')));

      return back(c, '/forms', { notice: 'Form deleted.' });
    })
    .get(String.raw`/:id{\d+}/responses`, async (c) => {
      const { form, responses } = await forms.responses(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return c.html(
        <ResponsesPage
          form={form}
          responses={responses}
          labels={labelsOf(responses)}
          names={await namesOf(responses)}
          date={date}
          can={c.var.can}
        />,
      );
    })
    .get(String.raw`/:id{\d+}/responses.csv`, async (c) => {
      const { form, responses } = await forms.responses(
        c.var.actor,
        Number(c.req.param('id')),
      );
      const labels = labelsOf(responses);
      const names = await namesOf(responses);
      const rows = [
        ['Submitted', 'Member', ...labels],
        ...responses.map((response, index) => [
          response.createdAt.toISOString(),
          names[index] ?? response.userId,
          ...labels.map(
            (label) =>
              response.answers.find((a) => a.label === label)?.value ?? '',
          ),
        ]),
      ];

      return c.body(
        rows
          .map((row) => row.map((cell) => csvCell(cell)).join(','))
          .join('\n'),
        200,
        {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="form-${form.id}.csv"`,
        },
      );
    });
}
