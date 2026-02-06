interface ClockOptions {
  rounding?: 'floor' | 'round';
  invalid?: string | null;
}

export function formatMinutesSeconds(
  ms?: number | null,
  options?: ClockOptions,
): string | null {
  const rounding = options?.rounding ?? 'floor';
  const invalid = options?.invalid ?? 'N/A';

  if (!Number.isFinite(ms)) return invalid;
  const value = Math.max(0, Number(ms));
  const totalSeconds =
    rounding === 'round' ? Math.round(value / 1000) : Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function pickNumber(
  ...values: Array<number | string | null | undefined>
): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(num)) {
      return Number(num);
    }
  }
  return undefined;
}
