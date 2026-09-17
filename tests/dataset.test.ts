import { describe, expect, it } from 'vitest';
import { UNIVERSITIES, UNIVERSITY_BY_ID, getUniversity } from '@/data/universities';
import { COUNTRIES, MAJORS, REGIONS, type Confidence } from '@/lib/types';

/**
 * Dataset quality assurance.
 *
 * The recommendation engine is only as trustworthy as the records it scores, so
 * these assertions guard the data rather than the logic. They exist because this
 * dataset has already shipped two accuracy defects: URLs invented from memory
 * that 404'd in production, and a full-ride flag broad enough to tell a student
 * with no money that a competitive scholarship was equivalent to a need-met
 * guarantee.
 */

const CONFIDENCES: Confidence[] = ['curated', 'estimated', 'unverified'];

describe('Dataset integrity', () => {
  it('has a meaningful number of records', () => {
    expect(UNIVERSITIES.length).toBeGreaterThanOrEqual(20);
    expect(UNIVERSITY_BY_ID.size).toBe(UNIVERSITIES.length);
  });

  it('gives every university a unique, resolvable, url-safe id', () => {
    const seen = new Set<string>();
    for (const u of UNIVERSITIES) {
      expect(seen.has(u.id), `duplicate id ${u.id}`).toBe(false);
      seen.add(u.id);
      expect(u.id).toMatch(/^[a-z0-9-]+$/);
      expect(getUniversity(u.id)?.id).toBe(u.id);
    }
  });

  it('never ships two records for the same institution', () => {
    const names = UNIVERSITIES.map((u) => u.name.toLowerCase().trim());
    expect(new Set(names).size, 'duplicate university name').toBe(names.length);
    const shorts = UNIVERSITIES.map((u) => u.shortName.toLowerCase().trim());
    expect(new Set(shorts).size, 'duplicate short name').toBe(shorts.length);
  });

  it('fills every required descriptive field', () => {
    for (const u of UNIVERSITIES) {
      expect(u.name.length, u.id).toBeGreaterThan(2);
      expect(u.shortName.length, u.id).toBeGreaterThan(1);
      expect(u.city.length, u.id).toBeGreaterThan(1);
      expect(COUNTRIES, u.id).toContain(u.country);
      expect(REGIONS, u.id).toContain(u.region);
      expect(u.languagesOfInstruction.length, u.id).toBeGreaterThan(0);
      expect(u.programs.length, u.id).toBeGreaterThan(0);
      expect(u.supportedMajors.length, u.id).toBeGreaterThan(0);
      expect(u.highlights.length, u.id).toBeGreaterThan(0);
      expect(u.aidNote.length, u.id).toBeGreaterThan(20);
      expect(u.selectivityNote.length, u.id).toBeGreaterThan(10);
      expect(u.applicationPlatform.length, u.id).toBeGreaterThan(2);
    }
  });

  it('only references majors the engine knows about', () => {
    for (const u of UNIVERSITIES) {
      for (const m of u.supportedMajors) {
        expect(MAJORS, `${u.id} lists unknown major ${m}`).toContain(m);
      }
      expect(new Set(u.supportedMajors).size, `${u.id} repeats a major`).toBe(u.supportedMajors.length);
    }
  });
});

describe('Dataset provenance', () => {
  it('records where every class of fact came from, and when', () => {
    for (const u of UNIVERSITIES) {
      const p = u.provenance;
      expect(p, u.id).toBeTruthy();
      expect(p.compiledOn, u.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(p.compiledOn)), u.id).toBe(false);
      for (const key of ['requirements', 'costs', 'deadlines', 'aid'] as const) {
        expect(CONFIDENCES, `${u.id}.provenance.${key}`).toContain(p[key]);
      }
    }
  });

  it('labels our own cost figures as estimates, never as institutional fact', () => {
    for (const u of UNIVERSITIES) {
      expect(u.provenance.costs, u.id).toBe('estimated');
      expect(u.estimatedTuition.confidence, u.id).toBe('estimated');
      expect(u.estimatedLivingCost.confidence, u.id).toBe('estimated');
    }
  });

  it('keeps unverified values null instead of silently coercing them to zero', () => {
    for (const u of UNIVERSITIES) {
      for (const [field, money] of [
        ['estimatedTuition', u.estimatedTuition],
        ['estimatedLivingCost', u.estimatedLivingCost],
      ] as const) {
        if (money.confidence === 'unverified') {
          expect(money.value, `${u.id}.${field} claims unverified but carries a number`).toBeNull();
        }
      }
      // A genuine zero must be deliberate, and every deliberate zero is explained.
      if (u.estimatedTuition.value === 0) {
        expect(u.estimatedTuition.note, `${u.id} has $0 tuition with no explanation`).toBeTruthy();
      }
    }
  });
});

describe('Dataset numeric sanity', () => {
  it('has no impossible or negative money', () => {
    for (const u of UNIVERSITIES) {
      for (const [field, money] of [
        ['tuition', u.estimatedTuition],
        ['living', u.estimatedLivingCost],
      ] as const) {
        if (money.value === null) continue;
        expect(Number.isFinite(money.value), `${u.id}.${field}`).toBe(true);
        expect(money.value, `${u.id}.${field} is negative`).toBeGreaterThanOrEqual(0);
        expect(money.value, `${u.id}.${field} is implausibly large`).toBeLessThan(150_000);
      }
    }
  });

  it('keeps test thresholds inside the real score ranges', () => {
    for (const u of UNIVERSITIES) {
      for (const [field, v] of [
        ['minimumIELTS', u.minimumIELTS],
        ['recommendedIELTS', u.recommendedIELTS],
      ] as const) {
        if (v === null) continue;
        expect(v, `${u.id}.${field}`).toBeGreaterThanOrEqual(4);
        expect(v, `${u.id}.${field}`).toBeLessThanOrEqual(9);
        expect(v * 2, `${u.id}.${field} is not a valid half-band`).toBe(Math.round(v * 2));
      }
      if (u.minimumTOEFL !== null) {
        expect(u.minimumTOEFL, u.id).toBeGreaterThanOrEqual(30);
        expect(u.minimumTOEFL, u.id).toBeLessThanOrEqual(120);
      }
      for (const [field, v] of [
        ['minimumSAT', u.minimumSAT],
        ['recommendedSAT', u.recommendedSAT],
      ] as const) {
        if (v === null) continue;
        expect(v, `${u.id}.${field}`).toBeGreaterThanOrEqual(400);
        expect(v, `${u.id}.${field}`).toBeLessThanOrEqual(1600);
      }
      expect(u.gpaExpectation, u.id).toBeGreaterThan(50);
      expect(u.gpaExpectation, u.id).toBeLessThanOrEqual(100);
      expect(u.researchIntensity, u.id).toBeGreaterThanOrEqual(1);
      expect(u.researchIntensity, u.id).toBeLessThanOrEqual(5);
      expect(u.prestigeTier, u.id).toBeGreaterThanOrEqual(1);
      expect(u.prestigeTier, u.id).toBeLessThanOrEqual(5);
    }
  });

  it('never sets a minimum above its own recommended threshold', () => {
    for (const u of UNIVERSITIES) {
      if (u.minimumIELTS !== null && u.recommendedIELTS !== null) {
        expect(u.minimumIELTS, `${u.id} minimum IELTS exceeds recommended`).toBeLessThanOrEqual(
          u.recommendedIELTS,
        );
      }
      if (u.minimumSAT !== null && u.recommendedSAT !== null) {
        expect(u.minimumSAT, `${u.id} minimum SAT exceeds recommended`).toBeLessThanOrEqual(
          u.recommendedSAT,
        );
      }
    }
  });

  it('uses valid, future-dated deadlines for the current cycle', () => {
    for (const u of UNIVERSITIES) {
      for (const [field, d] of [
        ['applicationDeadline', u.applicationDeadline],
        ['scholarshipDeadline', u.scholarshipDeadline],
      ] as const) {
        if (d === null) continue;
        expect(d, `${u.id}.${field}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(d)), `${u.id}.${field} is not a real date`).toBe(false);
        // The dataset targets the 2026-27 cycle; anything outside it is stale.
        expect(d >= '2026-09-01', `${u.id}.${field} predates this cycle`).toBe(true);
        expect(d <= '2027-12-31', `${u.id}.${field} is beyond this cycle`).toBe(true);
      }
    }
  });
});

describe('Aid claims are internally consistent', () => {
  it('assigns every university an aid certainty', () => {
    for (const u of UNIVERSITIES) {
      expect(
        ['meets-full-need', 'structural', 'competitive', 'minimal'],
        `${u.id} has no aid certainty`,
      ).toContain(u.aidCertainty);
    }
  });

  it('never claims a full ride without also allowing full tuition', () => {
    for (const u of UNIVERSITIES) {
      if (u.fullRidePossible) {
        expect(u.fullTuitionPossible, `${u.id} covers full cost but not full tuition`).toBe(true);
      }
    }
  });

  it('does not pair a full-cost claim with minimal published aid', () => {
    for (const u of UNIVERSITIES) {
      if (u.aidCertainty === 'minimal') {
        expect(
          u.fullRidePossible,
          `${u.id} claims a full ride while publishing minimal aid for internationals`,
        ).not.toBe(true);
      }
    }
  });

  it('reserves need-met status for institutions that also offer need-based aid', () => {
    for (const u of UNIVERSITIES) {
      if (u.aidCertainty === 'meets-full-need') {
        expect(u.needBasedAidForInternationals, `${u.id}`).toBe(true);
        expect(u.fullRidePossible, `${u.id}`).toBe(true);
      }
    }
  });

  it('keeps scholarship availability consistent with aid certainty', () => {
    for (const u of UNIVERSITIES) {
      if (u.scholarshipAvailability === 'rare-for-international') {
        expect(u.fullRidePossible, `${u.id}`).not.toBe(true);
      }
    }
  });
});
