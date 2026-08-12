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
