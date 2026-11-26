import type { Permission } from '~/core/permission';
import { fieldKinds, type Form, type FormField } from '~/features/forms/model';
import { FormActions } from '~/web/components/actions';
import { Input, Select, Textarea } from '~/web/components/controls';
import { MentionPicker } from '~/web/components/mentions';
import { ChannelOptions, ChannelSelect } from '~/web/components/selectors';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';

const kindLabels: Record<FormField['kind'], string> = {
  short: 'Short text',
  paragraph: 'Long text',
  number: 'Number',
  choice: 'Choice',
  user: 'Member',
  role: 'Role',
};

const blank: FormField = {
  label: '',
  kind: 'short',
  required: false,
  options: [],
  placeholder: null,
};

function Question({
  field,
  index,
}: Readonly<{ field: FormField; index: number }>) {
  return (
    <fieldset class="question">
      <legend>
        {field.label === '' ? 'New question' : `Question ${index + 1}`}
      </legend>
      <div class="fields">
        <Input
          label="Order"
          name={`order-${index}`}
          type="number"
          min={1}
          value={index + 1}
        />
        <Input
          label="Question"
          name={`label-${index}`}
          maxlength={45}
          value={field.label}
        />
        <Select label="Answer" name={`kind-${index}`}>
          {fieldKinds.map((kind) => (
            <option key={kind} value={kind} selected={field.kind === kind}>
              {kindLabels[kind]}
            </option>
          ))}
        </Select>
      </div>
      <div class="fields">
        <Textarea
          label="Choices"
          name={`options-${index}`}
          rows={2}
          help="Only for Choice, one per line."
        >
          {field.options.join('\n')}
        </Textarea>
        <Input
          label="Placeholder"
          name={`placeholder-${index}`}
          maxlength={100}
          value={field.placeholder ?? ''}
        />
      </div>
      <label>
        <input
          type="checkbox"
          name={`required-${index}`}
          value="1"
          checked={field.required}
        />
        Required
      </label>
      {field.label === '' ? null : (
        <label>
          <input type="checkbox" name={`remove-${index}`} value="1" />
          Remove this question
        </label>
      )}
    </fieldset>
  );
}

interface Props {
  form: Form;
  responses: number;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function FormEditPage({
  form,
  responses,
  server,
  can,
  flash,
}: Readonly<Props>) {
  const rows = [...form.fields, blank];

  return (
    <Layout
      can={can}
      title={form.title}
      path="/forms"
      flash={flash}
      actions={
        <a href={`/forms/${form.id}/responses`}>Responses ({responses})</a>
      }
    >
      <p>
        {form.status === 'open' ? 'Open' : 'Closed'}
        {form.channelId === null
          ? ', not posted yet.'
          : `, posted in ${server.channelName(form.channelId)}.`}
      </p>
      <form method="post" action={`/forms/${form.id}`}>
        <fieldset>
          <legend>Details</legend>
          <Input
            label="Title"
            name="title"
            maxlength={100}
            required
            value={form.title}
          />
          <Textarea label="Description" name="description" rows={2}>
            {form.description}
          </Textarea>
        </fieldset>
        <h2>Questions</h2>
        <p class="hint">
          Discord shows five questions per page. Fill in the empty question to
          add one.
        </p>
        <input type="hidden" name="rows" value={rows.length} />
        {rows.map((field, index) => (
          <Question
            key={field.label === '' ? 'new' : field.label}
            field={field}
            index={index}
          />
        ))}
        <fieldset>
          <legend>Responses</legend>
          <Select label="Post responses in" name="responseChannelId">
            <option value="">Don't post them</option>
            <ChannelOptions
              server={server}
              {...(form.responseChannelId !== null && {
                selected: form.responseChannelId,
              })}
            />
          </Select>
          <MentionPicker server={server} mentions={form.mentions} />
        </fieldset>
        <button type="submit">Save form</button>
      </form>
      <h2>Share</h2>
      <form method="post" action={`/forms/${form.id}/post`}>
        <ChannelSelect server={server} />
        <FormActions>
          <button type="submit">
            {form.channelId === null ? 'Post form' : 'Post again'}
          </button>
        </FormActions>
      </form>
      <form method="post" action={`/forms/${form.id}/status`}>
        <input
          type="hidden"
          name="status"
          value={form.status === 'open' ? 'closed' : 'open'}
        />
        <button type="submit" class="secondary outline">
          {form.status === 'open' ? 'Close form' : 'Reopen form'}
        </button>
      </form>
    </Layout>
  );
}
