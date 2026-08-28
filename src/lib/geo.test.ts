import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countryCodeToFlag } from './geo.js';

describe('countryCodeToFlag', () => {
  it('renders the Argentina flag emoji followed by the uppercase code', () => {
    assert.equal(countryCodeToFlag('AR'), '🇦🇷 AR');
  });

  it('renders the United States flag emoji followed by the uppercase code', () => {
    assert.equal(countryCodeToFlag('US'), '🇺🇸 US');
  });

  it('normalizes lowercase input to uppercase', () => {
    assert.equal(countryCodeToFlag('br'), '🇧🇷 BR');
  });

  it('returns "-" for null', () => {
    assert.equal(countryCodeToFlag(null), '-');
  });

  it('returns "-" for undefined', () => {
    assert.equal(countryCodeToFlag(undefined), '-');
  });

  it('returns "-" for invalid codes', () => {
    assert.equal(countryCodeToFlag('X1'), '-');
  });

  it('returns "-" for an empty string', () => {
    assert.equal(countryCodeToFlag(''), '-');
  });
});
