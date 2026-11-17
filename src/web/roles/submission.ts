import { UserError } from '~/core/errors';
import { field } from '~/web/context';

export function panelChoices(form: FormData, remove: string | undefined) {
  const choices = [];

  for (let index = 0; index < 20; index++) {
    const roleId = field(form, `role-${index}`);
    const emoji = field(form, `emoji-${index}`);

    if (roleId !== undefined && roleId !== remove) {
      if (emoji === undefined) {
        throw new UserError('Choose a reaction for each role.');
      }

      choices.push({ roleId, emoji });
    }
  }

  return choices;
}
