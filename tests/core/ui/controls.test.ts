import { describe, expect, it } from 'vitest';
import { jsx } from 'hono/jsx/jsx-runtime';
import { Input, Select, Textarea } from '~/core/ui/controls';
import { Checkbox } from '~/core/ui/choices';

describe('accessible web controls', async () => {
  it('associates labels help and errors while preserving native attributes', async () => {
    const html = await jsx(Input, {
      name: 'day',
      id: 'birthday-day',
      label: 'Day',
      help: '1-31',
      error: 'Invalid date',
      required: true,
      type: 'number',
      min: 1,
      max: 31,
      maxlength: 2,
      value: '30',
      'aria-describedby': 'extra',
    }).toString();

    expect(html).toContain('for="birthday-day"');
    expect(html).toContain('id="birthday-day"');
    expect(html).toContain(
      'aria-describedby="extra birthday-day-help birthday-day-error"',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="birthday-day-help"');
    expect(html).toContain('id="birthday-day-error"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="31"');
    expect(html).toContain('maxlength="2"');
    expect(html).toContain('required');
    expect(html).toContain('name="day"');
    expect(html).toContain('value="30"');
  });

  it('escapes values and keeps repeated names independently addressable', async () => {
    const first = await jsx(Input, {
      name: 'role',
      id: 'role-one',
      label: 'Role',
      help: 'First',
      value: '<script>',
    }).toString();
    const second = await jsx(Input, {
      name: 'role',
      id: 'role-two',
      label: 'Role',
      error: 'Second',
    }).toString();

    expect(first).toContain('&lt;script&gt;');
    expect(first).toContain('for="role-one"');
    expect(first).not.toContain('role-two');
    expect(second).toContain('for="role-two"');
    expect(second).not.toContain('role-one');
    expect(
      await jsx(Textarea, {
        name: 'body',
        label: 'Body',
        children: '<script>',
        rows: 3,
      }).toString(),
    ).toContain('&lt;script&gt;');
  });

  it('preserves choice ordering selections and checkbox values', async () => {
    const html = await jsx(Select, {
      name: 'choice',
      label: 'Choice',
      children: [
        jsx('option', { value: 'b', selected: true, children: 'B' }),
        jsx('option', { value: 'a', children: 'A' }),
      ],
    }).toString();

    expect(html.indexOf('value="b"')).toBeLessThan(html.indexOf('value="a"'));
    expect(html).toContain('selected');
    const checkbox = await jsx(Checkbox, {
      name: 'permission',
      label: 'Permission',
      value: 'event:create',
      checked: true,
    }).toString();

    expect(checkbox).toContain('value="event:create"');
    expect(checkbox).toContain('checked');
  });
});
