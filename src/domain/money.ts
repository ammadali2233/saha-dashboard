// Integer-cent arithmetic. All money logic works in cents and converts back at the edges,
// so totals reconcile exactly (no floating-point drift).

export const toCents = (amount: number): number => Math.round(amount * 100)
export const fromCents = (cents: number): number => cents / 100

/** Round half away from zero to the nearest cent (matches Postgres numeric round()). */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/** Split `total` cents into `n` equal parts; the rounding remainder lands on the last part. */
export function splitEven(total: number, n: number): number[] {
  if (n <= 0) return []
  const each = roundCents(total / n)
  const parts = Array<number>(n).fill(each)
  parts[n - 1] = total - each * (n - 1)
  return parts
}

/** Split `total` cents in proportion to `weights`; the rounding remainder lands on the last part. */
export function splitProRata(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (sum === 0) return splitEven(total, weights.length)
  const parts = weights.map((w) => roundCents((total * w) / sum))
  const allButLast = parts.slice(0, -1).reduce((a, b) => a + b, 0)
  parts[parts.length - 1] = total - allButLast
  return parts
}
