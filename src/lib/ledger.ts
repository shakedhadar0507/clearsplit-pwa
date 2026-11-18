/**
 * Balance derivation from immutable ledger records and debt simplification.
 * Balances are always derived; never stored as editable totals.
 * Positive net = the user is owed money; negative = the user owes.
 */

export interface LedgerExpense {
  currency: string;
  deleted?: boolean;
  payers: { userId: string; amount: number }[];
  splits: { userId: string; amount: number }[];
}

export interface LedgerSettlement {
  currency: string;
  fromUser: string; // payer of the settlement (debtor paying back)
  toUser: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'reversed';
}

/** currency -> userId -> net minor units */
export type Balances = Record<string, Record<string, number>>;

export function computeBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[]): Balances {
  const out: Balances = {};
  const add = (cur: string, user: string, v: number) => {
    out[cur] ??= {};
    out[cur][user] = (out[cur][user] ?? 0) + v;
  };
  for (const e of expenses) {
    if (e.deleted) continue;
    for (const p of e.payers) add(e.currency, p.userId, p.amount);
    for (const s of e.splits) add(e.currency, s.userId, -s.amount);
  }
  for (const s of settlements) {
    if (s.status !== 'confirmed') continue;
    add(s.currency, s.fromUser, s.amount);
    add(s.currency, s.toUser, -s.amount);
  }
  return out;
}

export function sumIsZero(b: Balances): boolean {
  return Object.values(b).every((m) => Object.values(m).reduce((s, v) => s + v, 0) === 0);
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
  currency: string;
}

/**
 * Greedy simplification per currency: repeatedly match the largest debtor with the
 * largest creditor. Preserves every member's net balance; never mixes currencies.
 * Deterministic: ties broken by userId.
 */
export function simplifyDebts(balances: Balances): Transfer[] {
  const transfers: Transfer[] = [];
  for (const currency of Object.keys(balances).sort()) {
    const entries = Object.entries(balances[currency]).filter(([, v]) => v !== 0);
    const creditors = entries.filter(([, v]) => v > 0).map(([u, v]) => ({ u, v }));
    const debtors = entries.filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v }));
    const sort = (arr: { u: string; v: number }[]) => arr.sort((a, b) => b.v - a.v || (a.u < b.u ? -1 : 1));
    sort(creditors);
    sort(debtors);
    while (creditors.length && debtors.length) {
      const c = creditors[0];
      const d = debtors[0];
      const amt = Math.min(c.v, d.v);
      transfers.push({ from: d.u, to: c.u, amount: amt, currency });
      c.v -= amt;
      d.v -= amt;
      if (c.v === 0) creditors.shift();
      if (d.v === 0) debtors.shift();
      sort(creditors);
      sort(debtors);
    }
  }
  return transfers;
}

/** Apply transfers to balances (for verification that simplification preserves nets). */
export function applyTransfers(b: Balances, transfers: Transfer[]): Balances {
  const out: Balances = JSON.parse(JSON.stringify(b));
  for (const t of transfers) {
    out[t.currency][t.from] += t.amount;
    out[t.currency][t.to] -= t.amount;
  }
  return out;
}
