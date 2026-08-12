import test from 'node:test';
import assert from 'node:assert/strict';
import geoipCountry from 'geoip-country';
import { getCountryFromIP } from '../src/lib/geo.js';

test('getCountryFromIP returns country code for a known public IPv4', () => {
  assert.equal(getCountryFromIP('8.8.8.8'), 'US');
});

test('getCountryFromIP returns null for a private/loopback IPv4', () => {
  assert.equal(getCountryFromIP('127.0.0.1'), null);
});

test('getCountryFromIP returns null for null input', () => {
  assert.equal(getCountryFromIP(null), null);
});

test('getCountryFromIP returns null for undefined input', () => {
  assert.equal(getCountryFromIP(undefined), null);
});

test('getCountryFromIP returns null for empty string', () => {
  assert.equal(getCountryFromIP(''), null);
});

test('getCountryFromIP returns null for whitespace-only string', () => {
  assert.equal(getCountryFromIP('   '), null);
});

test('getCountryFromIP resolves IPv4-mapped IPv6 address', () => {
  assert.equal(getCountryFromIP('::ffff:8.8.8.8'), 'US');
});

test('getCountryFromIP resolves IPv4-mapped IPv6 with mixed-case prefix', () => {
  assert.equal(getCountryFromIP('::FFFF:8.8.8.8'), 'US');
});

test('getCountryFromIP returns null for IPv6 loopback without brackets', () => {
  assert.equal(getCountryFromIP('::1'), null);
});

test('getCountryFromIP returns null for IPv6 loopback with brackets', () => {
  assert.equal(getCountryFromIP('[::1]'), null);
});

test('getCountryFromIP returns null for invalid IP string', () => {
  assert.equal(getCountryFromIP('not-a-valid-ip-address'), null);
});

test('getCountryFromIP returns null when lookup throws an error', () => {
  // Force the underlying lookup to throw, simulating a malformed IP that
  // bypasses the library's soft validation. Our helper must catch and
  // return null so the request handler never crashes.
  const original = geoipCountry.lookup;
  geoipCountry.lookup = () => {
    throw new Error('simulated lookup failure');
  };
  try {
    assert.equal(getCountryFromIP('8.8.8.8'), null);
    assert.equal(getCountryFromIP('::ffff:8.8.8.8'), null);
    assert.equal(getCountryFromIP('[2001:4860:4860::8888]'), null);
  } finally {
    geoipCountry.lookup = original;
  }
});
