import { html, raw, type Html } from '~/lib';

const style = `
body { font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1rem; color: #1f2328; }
nav { display: flex; gap: 1rem; padding-bottom: .75rem; border-bottom: 1px solid #d0d7de; margin-bottom: 1rem; }
nav a { color: #0969da; text-decoration: none; }
nav a[aria-current] { font-weight: 600; color: #1f2328; }
form { display: grid; gap: .6rem; max-width: 40rem; margin-bottom: 1.5rem; }
label { display: grid; gap: .2rem; font-weight: 500; }
fieldset { border: 1px solid #d0d7de; border-radius: 6px; }
fieldset label { display: inline-flex; gap: .35rem; font-weight: 400; margin-right: 1rem; }
input, select, textarea, button { font: inherit; padding: .35rem .5rem; border: 1px solid #d0d7de; border-radius: 6px; }
button { background: #f6f8fa; cursor: pointer; }
button.primary { background: #1f883d; color: #fff; border-color: #1f883d; }
table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
th, td { text-align: left; padding: .4rem; border-bottom: 1px solid #d0d7de; vertical-align: top; }
td form { display: inline; margin: 0; }
.notice { padding: .5rem .75rem; border-radius: 6px; background: #dafbe1; }
.error { padding: .5rem .75rem; border-radius: 6px; background: #ffebe9; }
.discord { background: #313338; color: #dbdee1; padding: .75rem 1rem; border-radius: 8px; max-width: 36rem; }
.embed { border-left: 4px solid; background: #2b2d31; padding: .5rem .75rem; border-radius: 4px; margin-top: .5rem; }
.mention { background: #3c4270; color: #c9cdfb; border-radius: 3px; padding: 0 .15rem; }
`;

const sections = [
  ['/', 'Overview'],
  ['/psa', 'PSAs'],
  ['/events', 'Events'],
  ['/polls', 'Polls'],
  ['/permissions', 'Permissions'],
  ['/settings', 'Settings'],
] as const;

export type Flash = { notice?: string; error?: string };

export function page(
  title: string,
  path: string,
  flash: Flash,
  body: Html,
): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · LAPbot</title>
        <style>
          ${raw(style)}
        </style>
      </head>
      <body>
        <nav aria-label="Sections">
          ${sections.map(
            ([href, label]) =>
              html`<a
                href="${href}"
                ${path === href ? html` aria-current="page"` : ''}
                >${label}</a
              >`,
          )}
        </nav>
        <main>
          <h1>${title}</h1>
          ${flash.notice === undefined ? '' : html`<p class="notice" role="status">${flash.notice}</p>`}
          ${flash.error === undefined ? '' : html`<p class="error" role="alert">${flash.error}</p>`}
          ${body}
        </main>
      </body>
    </html>`;
}
