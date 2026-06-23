// Split a pence total across n payers, distributing any remainder one penny at a
// time so the shares sum back to exactly `total` (no credit drift on odd splits).
export function splitPence(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0));
}
