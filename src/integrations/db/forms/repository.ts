import { asc, count, desc, eq, ne } from 'drizzle-orm';
import type { FormRepository } from '~/features/forms/model';
import type { Db } from '../client';
import { formResponses, forms } from './table';

export function createFormRepository(db: Db): FormRepository {
  return {
    insert: async (input) => {
      const [row] = await db.insert(forms).values(input).returning();

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row;
    },
    find: async (id) => {
      const [row] = await db.select().from(forms).where(eq(forms.id, id));

      return row;
    },
    list: async () => {
      const rows = await db
        .select({ form: forms, responses: count(formResponses.id) })
        .from(forms)
        .leftJoin(formResponses, eq(formResponses.formId, forms.id))
        .where(ne(forms.status, 'deleted'))
        .groupBy(forms.id)
        .orderBy(desc(forms.id));

      return rows.map(({ form, responses }) => ({ ...form, responses }));
    },
    update: async (id, changes) => {
      const [row] = await db
        .update(forms)
        .set(changes)
        .where(eq(forms.id, id))
        .returning();

      if (!row) {
        throw new Error(`Form ${id} vanished`);
      }

      return row;
    },
    respond: async (input) => {
      const [row] = await db.insert(formResponses).values(input).returning();

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row;
    },
    responses: (formId) =>
      db
        .select()
        .from(formResponses)
        .where(eq(formResponses.formId, formId))
        .orderBy(asc(formResponses.id)),
  };
}
