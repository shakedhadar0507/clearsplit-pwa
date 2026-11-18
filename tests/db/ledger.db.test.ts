import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { freshDb, expectErr, setupUsers, type Db } from './harness';
import { computeSplit } from '@/lib/split';
import { computeBalances, sumIsZero, simplifyDebts } from '@/lib/ledger';

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const equalExpense = (gid: string, payer: string, total: number, users: string[], extra: Record<string, unknown> = {}) => {
  const r = computeSplit(total, 'equal', users.map((userId) => ({ userId })));
  if (!r.ok) throw new Error(r.error);
  return {
    group_id: gid, description: 'Dinner', category: 'food', currency: 'ILS', amount_minor: total,
    split_method: 'equal', payers: [{ user_id: payer, amount_minor: total }],
    splits: r.allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amount })),
    idempotency_key: randomUUID(), ...extra,
  };
};

async function balances(uid: string, gid: string) {
  const rows = await db.as<{ user_id: string; currency: string; net: string }>(uid, 'select * from public.group_balances($1)', [gid]);
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.currency] ??= {})[r.user_id] = Number(r.net);
  return out;
}

async function groupWith(owner: string, members: string[], name = 'Trip') {
  const gid = await db.rpc<string>(owner, 'create_group', { p_name: name, p_description: '', p_category: 'trip', p_currency: 'ILS' });
  for (const m of members) {
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', { p_group_id: gid });
    await db.rpc(m, 'accept_invitation', { p_token: inv.token });
  }
  return gid;
}

describe('signup gate & invitations', () => {
  it('rejects signup without/with invalid invitation', async () => {
    await expectErr(db.signUp('x@example.com', {}), 'signup_requires_invitation');
    await expectErr(db.signUp('x@example.com', { invite_token: 'a'.repeat(64) }), 'invalid_invitation');
    expect((await db.sql('select count(*)::int c from public.profiles'))[0]).toEqual({ c: 0 });
  });

  it('owner bootstrap: single use, email bound, cannot run twice', async () => {
    const tok = (await db.sql<{ t: string }>(`select public.bootstrap_owner_invitation('Owner@Example.com') as t`))[0].t;
    await expectErr(db.signUp('other@example.com', { invite_token: tok }), 'invitation_email_mismatch');
    const owner = await db.signUp('owner@example.com', { invite_token: tok, display_name: 'Owner' });
    expect((await db.sql('select owner_id from public.app_settings'))[0].owner_id).toBe(owner);
    await expectErr(db.signUp('owner2@example.com', { invite_token: tok }), 'invalid_invitation');
    await expectErr(db.sql(`select public.bootstrap_owner_invitation('a@b.co')`), 'owner_already_set');
  });

  it('bootstrap is not callable by clients', async () => {
    await expectErr(db.as(null, `select public.bootstrap_owner_invitation('a@b.co')`), 'permission denied');
    const { friends } = await setupUsers(db, 1);
    await expectErr(db.as(friends[0], `select public.bootstrap_owner_invitation('a@b.co')`), 'permission denied');
  });

  it('invitation reuse, expiry and revocation are blocked', async () => {
    const { owner } = await setupUsers(db, 0);
    const inv = await db.rpc<{ token: string; id: string }>(owner, 'create_invitation', {});
    await db.signUp('a@example.com', { invite_token: inv.token });
    await expectErr(db.signUp('b@example.com', { invite_token: inv.token }), 'invalid_invitation');

    const inv2 = await db.rpc<{ token: string; id: string }>(owner, 'create_invitation', {});
    await db.sql(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [inv2.id]);
    await expectErr(db.signUp('c@example.com', { invite_token: inv2.token }), 'invalid_invitation');

    const inv3 = await db.rpc<{ token: string; id: string }>(owner, 'create_invitation', {});
    await db.rpc(owner, 'revoke_invitation', { p_id: inv3.id });
    await expectErr(db.signUp('d@example.com', { invite_token: inv3.token }), 'invalid_invitation');
  });

  it('only stores token hash, never the token', async () => {
    const { owner } = await setupUsers(db, 0);
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', {});
    const rows = await db.sql(`select * from public.invitations`);
    expect(JSON.stringify(rows)).not.toContain(inv.token);
  });

  it('members cannot create account-creating invites unless owner allows', async () => {
    const { owner, friends } = await setupUsers(db, 1);
    const inv = await db.rpc<{ token: string; can_create_account: boolean }>(friends[0], 'create_invitation', {});
    expect(inv.can_create_account).toBe(false);
    await expectErr(db.signUp('z@example.com', { invite_token: inv.token }), 'invalid_invitation');
    await expectErr(db.rpc(friends[0], 'update_app_settings', { p_allow_member_invites: true, p_invite_ttl_hours: 24 }), 'not_owner');
    await db.rpc(owner, 'update_app_settings', { p_allow_member_invites: true, p_invite_ttl_hours: 24 });
    const inv2 = await db.rpc<{ token: string }>(friends[0], 'create_invitation', {});
    await db.signUp('z@example.com', { invite_token: inv2.token });
  });

  it('anon can look up minimal invitation info only', async () => {
    const { owner } = await setupUsers(db, 0);
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', { p_email: 'n@example.com' });
    const info = await db.rpc<Record<string, unknown>>(null, 'get_invitation_info', { p_token: inv.token });
    expect(info).toMatchObject({ valid: true, inviter: 'Owner', email_bound: true });
    expect((await db.rpc<Record<string, unknown>>(null, 'get_invitation_info', { p_token: 'x'.repeat(64) })).valid).toBe(false);
    await expectErr(db.as(null, 'select * from public.invitations'), 'permission denied');
    await expectErr(db.as(null, 'select * from public.expenses'), 'permission denied');
    await expectErr(db.as(null, `select public.create_group('a','','trip','ILS')`), 'permission denied');
  });

  it('invitation joins group and creates friendship', async () => {
    const { owner } = await setupUsers(db, 0);
    const gid = await db.rpc<string>(owner, 'create_group', { p_name: 'Flat', p_description: '', p_category: 'apartment', p_currency: 'ILS' });
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', { p_group_id: gid });
    const u = await db.signUp('new@example.com', { invite_token: inv.token, display_name: 'New' });
    const members = await db.as(u, 'select user_id from public.group_members where group_id = $1', [gid]);
    expect(members).toHaveLength(2);
    const fr = await db.as(u, 'select * from public.friendships');
    expect(fr).toHaveLength(1);
  });
});

describe('Scenario A: group expense, settlement with confirmation', () => {
  it('300 ILS equal split, settle, confirm', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1, f2]);
    await db.rpc(owner, 'create_expense', { p: equalExpense(gid, owner, 30000, [owner, f1, f2]) });

    for (const u of [owner, f1, f2]) {
      expect(await balances(u, gid)).toEqual({ ILS: { [owner]: 20000, [f1]: -10000, [f2]: -10000 } });
    }

    // f1 records paying owner → pending; does not change balances yet
    const sid = await db.rpc<string>(f1, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 10000, currency: 'ILS', idempotency_key: randomUUID() } });
    expect((await db.sql(`select status from public.settlements where id = $1`, [sid]))[0].status).toBe('pending');
    expect((await balances(owner, gid)).ILS[f1]).toBe(-10000);

    // f1 cannot confirm own payment; f2 cannot confirm either
    await expectErr(db.rpc(f1, 'confirm_settlement', { p_id: sid }), 'forbidden');
    await expectErr(db.rpc(f2, 'confirm_settlement', { p_id: sid }), 'forbidden');
    await db.rpc(owner, 'confirm_settlement', { p_id: sid });
    const b = await balances(f2, gid);
    expect(b).toEqual({ ILS: { [owner]: 10000, [f1]: 0, [f2]: -10000 } });
    expect(sumIsZero(b)).toBe(true);

    // owner was notified of the request; f1 of confirmation
    const n1 = await db.as<{ type: string }>(owner, 'select type from public.notifications order by id');
    expect(n1.map((n) => n.type)).toContain('settlement_requested');
    const n2 = await db.as<{ type: string }>(f1, 'select type from public.notifications order by id');
    expect(n2.map((n) => n.type)).toContain('settlement_confirmed');
  });

  it('recipient-recorded settlement is confirmed immediately; reversal restores debt', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    await db.rpc(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    const sid = await db.rpc<string>(owner, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 500, currency: 'ILS' } });
    expect((await balances(owner, gid)).ILS[f1]).toBe(0);
    await db.rpc(f1, 'reverse_settlement', { p_id: sid, p_reason: 'mistake' });
    expect((await balances(owner, gid)).ILS[f1]).toBe(-500);
    await expectErr(db.rpc(f1, 'reverse_settlement', { p_id: sid }), 'invalid_state');
    const act = await db.as<{ action: string }>(owner, 'select action from public.activity_logs where group_id = $1 order by id', [gid]);
    expect(act.map((a) => a.action)).toEqual(expect.arrayContaining(['settlement_recorded', 'settlement_reversed']));
  });

  it('pending settlement can be rejected or cancelled and never counts', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    await db.rpc(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    const s1 = await db.rpc<string>(f1, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 500, currency: 'ILS' } });
    await db.rpc(owner, 'reject_settlement', { p_id: s1 });
    const s2 = await db.rpc<string>(f1, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 500, currency: 'ILS' } });
    await expectErr(db.rpc(owner, 'cancel_settlement', { p_id: s2 }), 'forbidden');
    await db.rpc(f1, 'cancel_settlement', { p_id: s2 });
    expect((await balances(owner, gid)).ILS[f1]).toBe(-500);
  });

  it('settlement idempotency prevents duplicates', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const key = randomUUID();
    const p = { group_id: gid, from_user: f1, to_user: owner, amount_minor: 500, currency: 'ILS', idempotency_key: key };
    const a = await db.rpc(f1, 'record_settlement', { p });
    const b = await db.rpc(f1, 'record_settlement', { p });
    expect(a).toBe(b);
    expect((await db.sql('select count(*)::int c from public.settlements'))[0].c).toBe(1);
  });
});

describe('Scenario B: unequal split', () => {
  it('500 ILS exact allocation validated; activity recorded', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1, f2]);
    const base = { group_id: gid, description: 'Groceries', category: 'groceries', currency: 'ILS', amount_minor: 50000, split_method: 'exact',
      payers: [{ user_id: owner, amount_minor: 50000 }] };
    await expectErr(db.rpc(owner, 'create_expense', { p: { ...base, splits: [
      { user_id: owner, amount_minor: 20000 }, { user_id: f1, amount_minor: 20000 }, { user_id: f2, amount_minor: 5000 }] } }), 'splits_mismatch');
    await db.rpc(owner, 'create_expense', { p: { ...base, splits: [
      { user_id: owner, amount_minor: 25000, input_value: 25000 }, { user_id: f1, amount_minor: 15000, input_value: 15000 }, { user_id: f2, amount_minor: 10000, input_value: 10000 }] } });
    expect(await balances(f1, gid)).toEqual({ ILS: { [owner]: 25000, [f1]: -15000, [f2]: -10000 } });
    const act = await db.as<{ action: string; details: { amount_minor: number } }>(f2, `select action, details from public.activity_logs where group_id = $1 and action = 'expense_created'`, [gid]);
    expect(act).toHaveLength(1);
    expect(Number(act[0].details.amount_minor)).toBe(50000);
  });

  it('percentage split must total 100% server-side; payers must match', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const p = { group_id: gid, description: 'x', currency: 'ILS', amount_minor: 1000, split_method: 'percentage',
      payers: [{ user_id: owner, amount_minor: 1000 }],
      splits: [{ user_id: owner, amount_minor: 500, input_value: 5000 }, { user_id: f1, amount_minor: 500, input_value: 4000 }] };
    await expectErr(db.rpc(owner, 'create_expense', { p }), 'percent_mismatch');
    await expectErr(db.rpc(owner, 'create_expense', { p: { ...p, split_method: 'exact', payers: [{ user_id: owner, amount_minor: 900 }] } }), 'payers_mismatch');
    await expectErr(db.rpc(owner, 'create_expense', { p: { ...p, split_method: 'exact', amount_minor: 10.5 } }), 'invalid_amount');
  });

  it('multiple payers and multiple currencies stay separate', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1, f2]);
    await db.rpc(owner, 'create_expense', { p: { ...equalExpense(gid, owner, 30000, [owner, f1, f2]), payers: [{ user_id: owner, amount_minor: 20000 }, { user_id: f1, amount_minor: 10000 }] } });
    await db.rpc(f2, 'create_expense', { p: { ...equalExpense(gid, f2, 900, [owner, f1, f2]), currency: 'USD' } });
    const b = await balances(owner, gid);
    expect(b.ILS).toEqual({ [owner]: 10000, [f1]: 0, [f2]: -10000 });
    expect(b.USD).toEqual({ [owner]: -300, [f1]: -300, [f2]: 600 });
    expect(sumIsZero(b)).toBe(true);
  });
});

describe('editing and deleting expenses', () => {
  it('edit replaces lines atomically with version check and revision history', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    const v = await db.rpc<number>(owner, 'update_expense', { p_expense_id: eid, p: equalExpense(gid, owner, 3000, [owner, f1]), p_expected_version: 1 });
    expect(v).toBe(2);
    expect((await balances(owner, gid)).ILS[f1]).toBe(-1500);
    await expectErr(db.rpc(owner, 'update_expense', { p_expense_id: eid, p: equalExpense(gid, owner, 5000, [owner, f1]), p_expected_version: 1 }), 'version_conflict');
    // invalid edit leaves previous state intact
    await expectErr(db.rpc(owner, 'update_expense', { p_expense_id: eid, p: { ...equalExpense(gid, owner, 3000, [owner, f1]), amount_minor: 2999 }, p_expected_version: 2 }), 'mismatch');
    expect((await balances(owner, gid)).ILS[f1]).toBe(-1500);
    const revs = await db.as<{ action: string }>(f1, 'select action from public.expense_revisions where expense_id = $1 order by id', [eid]);
    expect(revs.map((r) => r.action)).toEqual(['created', 'updated']);
  });

  it('delete is soft, reversible, audited and balances re-derive', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    await db.rpc(owner, 'delete_expense', { p_expense_id: eid });
    expect(await balances(owner, gid)).toEqual({});
    await db.rpc(owner, 'restore_expense', { p_expense_id: eid });
    expect((await balances(owner, gid)).ILS[f1]).toBe(-500);
    const act = await db.as<{ action: string }>(owner, 'select action from public.activity_logs where entity_id = $1 order by id', [eid]);
    expect(act.map((a) => a.action)).toEqual(['expense_created', 'expense_deleted', 'expense_restored']);
  });

  it('expense idempotency', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const p = equalExpense(gid, owner, 1000, [owner, f1]);
    expect(await db.rpc(owner, 'create_expense', { p })).toBe(await db.rpc(owner, 'create_expense', { p }));
    expect((await db.sql('select count(*)::int c from public.expenses'))[0].c).toBe(1);
  });

  it('SQL balances match TypeScript engine on random ledger; invariant holds', async () => {
    const { owner, friends } = await setupUsers(db, 3);
    const users = [owner, ...friends];
    const gid = await groupWith(owner, friends);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const ledger: Parameters<typeof computeBalances>[0] = [];
    for (let i = 0; i < 15; i++) {
      const total = 1 + Math.floor(rnd() * 50000);
      const payer = users[Math.floor(rnd() * users.length)];
      const parts = users.filter(() => rnd() > 0.3);
      if (!parts.length) continue;
      const p = equalExpense(gid, payer, total, parts);
      await db.rpc(payer, 'create_expense', { p });
      ledger.push({ currency: 'ILS', payers: [{ userId: payer, amount: total }], splits: p.splits.map((s) => ({ userId: s.user_id, amount: s.amount_minor })) });
    }
    const sqlB = await balances(owner, gid);
    const tsB = computeBalances(ledger, []);
    for (const u of Object.keys(tsB.ILS)) expect(sqlB.ILS?.[u] ?? 0).toBe(tsB.ILS[u]);
    expect(sumIsZero(sqlB)).toBe(true);
    // settling all simplified transfers zeroes the group
    for (const t of simplifyDebts(sqlB)) {
      await db.rpc(t.to, 'record_settlement', { p: { group_id: gid, from_user: t.from, to_user: t.to, amount_minor: t.amount, currency: t.currency } });
    }
    expect(await balances(owner, gid)).toSatisfy((b: Record<string, Record<string, number>>) => Object.values(b.ILS ?? {}).every((v) => v === 0));
  });
});

describe('Scenario C: authorization boundaries', () => {
  it('outsider cannot read or modify another group', async () => {
    const { owner, friends: [f1, outsider] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });

    expect(await db.as(outsider, 'select * from public.expenses where id = $1', [eid])).toEqual([]);
    expect(await db.as(outsider, 'select * from public.groups where id = $1', [gid])).toEqual([]);
    expect(await db.as(outsider, 'select * from public.expense_splits where expense_id = $1', [eid])).toEqual([]);
    expect(await db.as(outsider, 'select * from public.activity_logs where group_id = $1', [gid])).toEqual([]);
    await expectErr(db.rpc(outsider, 'group_balances', { gid }), 'not_member');
    await expectErr(db.rpc(outsider, 'update_expense', { p_expense_id: eid, p: equalExpense(gid, outsider, 1000, [outsider]), p_expected_version: 1 }), 'not_found');
    await expectErr(db.rpc(outsider, 'delete_expense', { p_expense_id: eid }), 'not_found');
    await expectErr(db.rpc(outsider, 'create_expense', { p: equalExpense(gid, outsider, 1000, [outsider]) }), 'not_member');
    await expectErr(db.rpc(outsider, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 1, currency: 'ILS' } }), 'not_member');
    // cannot see other users' profiles
    expect(await db.as(outsider, 'select * from public.profiles where id = $1', [f1])).toEqual([]);
  });

  it('direct table writes are denied for clients', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    await expectErr(db.as(f1, `update public.expenses set amount_minor = 1 where id = $1`, [eid]), 'permission denied');
    await expectErr(db.as(f1, `update public.expense_splits set amount_minor = 0 where expense_id = $1`, [eid]), 'permission denied');
    await expectErr(db.as(f1, `insert into public.group_members (group_id, user_id) values ($1, $2)`, [gid, f1]), 'permission denied');
    await expectErr(db.as(f1, `insert into public.settlements (group_id, currency, amount_minor, from_user, to_user, status, created_by) values ($1,'ILS',1,$2,$3,'confirmed',$2)`, [gid, owner, f1]), 'permission denied');
    await expectErr(db.as(f1, `update public.profiles set is_active = false where id = $1`, [f1]), 'permission denied');
    await expectErr(db.as(f1, `update public.app_settings set owner_id = $1`, [f1]), 'permission denied');
    await expectErr(db.as(f1, `delete from public.activity_logs`), 'permission denied');
  });

  it('non-creator non-payer member cannot edit; admin can', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1, f2]);
    const eid = await db.rpc<string>(f1, 'create_expense', { p: equalExpense(gid, f1, 900, [owner, f1, f2]) });
    await expectErr(db.rpc(f2, 'delete_expense', { p_expense_id: eid }), 'forbidden');
    await db.rpc(owner, 'delete_expense', { p_expense_id: eid });
  });

  it('cannot add non-members as participants', async () => {
    const { owner, friends: [f1, outsider] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1]);
    await expectErr(db.rpc(owner, 'create_expense', { p: equalExpense(gid, owner, 900, [owner, f1, outsider]) }), 'participant_not_member');
  });

  it('member leaving requires zero balance; history stays consistent', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1, f2]);
    await db.rpc(owner, 'create_expense', { p: equalExpense(gid, owner, 900, [owner, f1]) });
    await expectErr(db.rpc(f1, 'remove_group_member', { p_group_id: gid, p_user_id: f1 }), 'open_balance');
    await expectErr(db.rpc(f2, 'remove_group_member', { p_group_id: gid, p_user_id: f1 }), 'not_admin');
    await db.rpc(f2, 'remove_group_member', { p_group_id: gid, p_user_id: f2 });
    expect(await db.as(f2, 'select * from public.expenses where group_id = $1', [gid])).toEqual([]);
  });

  it('disabled user loses all access; archived group blocks writes', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    await expectErr(db.rpc(f1, 'set_user_active', { p_user_id: owner, p_active: false }), 'not_owner');
    await db.rpc(owner, 'set_user_active', { p_user_id: f1, p_active: false });
    expect(await db.as(f1, 'select * from public.groups')).toEqual([]);
    await expectErr(db.rpc(f1, 'create_expense', { p: equalExpense(gid, f1, 100, [f1]) }), 'not_authenticated');
    await db.rpc(owner, 'set_user_active', { p_user_id: f1, p_active: true });
    await db.rpc(owner, 'set_group_archived', { p_group_id: gid, p_archived: true });
    await expectErr(db.rpc(f1, 'create_expense', { p: equalExpense(gid, f1, 100, [f1]) }), 'group_archived');
  });

  it('invitation for a group requires membership; email-bound invite enforced', async () => {
    const { owner, friends: [f1, f2] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1]);
    await expectErr(db.rpc(f2, 'create_invitation', { p_group_id: gid }), 'not_member');
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', { p_group_id: gid, p_email: 'someone@else.com' });
    await expectErr(db.rpc(f2, 'accept_invitation', { p_token: inv.token }), 'invitation_email_mismatch');
  });

  it('profile guard: users cannot change protected fields via allowed columns path', async () => {
    const { friends: [f1] } = await setupUsers(db, 1);
    await db.as(f1, `update public.profiles set display_name = 'Me', locale = 'en' where id = $1`, [f1]);
    await expectErr(db.as(f1, `update public.profiles set avatar_path = 'other/x.png' where id = $1`, [f1]), 'invalid_avatar_path');
    const rows = await db.as(f1, `update public.profiles set display_name = 'Hack' where id <> $1 returning id`, [f1]);
    expect(rows).toEqual([]);
  });
});

describe('friends, export and deletion', () => {
  it('direct friend expenses, remove friend requires zero balance', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const fr = (await db.as<{ direct_group_id: string }>(owner, 'select direct_group_id from public.friendships'))[0];
    await db.rpc(owner, 'create_expense', { p: equalExpense(fr.direct_group_id, owner, 1000, [owner, f1]) });
    await expectErr(db.rpc(f1, 'remove_friend', { p_user_id: owner }), 'open_balance');
    const my = await db.as<{ net: string }>(f1, 'select * from public.my_balances()');
    expect(Number(my[0].net)).toBe(-500);
  });

  it('account deletion blocked with balance, anonymises when settled', async () => {
    const { owner, friends: [f1] } = await setupUsers(db, 1);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    await expectErr(db.rpc(f1, 'delete_my_account'), 'open_balance');
    await db.rpc(owner, 'record_settlement', { p: { group_id: gid, from_user: f1, to_user: owner, amount_minor: 500, currency: 'ILS' } });
    const data = await db.rpc<{ expense_shares: unknown[] }>(f1, 'export_my_data');
    expect(data.expense_shares).toHaveLength(1);
    await db.rpc(f1, 'delete_my_account');
    expect(await db.sql('select * from auth.users where id = $1', [f1])).toEqual([]);
    const prof = (await db.sql<{ display_name: string; email: string | null }>('select display_name, email from public.profiles where id = $1', [f1]))[0];
    expect(prof).toEqual({ display_name: 'Deleted user', email: null });
    // history intact for owner
    expect(await db.as(owner, 'select id from public.expenses where id = $1', [eid])).toHaveLength(1);
    expect((await balances(owner, gid)).ILS[owner]).toBe(0);
    await expectErr(db.rpc(owner, 'delete_my_account'), 'owner_cannot_delete');
  });
});

describe('storage policies', () => {
  it('receipt objects only insertable/readable by group members', async () => {
    const { owner, friends: [f1, outsider] } = await setupUsers(db, 2);
    const gid = await groupWith(owner, [f1]);
    const eid = await db.rpc<string>(owner, 'create_expense', { p: equalExpense(gid, owner, 1000, [owner, f1]) });
    const path = `${gid}/${eid}/r.jpg`;
    await db.as(f1, `insert into storage.objects (bucket_id, name, owner_id) values ('receipts', $1, $2)`, [path, f1]);
    await expectErr(db.as(outsider, `insert into storage.objects (bucket_id, name, owner_id) values ('receipts', $1, $2)`, [`${gid}/${eid}/x.jpg`, outsider]), 'row-level security');
    expect(await db.as(outsider, `select * from storage.objects where bucket_id = 'receipts'`)).toEqual([]);
    expect(await db.as(owner, `select * from storage.objects where bucket_id = 'receipts'`)).toHaveLength(1);
    await db.rpc(f1, 'add_receipt', { p_expense_id: eid, p_path: path, p_mime: 'image/jpeg', p_size: 1000 });
    await expectErr(db.rpc(f1, 'add_receipt', { p_expense_id: eid, p_path: `other/${eid}/r.jpg`, p_mime: 'image/jpeg', p_size: 1000 }), 'invalid_path');
  });
});
