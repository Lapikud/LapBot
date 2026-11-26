import type { Birthday } from '~/features/birthdays/model';
import {
  birthdayVisibilities,
  birthdayVisibilityLabels,
} from '~/features/birthdays/rules';
import { Input, Select } from '~/web/components/controls';

export function MyBirthday({ mine }: Readonly<{ mine: Birthday | undefined }>) {
  return (
    <>
      <h2>Your birthday</h2>
      <form method="post" action="/birthdays/mine">
        <div class="grid">
          <Input
            label="Day"
            name="day"
            type="number"
            min={1}
            max={31}
            required
            value={mine?.day}
          />
          <Input
            label="Month"
            name="month"
            type="number"
            min={1}
            max={12}
            required
            value={mine?.month}
          />
        </div>
        <Select label="Who sees it" name="visibility">
          {birthdayVisibilities.map((visibility) => (
            <option
              key={visibility}
              value={visibility}
              selected={mine?.visibility === visibility}
            >
              {birthdayVisibilityLabels[visibility]}
            </option>
          ))}
        </Select>
        <div class="grid">
          <button type="submit" name="action" value="save">
            Save
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
        </div>
      </form>
    </>
  );
}
