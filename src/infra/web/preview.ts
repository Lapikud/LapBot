import type { Message } from '~/domain';
import { html, type Html } from '~/lib';

export type Names = {
  roles: ReadonlyMap<string, string>;
  channels: ReadonlyMap<string, string>;
};

const lineBreak = html`<br />`;

const token = /(<@&\d+>|<@\d+>|<#\d+>|@everyone|\*\*[^*]+\*\*)/;

function inline(text: string, names: Names): Html {
  return html`${text.split(token).map((part) => {
    const role = /^<@&(\d+)>$/.exec(part)?.[1];
    const user = /^<@(\d+)>$/.exec(part)?.[1];
    const channel = /^<#(\d+)>$/.exec(part)?.[1];

    if (role !== undefined) {
      return html`<span class="mention"
        >@${names.roles.get(role) ?? 'unknown role'}</span
      >`;
    }

    if (user !== undefined) {
      return html`<span class="mention">@user</span>`;
    }

    if (channel !== undefined) {
      return html`<span class="mention"
        >#${names.channels.get(channel) ?? 'channel'}</span
      >`;
    }

    if (part === '@everyone') {
      return html`<span class="mention">@everyone</span>`;
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return html`<strong>${part.slice(2, -2)}</strong>`;
    }

    return html`${part}`;
  })}`;
}

const lines = (text: string, names: Names) =>
  text
    .split('\n')
    .map(
      (line, index) =>
        html`${index > 0 ? lineBreak : ''}${inline(line, names)}`,
    );

export function messagePreview(message: Message, names: Names): Html {
  return html`<div class="discord">
    ${message.content === undefined || message.content === '' ? '' : html`<p>${lines(message.content, names)}</p>`}
    ${(message.embeds ?? []).map(
      (embed) =>
        html`<div
          class="embed"
          style="border-color: #${(embed.color ?? 0x5865f2).toString(16).padStart(6, '0')}"
        >
          ${embed.title === undefined ? '' : html`<strong>${embed.title}</strong>`}
          ${embed.description === undefined ? '' : html`<p>${lines(embed.description, names)}</p>`}
          ${(embed.fields ?? []).map((field) => html`<p><strong>${field.name}</strong><br />${lines(field.value, names)}</p>`)}
          ${embed.footer === undefined ? '' : html`<small>${embed.footer}</small>`}
        </div>`,
    )}
  </div>`;
}
