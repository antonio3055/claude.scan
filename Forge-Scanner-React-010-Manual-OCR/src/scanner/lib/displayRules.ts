export function roundDisplayAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0) return Math.round(value);
  if (value >= 50_000) return Math.ceil(value / 50_000) * 50_000;
  return Math.ceil(value / 500) * 500;
}

export function potentialApproval(revenue: number) {
  const rounded = roundDisplayAmount(revenue) ?? 0;
  return rounded + 150_000;
}
