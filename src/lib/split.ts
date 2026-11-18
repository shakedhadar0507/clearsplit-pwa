/**
 * Deterministic expense split engine. All inputs/outputs in integer minor units.
 * Mirrored by server-side validation in Postgres (sums must match exactly).
 */

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares';

export interface SplitInput {
  userId: string;
  /** exact: minor units; percentage: basis points (100% = 10000); shares: weight ×100; equal: ignored */
  value?: number;
}

export type SplitResult =
  | { ok: true; allocations: { userId: string; amount: number }[] }
  | { ok: false; error: SplitError; detail?: number };

export type SplitError =
  | 'no_participants'
  | 'invalid_total'
  | 'duplicate_participant'
  | 'invalid_value'
  | 'exact_mismatch'
  | 'percent_mismatch'
  | 'zero_shares';

const byId = (a: { userId: string }, b: { userId: string }) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * Largest-remainder apportionment. Distributes `total` proportionally to `weights`
 * so that the result sums exactly to `total`. Ties broken by userId for determinism.
 */
export function apportion(total: number, items: { userId: string; weight: number }[]): { userId: string; amount: number }[] {
  const sumW = items.reduce((s, i) => s + BigInt(i.weight), 0n);
  const T = BigInt(total);
  const rows = items.map((i) => {
    const raw = T * BigInt(i.weight);
    return { userId: i.userId, floor: raw / sumW, rem: raw % sumW };
  });
  let leftover = T - rows.reduce((s, r) => s + r.floor, 0n);
  const order = [...rows].sort((a, b) => (a.rem === b.rem ? byId(a, b) : a.rem > b.rem ? -1 : 1));
  for (const r of order) {
    if (leftover <= 0n) break;
    r.floor += 1n;
    leftover -= 1n;
  }
  return rows.map((r) => ({ userId: r.userId, amount: Number(r.floor) }));
}

export function computeSplit(total: number, method: SplitMethod, inputs: SplitInput[]): SplitResult {
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: 'invalid_total' };
  if (inputs.length === 0) return { ok: false, error: 'no_participants' };
  if (new Set(inputs.map((i) => i.userId)).size !== inputs.length) return { ok: false, error: 'duplicate_participant' };
  const sorted = [...inputs].sort(byId);

  switch (method) {
    case 'equal':
      return { ok: true, allocations: apportion(total, sorted.map((i) => ({ userId: i.userId, weight: 1 }))) };
    case 'exact': {
      if (sorted.some((i) => !Number.isSafeInteger(i.value) || (i.value as number) < 0)) return { ok: false, error: 'invalid_value' };
      const sum = sorted.reduce((s, i) => s + (i.value as number), 0);
      if (sum !== total) return { ok: false, error: 'exact_mismatch', detail: total - sum };
      return { ok: true, allocations: sorted.map((i) => ({ userId: i.userId, amount: i.value as number })) };
    }
    case 'percentage': {
      if (sorted.some((i) => !Number.isSafeInteger(i.value) || (i.value as number) < 0)) return { ok: false, error: 'invalid_value' };
      const sum = sorted.reduce((s, i) => s + (i.value as number), 0);
      if (sum !== 10000) return { ok: false, error: 'percent_mismatch', detail: 10000 - sum };
      return { ok: true, allocations: apportion(total, sorted.map((i) => ({ userId: i.userId, weight: i.value as number }))) };
    }
    case 'shares': {
      if (sorted.some((i) => !Number.isSafeInteger(i.value) || (i.value as number) < 0)) return { ok: false, error: 'invalid_value' };
      const sum = sorted.reduce((s, i) => s + (i.value as number), 0);
      if (sum === 0) return { ok: false, error: 'zero_shares' };
      return { ok: true, allocations: apportion(total, sorted.map((i) => ({ userId: i.userId, weight: i.value as number }))) };
    }
  }
}

/** Validate payer amounts: positive integers summing to total, unique payers. */
export function validatePayers(total: number, payers: { userId: string; amount: number }[]): boolean {
  if (payers.length === 0) return false;
  if (new Set(payers.map((p) => p.userId)).size !== payers.length) return false;
  if (payers.some((p) => !Number.isSafeInteger(p.amount) || p.amount <= 0)) return false;
  return payers.reduce((s, p) => s + p.amount, 0) === total;
}
