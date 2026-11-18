import { describe, it, expect } from 'vitest';
import { computeSplit, apportion, validatePayers } from '@/lib/split';

const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);
const ok = (r: ReturnType<typeof computeSplit>) => {
  if (!r.ok) throw new Error(r.error);
  return r.allocations;
};

describe('equal split', () => {
  it('300 ILS between three people = 100 each', () => {
    const a = ok(computeSplit(30000, 'equal', [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]));
    expect(a.map((x) => x.amount)).toEqual([10000, 10000, 10000]);
  });
  it('100 ILS between three: no lost or duplicated agorot, deterministic', () => {
    const a = ok(computeSplit(10000, 'equal', [{ userId: 'c' }, { userId: 'a' }, { userId: 'b' }]));
    expect(sum(a)).toBe(10000);
    expect(a).toEqual([
      { userId: 'a', amount: 3334 },
      { userId: 'b', amount: 3333 },
      { userId: 'c', amount: 3333 },
    ]);
  });
  it('1 agora among 3', () => {
    const a = ok(computeSplit(1, 'equal', [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]));
    expect(sum(a)).toBe(1);
  });
  it('rejects empty participants / bad totals / duplicates', () => {
    expect(computeSplit(100, 'equal', [])).toMatchObject({ ok: false, error: 'no_participants' });
    expect(computeSplit(0, 'equal', [{ userId: 'a' }])).toMatchObject({ ok: false, error: 'invalid_total' });
    expect(computeSplit(10.5, 'equal', [{ userId: 'a' }])).toMatchObject({ ok: false, error: 'invalid_total' });
    expect(computeSplit(100, 'equal', [{ userId: 'a' }, { userId: 'a' }])).toMatchObject({ ok: false, error: 'duplicate_participant' });
  });
  it('fuzz: always sums to total and differs by at most 1', () => {
    for (let t = 1; t < 2000; t += 7) {
      for (let n = 1; n <= 7; n++) {
        const a = ok(computeSplit(t, 'equal', Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }))));
        expect(sum(a)).toBe(t);
        const vals = a.map((x) => x.amount);
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('exact split', () => {
  it('500 ILS unequal allocation', () => {
    const a = ok(computeSplit(50000, 'exact', [
      { userId: 'a', value: 25000 },
      { userId: 'b', value: 15000 },
      { userId: 'c', value: 10000 },
    ]));
    expect(sum(a)).toBe(50000);
  });
  it('rejects mismatch and reports difference', () => {
    expect(computeSplit(50000, 'exact', [{ userId: 'a', value: 20000 }, { userId: 'b', value: 20000 }])).toEqual({ ok: false, error: 'exact_mismatch', detail: 10000 });
  });
  it('rejects negative values', () => {
    expect(computeSplit(100, 'exact', [{ userId: 'a', value: 200 }, { userId: 'b', value: -100 }])).toMatchObject({ ok: false, error: 'invalid_value' });
  });
});

describe('percentage split', () => {
  it('50/30/20 of 300 ILS', () => {
    const a = ok(computeSplit(30000, 'percentage', [
      { userId: 'a', value: 5000 },
      { userId: 'b', value: 3000 },
      { userId: 'c', value: 2000 },
    ]));
    expect(a.map((x) => x.amount)).toEqual([15000, 9000, 6000]);
  });
  it('33.33/33.33/33.34 of 100.00 sums exactly', () => {
    const a = ok(computeSplit(10000, 'percentage', [
      { userId: 'a', value: 3333 },
      { userId: 'b', value: 3333 },
      { userId: 'c', value: 3334 },
    ]));
    expect(sum(a)).toBe(10000);
  });
  it('rounding: 10.01 split 50/50 → no lost agora', () => {
    const a = ok(computeSplit(1001, 'percentage', [{ userId: 'a', value: 5000 }, { userId: 'b', value: 5000 }]));
    expect(sum(a)).toBe(1001);
    expect(a).toEqual([{ userId: 'a', amount: 501 }, { userId: 'b', amount: 500 }]);
  });
  it('must total 100%', () => {
    expect(computeSplit(100, 'percentage', [{ userId: 'a', value: 5000 }, { userId: 'b', value: 4000 }])).toEqual({ ok: false, error: 'percent_mismatch', detail: 1000 });
  });
});

describe('shares split', () => {
  it('2:1 shares of 90', () => {
    const a = ok(computeSplit(9000, 'shares', [{ userId: 'a', value: 200 }, { userId: 'b', value: 100 }]));
    expect(a.map((x) => x.amount)).toEqual([6000, 3000]);
  });
  it('awkward weights still sum exactly', () => {
    const a = ok(computeSplit(10000, 'shares', [{ userId: 'a', value: 100 }, { userId: 'b', value: 100 }, { userId: 'c', value: 100 }, { userId: 'd', value: 300 }]));
    expect(sum(a)).toBe(10000);
  });
  it('zero shares rejected', () => {
    expect(computeSplit(100, 'shares', [{ userId: 'a', value: 0 }])).toMatchObject({ ok: false, error: 'zero_shares' });
  });
  it('participant with zero share gets 0', () => {
    const a = ok(computeSplit(100, 'shares', [{ userId: 'a', value: 100 }, { userId: 'b', value: 0 }]));
    expect(a).toEqual([{ userId: 'a', amount: 100 }, { userId: 'b', amount: 0 }]);
  });
});

describe('apportion with huge totals', () => {
  it('handles values beyond 2^53 intermediate products', () => {
    const a = apportion(9_000_000_000_000, [{ userId: 'a', weight: 3333 }, { userId: 'b', weight: 6667 }]);
    expect(a.reduce((s, x) => s + x.amount, 0)).toBe(9_000_000_000_000);
  });
});

describe('payers', () => {
  it('multiple payers must sum to total', () => {
    expect(validatePayers(30000, [{ userId: 'a', amount: 20000 }, { userId: 'b', amount: 10000 }])).toBe(true);
    expect(validatePayers(30000, [{ userId: 'a', amount: 20000 }])).toBe(false);
    expect(validatePayers(30000, [{ userId: 'a', amount: 30000 }, { userId: 'a', amount: 0 }])).toBe(false);
  });
});
