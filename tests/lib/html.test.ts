import { describe, expect, it } from 'vitest';
import { html, raw } from '~/lib';

describe('html', () => {
  it('escapes interpolated values but not nested html', () => {
    const name = '<script>"x"</script>';

    expect(html`<p>${name}</p>`.value).toBe(
      '<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>',
    );
    const inner = html`<b>${'a&b'}</b>`;

    expect(html`<div>${inner}</div>`.value).toBe('<div><b>a&amp;b</b></div>');
    expect(html`${[raw('<i>'), 'x', null, false]}`.value).toBe('<i>x');
  });
});
