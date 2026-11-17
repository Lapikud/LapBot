import type { Event } from '~/features/events/model';
import { Input, Textarea } from '~/web/components/controls';

export function EventFields({
  event,
  time,
}: Readonly<{ event?: Event; time: (date: Date | null) => string }>) {
  return (
    <>
      <Input
        label="Title"
        name="title"
        required
        maxlength={200}
        value={event?.title}
      />
      <div class="grid">
        <Input
          label="Start"
          name="start"
          required
          placeholder="e.g. fri 18:00"
          value={time(event?.startsAt ?? null)}
        />
        <Input
          label="End"
          name="end"
          placeholder="e.g. 21:00 or 3h"
          value={time(event?.endsAt ?? null)}
        />
      </div>
      <Textarea
        label="Description"
        name="description"
        rows={3}
        maxlength={1500}
      >
        {event?.description}
      </Textarea>
      <div class="grid">
        <Input
          label="Location"
          name="location"
          maxlength={200}
          value={event?.location ?? ''}
        />
        <Input
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          value={event?.capacity ?? ''}
        />
      </div>
    </>
  );
}
