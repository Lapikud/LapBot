import type { Mentions } from '~/core/message';

export const fieldKinds = [
  'short',
  'paragraph',
  'number',
  'choice',
  'user',
  'role',
  'grant',
] as const;

export type FieldKind = (typeof fieldKinds)[number];

export type FormStatus = 'open' | 'closed' | 'deleted';

export interface FormField {
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  placeholder: string | null;
}

export interface Form {
  id: number;
  title: string;
  description: string | null;
  fields: FormField[];
  channelId: string | null;
  messageId: string | null;
  responseChannelId: string | null;
  mentions: Mentions;
  createdBy: string;
  status: FormStatus;
  createdAt: Date;
}

export interface Answer {
  label: string;
  value: string;
}

export interface FormResponse {
  id: number;
  formId: number;
  userId: string;
  answers: Answer[];
  createdAt: Date;
}

export type FormChanges = Partial<
  Pick<
    Form,
    | 'title'
    | 'description'
    | 'fields'
    | 'channelId'
    | 'messageId'
    | 'responseChannelId'
    | 'mentions'
    | 'status'
  >
>;

export interface FormRepository {
  insert: (form: { title: string; createdBy: string }) => Promise<Form>;
  find: (id: number) => Promise<Form | undefined>;
  list: () => Promise<Array<Form & { responses: number }>>;
  update: (id: number, changes: FormChanges) => Promise<Form>;
  respond: (
    response: Pick<FormResponse, 'formId' | 'userId' | 'answers'>,
  ) => Promise<FormResponse>;
  responses: (formId: number) => Promise<FormResponse[]>;
}
