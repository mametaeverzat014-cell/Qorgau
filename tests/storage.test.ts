import { describe, expect, it } from 'vitest';
import { sanitizeIdList, sanitizeProfile, sanitizeTaskMap } from '@/lib/storage';
import { EMPTY_PROFILE } from '@/lib/demo';
import { getRecommendations } from '@/lib/engine/score';
import { COUNTRIES, MAJORS } from '@/lib/types';

/**
 * Persisted state is untrusted input: user-editable, long-lived, and possibly
 * written by an older build. A measured browser sweep found seven of eight
 * corruption cases crashing the app before these validators existed.
 */

describe('sanitizeProfile survives arbitrary input', () => {
  const garbage: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'hello'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
    ['an empty object', {}],
    ['nested nulls', { preferences: null, preferredCountries: null, gpaValue: null }],
    ['wrong types throughout', {
      name: 123,
      budgetAnnualUSD: 'lots',
      preferredCountries: 'USA',
      preferences: 'high',
      satScore: 'perfect',
      completedAt: 99,
    }],
    ['NaN and Infinity', { budgetAnnualUSD: NaN, maxAffordableAnnualUSD: Infinity, gpaValue: NaN }],
    ['out-of-range numbers', { satScore: 99999, englishScore: -5, gpaValue: 1e9, graduationYear: 12 }],
    ['unknown enum values', { intendedMajor: 'underwater-basket-weaving', aidNeed: 'magic', gpaScale: 'xyz' }],
    ['unknown countries', { preferredCountries: ['Atlantis', 'USA', 'Narnia'] }],
    ['prototype pollution attempt', JSON.parse('{"__proto__":{"polluted":true},"name":"x"}')],
    ['enormous strings', { name: 'x'.repeat(10000), currentCountry: 'y'.repeat(10000) }],
  ];

  for (const [label, input] of garbage) {
    it(`handles ${label}`, () => {
      const p = sanitizeProfile(input);

      // Shape the engine depends on.
      expect(Array.isArray(p.preferredCountries)).toBe(true);
      expect(typeof p.preferences.research).toBe('number');
      expect(Number.isFinite(p.budgetAnnualUSD)).toBe(true);
      expect(Number.isFinite(p.maxAffordableAnnualUSD)).toBe(true);
      expect(MAJORS).toContain(p.intendedMajor);
      expect(typeof p.openToAnyCountry).toBe('boolean');
      for (const c of p.preferredCountries) expect(COUNTRIES).toContain(c);

      // And it must actually be scoreable, not merely well-shaped.
      const set = getRecommendations(p);
      expect(set.results.length).toBeGreaterThanOrEqual(3);
      for (const r of set.results) expect(Number.isFinite(r.score)).toBe(true);
    });
  }

  it('never lets the ceiling fall below the comfortable budget', () => {
    const p = sanitizeProfile({ budgetAnnualUSD: 40000, maxAffordableAnnualUSD: 1000 });
    expect(p.maxAffordableAnnualUSD).toBeGreaterThanOrEqual(p.budgetAnnualUSD);
  });

  it('repairs a contradictory country selection', () => {
    const contradiction = sanitizeProfile({ preferredCountries: ['USA'], openToAnyCountry: true });
    expect(contradiction.openToAnyCountry).toBe(false);

    const empty = sanitizeProfile({ preferredCountries: [], openToAnyCountry: false });
    expect(empty.openToAnyCountry).toBe(true);
  });

  it('drops unknown countries but keeps the valid ones', () => {
    const p = sanitizeProfile({ preferredCountries: ['Atlantis', 'USA', 'Narnia', 'Japan'] });
    expect(p.preferredCountries).toEqual(['USA', 'Japan']);
  });

  it('preserves a genuinely valid profile unchanged in substance', () => {
    const valid = { ...EMPTY_PROFILE, name: 'Aizhan', budgetAnnualUSD: 12000, maxAffordableAnnualUSD: 15000 };
    const p = sanitizeProfile(valid);
    expect(p.name).toBe('Aizhan');
    expect(p.budgetAnnualUSD).toBe(12000);
    expect(p.maxAffordableAnnualUSD).toBe(15000);
  });

  it('does not pollute Object.prototype', () => {
    sanitizeProfile(JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('sanitizeTaskMap', () => {
  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'x', 42, [1, 2, 3]]) {
      expect(sanitizeTaskMap(bad)).toEqual({});
    }
  });

  it('keeps only genuine completions', () => {
    expect(sanitizeTaskMap({ a: true, b: false, c: 'yes', d: 1, e: null })).toEqual({ a: true });
  });
});

describe('sanitizeIdList', () => {
  it('rejects non-arrays', () => {
    for (const bad of [null, undefined, {}, 'abc', 42]) {
      expect(sanitizeIdList(bad)).toEqual([]);
    }
  });

  it('keeps only url-safe ids, deduplicated and capped', () => {
    expect(sanitizeIdList(['hku', 'hku', 'mit', 42, null, '../etc/passwd', '<script>'])).toEqual([
      'hku',
      'mit',
    ]);
    expect(sanitizeIdList(['a', 'b', 'c', 'd', 'e'], 4)).toHaveLength(4);
  });
});
