/**
 * API and AuthProvider return i18n keys shaped like `errors.authX`.
 * i18next namespaces are addressed as `ns:key`, so passing the raw key to
 * `t()` renders the key itself instead of the translated message.
 * This normalises the key so forms show a readable, localised error.
 */
export function errorI18nKey(key?: string | null, fallback = 'errors:authGeneric'): string {
  if (!key) return fallback;
  if (key.startsWith('errors:')) return key;
  if (key.startsWith('errors.')) return `errors:${key.slice('errors.'.length)}`;
  return key;
}