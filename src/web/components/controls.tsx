import { createElement, type Child, type JSX } from 'hono/jsx';
import { Field } from './field';

interface Presentation {
  name: string;
  id?: string;
  label: Child;
  help?: string;
  error?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}
type ControlTag = 'input' | 'textarea' | 'select';

function describedBy(
  id: string,
  help: string | undefined,
  error: string | undefined,
  existing: unknown,
) {
  return (
    [
      existing,
      help === undefined ? undefined : `${id}-help`,
      error === undefined ? undefined : `${id}-error`,
    ]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .join(' ') || undefined
  );
}

function control<Tag extends ControlTag>(tag: Tag) {
  return function Control({
    label,
    help,
    error,
    id,
    ...props
  }: Readonly<Presentation & JSX.IntrinsicElements[Tag]>) {
    const controlId = id ?? props.name;

    return (
      <Field id={controlId} label={label} help={help} error={error}>
        {createElement(
          tag,
          {
            ...props,
            id: controlId,
            'aria-describedby': describedBy(
              controlId,
              help,
              error,
              props['aria-describedby'],
            ),
            'aria-invalid': error === undefined ? props['aria-invalid'] : true,
          },
          props.children,
        )}
      </Field>
    );
  };
}

export const Input = control('input');
export const Textarea = control('textarea');
export const Select = control('select');
