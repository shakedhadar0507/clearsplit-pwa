import type { TFunction } from 'i18next';

/** Extracts a ClearSplit error code from a Supabase/PostgREST error message ("cs:code"). */
export function errorCode(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err ?? '');
  const m = /cs:([a-z_]+)/.exec(msg);
  if (m) return m[1];
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'network';
  if (/Invalid login credentials/i.test(msg)) return 'invalid_credentials';
  if (/JWT|not authenticated|session/i.test(msg)) return 'not_authenticated';
  return 'generic';
}

export function errorText(t: TFunction, err: unknown): string {
  const code = errorCode(err);
  if (code === 'invalid_credentials') return t('auth.invalidCredentials');
  const key = `errors.${code}`;
  const txt = t(key);
  return txt === key ? t('errors.generic') : txt;
}
