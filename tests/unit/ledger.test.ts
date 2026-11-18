import { describe, it, expect } from 'vitest';
import { computeBalances, simplifyDebts, applyTransfers, sumIsZero, type LedgerExpense, type LedgerSettlement } from '@/lib/ledger';
import { computeSplit } from '@/lib/split';

const exp = (currency: string, payers: [string, number][], splits: [string, number][], deleted = false): LedgerExpense => ({
  currency,
  deleted,
  payers: payers.map(([userId, amount]) => ({ userId, amount })),
  splits: splits.map(([userId, amount]) => ({ userId, amount })),
});

describe('balances', () => {
  it('scenario A: 300 ILS paid by owner split by 3', () => {
    const b = computeBalances([exp('ILS', [['owner', 30000]], [['owner', 10000], ['f1', 10000], ['f2', 10000]])], []);
    expect(b.ILS).toEqual({ owner: 20000, f1: -10000, f2: -10000 });
    expect(sumIsZero(b)).toBe(true);
  });
  it('settlement: only confirmed settlements count', () => {
    const e = [exp('ILS', [['owner', 30000]], [['owner', 10000], ['f1', 10000], ['f2', 10000]])];
    const s: LedgerSettlement[] = [
      { currency: 'ILS', fromUser: 'f1', toUser: 'owner', amount: 10000, status: 'pending' },
    ];
    expect(computeBalances(e, s).ILS.f1).toBe(-10000);
    s[0].status = 'confirmed';
    const b = computeBalances(e, s);
    expect(b.ILS).toEqual({ owner: 10000, f1: 0, f2: -10000 });
    expect(sumIsZero(b)).toBe(true);
  });
  it('reversed settlement restores debt', () => {
    const e = [exp('ILS', [['a', 1000]], [['a', 500], ['b', 500]])];
    const b = computeBalances(e, [{ currency: 'ILS', fromUser: 'b', toUser: 'a', amount: 500, status: 'reversed' }]);
    expect(b.ILS.b).toBe(-500);
  });
  it('deleted expense contributes nothing', () => {
    const b = computeBalances([exp('ILS', [['a', 1000]], [['a', 500], ['b', 500]], true)], []);
    expect(b).toEqual({});
  });
  it('editing = replacing the record; balances re-derived consistently', () => {
    const v1 = exp('ILS', [['a', 1000]], [['a', 500], ['b', 500]]);
    const v2 = exp('ILS', [['a', 1200]], [['a', 600], ['b', 600]]);
    expect(computeBalances([v1], []).ILS.b).toBe(-500);
    expect(computeBalances([v2], []).ILS.b).toBe(-600);
  });
  it('multiple payers', () => {
    const b = computeBalances([exp('ILS', [['a', 20000], ['b', 10000]], [['a', 10000], ['b', 10000], ['c', 10000]])], []);
    expect(b.ILS).toEqual({ a: 10000, b: 0, c: -10000 });
  });
  it('multi-currency kept separate', () => {
    const b = computeBalances([
      exp('ILS', [['a', 1000]], [['a', 500], ['b', 500]]),
      exp('USD', [['b', 300]], [['a', 150], ['b', 150]]),
    ], []);
    expect(b.ILS).toEqual({ a: 500, b: -500 });
    expect(b.USD).toEqual({ a: -150, b: 150 });
    expect(simplifyDebts(b)).toEqual([
      { from: 'b', to: 'a', amount: 500, currency: 'ILS' },
      { from: 'a', to: 'b', amount: 150, currency: 'USD' },
    ]);
  });
  it('zero balance scenario', () => {
    const b = computeBalances([exp('ILS', [['a', 1000]], [['a', 1000]])], []);
    expect(b.ILS).toEqual({ a: 0 });
    expect(simplifyDebts(b)).toEqual([]);
  });
});

describe('debt simplification', () => {
  it('Daniel→Maya 100, Maya→Shaked 100 ⇒ Daniel→Shaked 100', () => {
    const b = computeBalances([
      exp('ILS', [['maya', 10000]], [['daniel', 10000]]),
      exp('ILS', [['shaked', 10000]], [['maya', 10000]]),
    ], []);
    expect(simplifyDebts(b)).toEqual([{ from: 'daniel', to: 'shaked', amount: 10000, currency: 'ILS' }]);
  });
  it('fuzz: simplification preserves nets and uses ≤ n-1 transfers', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const users = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let iter = 0; iter < 200; iter++) {
      const expenses: LedgerExpense[] = [];
      for (let k = 0; k < 8; k++) {
        const total = 1 + Math.floor(rnd() * 100000);
        const payer = users[Math.floor(rnd() * users.length)];
        const parts = users.filter(() => rnd() > 0.4);
        if (!parts.length) continue;
        const r = computeSplit(total, 'equal', parts.map((userId) => ({ userId })));
        if (!r.ok) throw new Error();
        expenses.push({ currency: 'ILS', payers: [{ userId: payer, amount: total }], splits: r.allocations });
      }
      const b = computeBalances(expenses, []);
      expect(sumIsZero(b)).toBe(true);
      const t = simplifyDebts(b);
      const after = applyTransfers(b, t);
      for (const v of Object.values(after.ILS ?? {})) expect(v).toBe(0);
      const nonZero = Object.values(b.ILS ?? {}).filter((v) => v !== 0).length;
      expect(t.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      expect(t.every((x) => x.amount > 0)).toBe(true);
    }
  });
});
