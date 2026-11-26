import { field, mentionsFrom, type Form } from '~/web/context';

export function draftOf(form: Form) {
  const content = form.get('content');

  return {
    when: field(form, 'when') ?? '',
    channelId: field(form, 'channelId') ?? '',
    title: field(form, 'title') ?? '',
    content: typeof content === 'string' ? content : '',
    mentions: mentionsFrom(form),
  };
}

export type Draft = ReturnType<typeof draftOf>;
