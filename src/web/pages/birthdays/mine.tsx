import type { Birthday } from '~/features/birthdays/model';
import {
  birthdayVisibilities,
  birthdayVisibilityLabels,
} from '~/features/birthdays/rules';
import { FormActions } from '~/web/components/actions';
import { Input, Select } from '~/web/components/controls';

const monthName = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  timeZone: 'UTC',
});
const months = Array.from({ length: 12 }, (_, index) =>
  monthName.format(new Date(Date.UTC(2024, index, 1))),
);

export function MyBirthday({ mine }: Readonly<{ mine: Birthday | undefined }>) {
  const visibility = mine?.visibility ?? 'public';

  return (
    <>
      <h2>Your birthday</h2>
      <form method="post" action="/birthdays/mine">
        <div class="fields">
          <Input
            label="Day"
            name="day"
            type="number"
            min={1}
            max={31}
            required
            value={mine?.day}
          />
          <Select label="Month" name="month" required>
            {months.map((name, index) => (
              <option
                key={name}
                value={index + 1}
                selected={mine?.month === index + 1}
              >
                {name}
              </option>
            ))}
          </Select>
        </div>
        <fieldset>
          <legend>Who sees it</legend>
          {birthdayVisibilities.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="visibility"
                value={value}
                checked={visibility === value}
              />
              {birthdayVisibilityLabels[value]}
            </label>
          ))}
        </fieldset>
        <FormActions>
          <button type="submit" name="action" value="save">
            Save birthday
          </button>
          {mine === undefined ? null : (
            <button
              type="submit"
              name="action"
              value="remove"
              class="secondary outline"
              formnovalidate
            >
              Remove
            </button>
          )}
        </FormActions>
      </form>
    </>
  );
}
