import { selfAssignProblem } from '~/core/helpers/roles';
import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import { fieldKinds, type Form, type FormField } from '~/features/forms/model';
import { ActionButton, FormActions } from '~/web/components/actions';
import { Checkbox } from '~/web/components/choices';
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
  grant: 'Give roles',
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
  last,
  roles,
}: Readonly<{
  field: FormField;
  index: number;
  last: boolean;
  roles: RoleInfo[];
}>) {
  const added = field.label === '';

  return (
    <fieldset class="question" id={added ? 'add' : `question-${index}`}>
      <legend>{added ? 'Add a question' : `Question ${index + 1}`}</legend>
      <div class="fields">
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
      <div class="choices">
        <Textarea
          label="Choices"
          name={`options-${index}`}
          rows={3}
          help="One per line."
        >
          {field.options.join('\n')}
        </Textarea>
      </div>
      <div class="grants">
        <label htmlFor={`grants-${index}`}>Roles members can pick</label>
        <select id={`grants-${index}`} name={`grants-${index}`} multiple>
          {roles.map((role) => (
            <option
              key={role.id}
              value={role.id}
              selected={
                field.kind === 'grant' && field.options.includes(role.id)
              }
            >
              {role.name}
            </option>
          ))}
        </select>
        <small>
          Members get the roles they pick and lose the ones they leave out. Only
          administrators can save these.
        </small>
      </div>
      <div class="placeholder">
        <Input
          label="Placeholder"
          name={`placeholder-${index}`}
          maxlength={100}
          value={field.placeholder ?? ''}
        />
      </div>
      <Checkbox
        name={`required-${index}`}
        label="Required"
        checked={field.required}
      />
      {added ? (
        <div class="actions">
          <button type="submit" class="secondary">
            Add question
          </button>
        </div>
      ) : (
        <div class="actions">
          {index === 0 ? null : (
            <button
              type="submit"
              name="move"
              value={`up:${index}`}
              class="secondary outline"
              formNoValidate
            >
              Move up
            </button>
          )}
          {last ? null : (
            <button
              type="submit"
              name="move"
              value={`down:${index}`}
              class="secondary outline"
              formNoValidate
            >
              Move down
            </button>
          )}
          <button
            type="submit"
            name="remove"
            value={index}
            class="secondary outline"
            aria-label={`Remove ${field.label}`}
            formNoValidate
          >
            Remove
          </button>
        </div>
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
  const roles = server.roles.filter(
    (role) =>
      selfAssignProblem(role) === undefined ||
      form.fields.some(
        (f) => f.kind === 'grant' && f.options.includes(role.id),
      ),
  );

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
        <button type="submit" hidden />
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
          <Textarea
            label="Message after submitting"
            name="confirmation"
            rows={2}
            maxlength={2000}
            help="Leave empty for: Thanks, your response is saved."
          >
            {form.confirmation}
          </Textarea>
        </fieldset>
        <h2 id="questions">Questions</h2>
        <p class="hint">Discord shows five questions per page.</p>
        <input type="hidden" name="rows" value={rows.length} />
        {rows.map((field, index) => (
          <Question
            key={field.label === '' ? 'new' : field.label}
            field={field}
            index={index}
            last={index === form.fields.length - 1}
            roles={roles}
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
      <ActionButton
        action={`/forms/${form.id}/delete`}
        label="Delete"
        subject={form.title}
        confirm="Delete this form and its Discord message? Responses are kept, and roles members already got stay."
      />
    </Layout>
  );
}
