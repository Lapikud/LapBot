import { z } from 'zod';
import { birthdayVisibilities, validateBirthday } from './rules';
import { UserError } from '~/core/errors';

export const birthdayForm = z.object({
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  visibility: z.enum(birthdayVisibilities),
});

export function parseBirthdaySubmission(input: {
  day: number;
  month: number;
  visibility?: string;
}): z.infer<typeof birthdayForm> {
  const visibility =
    birthdayVisibilities.find((value) => value === input.visibility) ??
    'public';
  const result = birthdayForm.safeParse({ ...input, visibility });

  if (!result.success) {
    throw new UserError('That is not a valid date.');
  }

  validateBirthday(result.data.month, result.data.day);

  return result.data;
}
