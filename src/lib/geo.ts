import geoipCountry from 'geoip-country';

/**
 * Resolve the ISO-3166-1 alpha-2 country code associated with an IP address.
 *
 * Behavior:
 * - Returns `null` for `null`, `undefined`, or empty-string input.
 * - Strips bracket characters used to delimit IPv6 literals (e.g. `[::1]` → `::1`).
 * - Normalizes IPv4-mapped IPv6 addresses (`::ffff:8.8.8.8` → `8.8.8.8`).
 * - Any thrown error from the underlying lookup is swallowed and `null` is
 *   returned so that the call site (redirect handler) never crashes.
 * - Returns the 2-letter country code in upper case, or `null` if the address
 *   is local/unknown.
 */
export function getCountryFromIP(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined || ip === '') {
    return null;
  }

  let normalized = ip.trim();
  if (normalized === '') {
    return null;
  }

  // Strip IPv6 literal brackets: "[::1]" -> "::1"
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  // Strip IPv4-mapped IPv6 prefix: "::ffff:8.8.8.8" -> "8.8.8.8"
  const ipv4MappedPrefix = '::ffff:';
  if (normalized.toLowerCase().startsWith(ipv4MappedPrefix)) {
    normalized = normalized.slice(ipv4MappedPrefix.length);
  }

  try {
    const result = geoipCountry.lookup(normalized);
    if (result === null || result === undefined) {
      return null;
    }
    return result.country ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert an ISO-3166-1 alpha-2 country code into a Regional Indicator
 * flag emoji followed by the uppercase code.
 *
 * Behavior:
 * - Returns `"-"` for `null`, `undefined`, or empty-string input.
 * - Normalizes the input to upper case before validating.
 * - Validates exactly two ASCII letters (`A`-`Z`); returns `"-"` otherwise
 *   (this also handles the `"-"` placeholder from upstream callers).
 * - On success returns `${flag} ${upperCaseCode}` where the flag is built
 *   from Regional Indicator Symbol codepoints (base `0x1F1E6`).
 *
 * Example: `"AR"` -> `"🇦🇷 AR"`, `"br"` -> `"🇧🇷 BR"`.
 */
export function countryCodeToFlag(code: string | null | undefined): string {
  if (code === null || code === undefined) {
    return '-';
  }

  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) {
    return '-';
  }

  const first = 0x1f1e6 + (upper.charCodeAt(0) - 0x41);
  const second = 0x1f1e6 + (upper.charCodeAt(1) - 0x41);
  const flag = String.fromCodePoint(first, second);
  return `${flag} ${upper}`;
}
