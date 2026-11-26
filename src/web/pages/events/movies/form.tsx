import { Input, Textarea } from '~/web/components/controls';

export function MovieForm() {
  return (
    <form method="post" action="/events/movies">
      <div class="grid">
        <Input label="Title" name="title" required maxlength={200} />
        <Input label="Year" name="year" type="number" min={1880} max={2100} />
      </div>
      <Input label="Why watch it?" name="note" maxlength={300} />
      <Textarea
        label="Links (one per line)"
        name="links"
        rows={2}
        placeholder="https://letterboxd.com/film/…"
      />
      <button type="submit">Suggest</button>
    </form>
  );
}
