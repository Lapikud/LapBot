import type { Directory } from './directory';
import type { Actor } from './actor';

export async function visibleRecords<T extends { channelId: string }>(
  directory: Directory,
  actor: Actor,
  records: readonly T[],
): Promise<T[]> {
  const channels = [...new Set(records.map((record) => record.channelId))];
  const allowed = await Promise.all(
    channels.map(async (id) =>
      (await directory.canView(actor, id)) ? [id] : [],
    ),
  );
  const visible = new Set(allowed.flat());

  return records.filter((record) => visible.has(record.channelId));
}
