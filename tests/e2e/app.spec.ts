import { test, expect, type Page } from '@playwright/test';
import { mockSupabase, ME, MAYA, DANI, GROUP } from './mock';

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('auth & localization', () => {
  test('login page is Hebrew RTL by default and switches to English LTR', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'ברוכים השבים' })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('wrong password shows a localized error', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/login');
    await page.getByLabel('אימייל').fill('me@example.com');
    await page.getByLabel('סיסמה').fill('nope');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByRole('alert')).toHaveText('אימייל או סיסמה שגויים.');
  });

  test('successful sign-in lands on dashboard', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/login');
    await page.getByLabel('אימייל').fill('me@example.com');
    await page.getByLabel('סיסמה').fill('correct-horse');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByRole('heading', { name: 'סקירה' })).toBeVisible();
  });

  test('invalid / missing invitation is rejected safely', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/join#' + 'x'.repeat(64));
    await expect(page.getByText('ההזמנה אינה תקפה, פגה או שכבר נוצלה.')).toBeVisible();
    await page.goto('/join');
    await expect(page.getByText('ההזמנה אינה תקפה, פגה או שכבר נוצלה.')).toBeVisible();
  });

  test('valid invitation shows bound email and sends token in signup metadata', async ({ page }) => {
    const state = await mockSupabase(page);
    const token = 'valid' + 'a'.repeat(59);
    await page.goto('/join#' + token);
    await expect(page.getByText('שקד הזמין/ה אותך להצטרף ל„טיול לצפון”')).toBeVisible();
    const email = page.getByLabel('אימייל');
    await expect(email).toHaveValue('new@example.com');
    await expect(email).toHaveAttribute('readonly', '');
    await page.getByLabel('השם שלך').fill('מאיה');
    await page.getByLabel('סיסמה').fill('short');
    await page.getByRole('button', { name: 'יצירת חשבון' }).click();
    await expect(page.getByRole('alert')).toHaveText('הסיסמה חייבת להכיל לפחות 8 תווים.');
    await page.getByLabel('סיסמה').fill('long-enough-pw');
    await page.getByRole('button', { name: 'יצירת חשבון' }).click();
    // Server rejects (mock) → app shows the invitation error, not a crash
    await expect(page.getByRole('alert')).toHaveText('ההזמנה אינה תקפה, פגה או שכבר נוצלה.');
    const signup = state.calls.find((c) => c.fn === 'signup')!.body as { data: { invite_token: string } };
    expect(signup.data.invite_token).toBe(token);
  });
});

test.describe('signed-in app', () => {
  test('dashboard shows balances with owed/owe indicators; responsive without overflow', async ({ page }, info) => {
    await mockSupabase(page, { loggedIn: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'סקירה' })).toBeVisible();
    const summary = page.getByTestId('summary-ILS');
    await expect(summary).toContainText('200.00');
    await expect(summary.getByText('חייבים לך')).toBeVisible();
    await expect(page.getByText('טיול לצפון').first()).toBeVisible();
    await noHorizontalOverflow(page);
    if (info.project.name === 'mobile') {
      await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
      await expect(page.getByRole('button', { name: 'הוספת הוצאה' }).last()).toBeVisible();
    }
    await page.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: true });
  });

  test('zero-balance state', async ({ page }) => {
    await mockSupabase(page, { loggedIn: true, empty: true });
    await page.goto('/');
    await expect(page.getByText('הכול מאוזן')).toBeVisible();
  });

  test('Scenario A UI: 300 ILS equal split preview and payload', async ({ page }) => {
    const state = await mockSupabase(page, { loggedIn: true });
    await page.goto(`/expense/new?group=${GROUP}`);
    await page.getByLabel('על מה?').fill('ארוחת ערב');
    await page.getByLabel('סכום', { exact: true }).fill('300');
    for (const u of [ME, MAYA, DANI]) await expect(page.getByTestId(`alloc-${u}`)).toContainText('100.00');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await expect.poll(() => state.calls.some((c) => c.fn === 'create_expense')).toBe(true);
    const p = (state.calls.find((c) => c.fn === 'create_expense')!.body as { p: { amount_minor: number; splits: { amount_minor: number }[]; payers: { user_id: string; amount_minor: number }[]; idempotency_key: string } }).p;
    expect(p.amount_minor).toBe(30000);
    expect(p.splits.map((s) => s.amount_minor)).toEqual([10000, 10000, 10000]);
    expect(p.payers).toEqual([{ user_id: ME, amount_minor: 30000 }]);
    expect(p.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('Scenario B UI: exact split must match; percentages 50/30/20', async ({ page }) => {
    const state = await mockSupabase(page, { loggedIn: true });
    await page.goto(`/expense/new?group=${GROUP}`);
    await page.getByLabel('על מה?').fill('קניות');
    await page.getByLabel('סכום', { exact: true }).fill('500');
    await page.getByRole('radio', { name: 'סכומים מדויקים' }).click();
    await page.getByLabel('סכומים מדויקים את/ה').fill('250');
    await page.getByLabel('סכומים מדויקים מאיה').fill('150');
    await page.getByLabel('סכומים מדויקים Daniel').fill('50');
    await expect(page.getByText(/נותר:/)).toContainText('50.00');
    await expect(page.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    await page.getByLabel('סכומים מדויקים Daniel').fill('100');
    await expect(page.getByRole('button', { name: 'שמירה' })).toBeEnabled();

    await page.getByRole('radio', { name: 'אחוזים' }).click();
    await page.getByLabel('אחוזים את/ה').fill('50');
    await page.getByLabel('אחוזים מאיה').fill('30');
    await page.getByLabel('אחוזים Daniel').fill('10');
    await expect(page.getByText('נותר: 10%')).toBeVisible();
    await page.getByLabel('אחוזים Daniel').fill('20');
    await expect(page.getByTestId(`alloc-${ME}`)).toContainText('250.00');
    await expect(page.getByTestId(`alloc-${MAYA}`)).toContainText('150.00');
    await expect(page.getByTestId(`alloc-${DANI}`)).toContainText('100.00');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await expect.poll(() => state.calls.some((c) => c.fn === 'create_expense')).toBe(true);
    const p = (state.calls.find((c) => c.fn === 'create_expense')!.body as { p: { split_method: string; splits: { input_value: number }[] } }).p;
    expect(p.split_method).toBe('percentage');
    expect(p.splits.map((s) => s.input_value).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  test('server-side validation errors are shown, not swallowed', async ({ page }) => {
    const state = await mockSupabase(page, { loggedIn: true });
    state.rpcOverrides.create_expense = () => ({ status: 400, body: { code: 'P0001', message: 'cs:participant_not_member' } });
    await page.goto(`/expense/new?group=${GROUP}`);
    await page.getByLabel('על מה?').fill('x');
    await page.getByLabel('סכום', { exact: true }).fill('90');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await expect(page.getByRole('alert')).toHaveText('כל המשתתפים בהוצאה חייבים להיות חברים פעילים בקבוצה.');
  });

  test('Scenario C UI: direct access to an unrelated expense is handled safely', async ({ page }) => {
    await mockSupabase(page, { loggedIn: true });
    await page.goto('/expense/99999999-9999-4999-8999-999999999999');
    await expect(page.getByText('ההוצאה לא נמצאה או שאין לך גישה אליה.')).toBeVisible();
    await page.goto('/groups/99999999-9999-4999-8999-999999999999');
    await expect(page.getByText('לא נמצא או שאין גישה.')).toBeVisible();
  });

  test('group page shows balances and simplified suggestions', async ({ page }) => {
    await mockSupabase(page, { loggedIn: true });
    await page.goto(`/groups/${GROUP}#balances`);
    await expect(page.getByText('תשלומים מוצעים')).toBeVisible();
    await expect(page.getByText('מאיה משלם/ת לאת/ה')).toBeVisible();
    await expect(page.getByText('Daniel משלם/ת לאת/ה')).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('offline: banner shown and saving disabled', async ({ page, context }) => {
    await mockSupabase(page, { loggedIn: true });
    await page.goto(`/expense/new?group=${GROUP}`);
    await page.getByLabel('על מה?').fill('x');
    await page.getByLabel('סכום', { exact: true }).fill('90');
    await context.setOffline(true);
    await expect(page.getByText('אין חיבור לאינטרנט.', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'שמירה' })).toBeEnabled();
  });

  test('dark mode and English LTR settings', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockSupabase(page, { loggedIn: true });
    await page.goto('/settings');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Administration')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });
  test('manifest, icons and service worker', async ({ page, request }) => {
    await mockSupabase(page);
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({ name: 'ClearSplit', display: 'standalone', start_url: '/', lang: 'he', dir: 'rtl' });
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i: { sizes: string; purpose: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) {
      const r = await request.get(i.src);
      expect(r.ok()).toBe(true);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
    await page.goto('/login');
    const link = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(link).toContain('manifest.webmanifest');
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      return r.active?.scriptURL ?? null;
    });
    expect(reg).toContain('/sw.js');
  });

  test('app shell loads offline after first visit', async ({ page, context }) => {
    await mockSupabase(page);
    await page.goto('/login');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ברוכים השבים' })).toBeVisible();
    await expect(page.getByText('אין חיבור לאינטרנט.', { exact: false })).toBeVisible();
    await context.setOffline(false);
  });
});
