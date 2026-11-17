export async function sequential<T>(
  items: Iterable<T>,
  run: (item: T) => Promise<unknown>,
): Promise<void> {
  for (const item of items) {
    await run(item);
  }
}
