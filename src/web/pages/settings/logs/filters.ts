export const levels = [
  { name: 'trace', value: 10 },
  { name: 'debug', value: 20 },
  { name: 'info', value: 30 },
  { name: 'warn', value: 40 },
  { name: 'error', value: 50 },
  { name: 'fatal', value: 60 },
] as const;

export function logPageNumber(value: string | undefined): number {
  const cursor = Number(value);

  return Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 1;
}
