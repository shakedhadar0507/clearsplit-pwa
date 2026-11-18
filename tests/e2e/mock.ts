import type { Page, Route } from '@playwright/test';

/**
 * Minimal in-browser mock of the Supabase HTTP API (Auth + PostgREST) used for UI tests.
 * Real authorization/financial logic is covered by tests/db against Postgres.
 */
export const ME = '11111111-1111-4111-8111-111111111111';
export const MAYA = '22222222-2222-4222-8222-222222222222';
export const DANI = '33333333-3333-4333-8333-333333333333';
export const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: 'me@example.com' })}.sig`;

export const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
  user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'me@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const profile = (id: string, name: string, email: string) => ({
  id, email, display_name: name, avatar_path: null, locale: 'he', default_currency: 'ILS', theme: 'system',
  notify_prefs: { expenses: true, settlements: true, groups: true }, is_active: true, deleted_at: null,
});

export interface MockState {
  calls: { fn: string; body: unknown }[];
  balances: { group_id: string; currency: string; net: number }[];
  expenses: unknown[];
  rpcOverrides: Record<string, (body: unknown) => { status?: number; body: unknown }>;
}

export async function mockSupabase(page: Page, opts: { loggedIn?: boolean; empty?: boolean } = {}): Promise<MockState> {
  const state: MockState = {
    calls: [],
    balances: opts.empty ? [] : [{ group_id: GROUP, currency: 'ILS', net: 20000 }],
    expenses: opts.empty ? [] : [{
      id: 'e1', group_id: GROUP, description: 'ארוחת ערב', category: 'food', currency: 'ILS', amount_minor: 30000, expense_date: '2026-11-17',
      notes: null, split_method: 'equal', version: 1, created_by: ME, updated_by: null, created_at: '2026-11-17T18:00:00Z', updated_at: '2026-11-17T18:00:00Z', deleted_at: null,
      expense_payers: [{ user_id: ME, amount_minor: 30000 }],
      expense_splits: [{ user_id: ME, amount_minor: 10000, input_value: null }, { user_id: MAYA, amount_minor: 10000, input_value: null }, { user_id: DANI, amount_minor: 10000, input_value: null }],
    }],
    rpcOverrides: {},
  };
  const profiles = [profile(ME, 'שקד', 'me@example.com'), profile(MAYA, 'מאיה', 'maya@example.com'), profile(DANI, 'Daniel', 'dani@example.com')];
  const groups = [{
    id: GROUP, name: 'טיול לצפון', description: null, category: 'trip', currency: 'ILS', is_direct: false, archived_at: null, created_by: ME, created_at: '2026-11-01T00:00:00Z',
    group_members: [ME, MAYA, DANI].map((u, i) => ({ group_id: GROUP, user_id: u, role: i === 0 ? 'admin' : 'member', joined_at: '2026-11-01T00:00:00Z', left_at: null })),
  }];

  if (opts.loggedIn) {
    await page.addInitScript((s) => {
      localStorage.setItem('sb-mock-auth-token', JSON.stringify(s));
    }, session);
  }

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  await page.route('https://mock.supabase.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (path.startsWith('/auth/v1/token')) {
      const body = req.postDataJSON() as { password?: string };
      if (body.password === 'correct-horse') return json(route, session);
      return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    }
    if (path.startsWith('/auth/v1/signup')) {
      state.calls.push({ fn: 'signup', body: req.postDataJSON() });
      return json(route, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }, 500);
    }
    if (path.startsWith('/auth/v1/user')) return json(route, session.user);
    if (path.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.replace('/rest/v1/rpc/', '');
      const body = req.postDataJSON();
      state.calls.push({ fn, body });
      if (state.rpcOverrides[fn]) {
        const r = state.rpcOverrides[fn](body);
        return json(route, r.body, r.status ?? 200);
      }
      switch (fn) {
        case 'my_balances': return json(route, state.balances);
        case 'group_balances': return json(route, opts.empty ? [] : [{ user_id: ME, currency: 'ILS', net: 20000 }, { user_id: MAYA, currency: 'ILS', net: -10000 }, { user_id: DANI, currency: 'ILS', net: -10000 }]);
        case 'get_invitation_info': {
          const tok = (body as { p_token: string }).p_token;
          return json(route, tok.startsWith('valid') ? { valid: true, inviter: 'שקד', group_name: 'טיול לצפון', email_bound: true, email: 'new@example.com', can_create_account: true, is_owner_invite: false, expires_at: '2026-12-01T00:00:00Z' } : { valid: false });
        }
        case 'create_expense': return json(route, 'new-expense-id');
        default: return json(route, null);
      }
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      const accept = req.headers()['accept'] ?? '';
      const single = accept.includes('vnd.pgrst.object');
      let rows: unknown[] = [];
      if (table === 'profiles') {
        const idEq = url.searchParams.get('id')?.replace('eq.', '');
        rows = idEq ? profiles.filter((p) => p.id === idEq) : profiles;
      } else if (table === 'app_settings') rows = [{ owner_id: ME, allow_member_invites: false, invite_ttl_hours: 168 }];
      else if (table === 'groups') rows = opts.empty ? [] : groups;
      else if (table === 'expenses') {
        const idEq = url.searchParams.get('id')?.replace('eq.', '');
        rows = idEq ? [] : state.expenses; // direct access to unknown ids returns nothing (RLS)
      } else rows = [];
      return json(route, single ? rows[0] ?? null : rows);
    }
    return route.fulfill({ status: 404, body: '' });
  });
  // Realtime websocket is not mocked; the app must degrade gracefully.
  return state;
}
