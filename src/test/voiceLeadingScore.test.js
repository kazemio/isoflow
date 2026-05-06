import { describe, it, expect } from "vitest";
import {
  scoreVoiceLeadingTransition,
  calculateDistance,
  generateCandidates,
  getGuideTones,
} from "../voiceLeadingScore";

// Pitch classes for ii–V–I in C major
// Dm7: D(2) F(5) A(9) C(0)
// G7:  G(7) B(11) D(2) F(5)
// Cmaj7: C(0) E(4) G(7) B(11)
const DM7_PC = [2, 5, 9, 0];
const G7_PC  = [7, 11, 2, 5];
const CMAJ7_PC = [0, 4, 7, 11];

// Typical close-position voicing for Dm7 (MIDI)
const DM7_MIDI  = [62, 65, 69, 72]; // D4 F4 A4 C5
// Close G7 voicing from Dm7=[62,65,69,72]: D4 stays, F4 stays, A4→G4, C5→B4
// D4(62) F4(65) G4(67) B4(71) — total movement = 0+0+2+1 = 3
// PCs: 2,5,7,11 sorted = 2,5,7,11 ✓
const G7_MIDI_CLOSE = [62, 65, 67, 71];

// Wide G7 voicing: G2(43) B3(59) D5(74) F5(77) — spread of 34 semitones
// PCs: 7,11,2,5 sorted = 2,5,7,11 ✓
const G7_MIDI_WIDE = [43, 59, 74, 77];

describe("scoreVoiceLeadingTransition", () => {
  describe("correct chord with minimal motion", () => {
    it("grade is minimal or close when movement is tight", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toMatch(/^(minimal|close)$/);
      expect(result.excessDistance).toBeGreaterThanOrEqual(0);
    });

    it("excessDistance is 0 for an optimal voicing", () => {
      // Score an arrangement against itself — should be 0 excess
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, DM7_MIDI, DM7_PC, DM7_PC, DM7_PC
      );
      expect(result.grade).toBe("minimal");
      expect(result.excessDistance).toBe(0);
    });
  });

  describe("correct chord with wide motion", () => {
    it("grade is wide when voicing jumps far", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_WIDE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toBe("wide");
      expect(result.excessDistance).toBeGreaterThan(2);
    });

    it("userDistance > optimalDistance for wide voicing", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_WIDE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.userDistance).toBeGreaterThan(result.optimalDistance ?? 0);
    });
  });

  describe("wrong chord", () => {
    it("returns grade=incorrect when pitch classes don't match target", () => {
      const wrongMidi = [60, 64, 67, 71]; // Cmaj7, not G7
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, wrongMidi, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toBe("incorrect");
    });

    it("message includes 'not the target chord' for wrong chord", () => {
      const wrongMidi = [60, 64, 67, 71];
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, wrongMidi, G7_PC, DM7_PC, G7_PC
      );
      expect(result.message).toMatch(/not the target/i);
    });
  });

  describe("wide-voicing crash guard", () => {
    it("does not crash when source voicing spans > 24 semitones", () => {
      // Extremely wide: C2(36) to C6(84) — 48 semitones
      const wideSource = [36, 48, 72, 84];
      expect(() => {
        scoreVoiceLeadingTransition(wideSource, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC);
      }).not.toThrow();
    });

    it("returns a result object even for wide source voicing", () => {
      const wideSource = [30, 50, 70, 90];
      const result = scoreVoiceLeadingTransition(wideSource, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC);
      expect(result).toHaveProperty("grade");
      expect(result).toHaveProperty("userDistance");
    });
  });
});

// ── calculateDistance ────────────────────────────────────────────────────────

describe("calculateDistance", () => {
  it("returns 0 total when source equals target", () => {
    const { total, maxJump } = calculateDistance([60, 64, 67, 71], [60, 64, 67, 71]);
    expect(total).toBe(0);
    expect(maxJump).toBe(0);
  });

  it("finds the minimal-total assignment across all permutations", () => {
    // Source: D4(62) F4(65) A4(69) C5(72) — Dm7
    // Target: G3(55) B3(59) D4(62) F4(65) — G7 close voicing
    // Best: 62→62(0) 65→65(0) 69→59(10) 72→55(17) = 27 — or better?
    // 62→62(0) 65→65(0) 69→55(14) 72→59(13) = 27
    // Actually optimal is 62→62(0) 65→65(0) 69→67(2) 72→71(1) = 3 but 67,71 not in target
    // With target [55,59,62,65]: best is 62→62(0), 65→65(0), 69→55(14), 72→59(13) = 27
    // or 62→62(0), 65→59(6), 69→65(4), 72→55(17) = 27
    const { total } = calculateDistance([62, 65, 69, 72], [55, 59, 62, 65]);
    expect(total).toBeLessThanOrEqual(27);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it("returns total that is less than or equal to naive sequential assignment", () => {
    const source = [60, 64, 67, 71];
    const target = [62, 65, 69, 72];
    const { total: optimal } = calculateDistance(source, target);
    // Naive sequential: |60-62|+|64-65|+|67-69|+|71-72| = 2+1+2+1 = 6
    const naiveTotal = source.reduce((s, n, i) => s + Math.abs(n - target[i]), 0);
    expect(optimal).toBeLessThanOrEqual(naiveTotal);
  });

  it("tracks maxJump separately from total", () => {
    // One voice moves 7, others stay
    const { total, maxJump } = calculateDistance([60, 64, 67, 71], [60, 64, 67, 78]);
    expect(maxJump).toBe(7);
    expect(total).toBe(7);
  });

  it("works with 1-element arrays", () => {
    const { total, maxJump } = calculateDistance([60], [64]);
    expect(total).toBe(4);
    expect(maxJump).toBe(4);
  });
});

// ── generateCandidates ───────────────────────────────────────────────────────

describe("generateCandidates", () => {
  it("generates MIDI notes for each pitch class in the range", () => {
    // G7 pitch classes [7,11,2,5] in range 55–79
    const candidates = generateCandidates([7, 11, 2, 5], 55, 79);
    expect(candidates.length).toBeGreaterThan(0);
    // Every candidate must have exactly 4 notes
    for (const c of candidates) {
      expect(c.length).toBe(4);
    }
  });

  it("all notes in each candidate are within the given range", () => {
    const candidates = generateCandidates([0, 4, 7, 11], 48, 72);
    for (const c of candidates) {
      for (const n of c) {
        expect(n).toBeGreaterThanOrEqual(48);
        expect(n).toBeLessThanOrEqual(72);
      }
    }
  });

  it("each candidate's notes match the requested pitch classes", () => {
    const pcs = [2, 5, 7, 11]; // D F G B
    const candidates = generateCandidates(pcs, 48, 72);
    for (const c of candidates) {
      const candidatePCs = c.map((n) => ((n % 12) + 12) % 12).sort((a, b) => a - b);
      const expectedPCs = [...pcs].sort((a, b) => a - b);
      expect(candidatePCs).toEqual(expectedPCs);
    }
  });

  it("candidates are deduplicated (no repeated note values within one candidate)", () => {
    const candidates = generateCandidates([0, 4, 7, 11], 48, 72);
    for (const c of candidates) {
      expect(new Set(c).size).toBe(c.length);
    }
  });

  it("candidates are sorted ascending", () => {
    const candidates = generateCandidates([0, 4, 7, 11], 48, 72);
    for (const c of candidates) {
      for (let i = 1; i < c.length; i++) {
        expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      }
    }
  });

  it("returns empty array when range contains no notes for a pitch class", () => {
    // Only 1 note range — can't fit 4 distinct pitch classes
    const candidates = generateCandidates([0, 4, 7, 11], 60, 60);
    expect(candidates).toEqual([]);
  });

  it("24-semitone cap produces a manageable number of candidates", () => {
    const sourceMid = 67;
    const rangeMin = Math.round(sourceMid - 12);
    const rangeMax = Math.round(sourceMid + 12);
    const candidates = generateCandidates([7, 11, 2, 5], rangeMin, rangeMax);
    // Should be a small finite count, not thousands
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(200);
  });
});

// ── getGuideTones ────────────────────────────────────────────────────────────

describe("getGuideTones", () => {
  // Dm7: [root=D(2), 3rd=F(5), 5th=A(9), 7th=C(0)] — guide tones are F and C
  const DM7_PCS = [2, 5, 9, 0];

  it("extracts the 3rd (index 1) and 7th (index 3) for Dm7", () => {
    // D4(62) F4(65) A4(69) C5(72)
    const guides = getGuideTones([62, 65, 69, 72], DM7_PCS);
    expect(guides).toContain(65); // F4 — 3rd ✓
    expect(guides).toContain(72); // C5 — 7th ✓
    expect(guides).not.toContain(62); // D is root
    expect(guides).not.toContain(69); // A is 5th
  });

  it("returns exactly 2 guide tones from a standard 4-note voicing", () => {
    const guides = getGuideTones([62, 65, 69, 72], DM7_PCS);
    expect(guides.length).toBe(2);
  });

  it("returns empty array when voicing has no F (5) or C (0)", () => {
    // D4(62) G4(67) A4(69) B4(71) — pcs [2,7,9,11], no 5 or 0
    const guides = getGuideTones([62, 67, 69, 71], DM7_PCS);
    expect(guides).toEqual([]);
  });

  it("works for G7: 3rd=B(11), 7th=F(5)", () => {
    // G7_PCS = [root=G(7), 3rd=B(11), 5th=D(2), 7th=F(5)]
    const G7_PCS = [7, 11, 2, 5];
    // G3(55) B3(59) D4(62) F4(65)
    const guides = getGuideTones([55, 59, 62, 65], G7_PCS);
    expect(guides).toContain(59); // B3 — 3rd ✓
    expect(guides).toContain(65); // F4 — 7th ✓
    expect(guides).not.toContain(62); // D is 5th
    expect(guides.length).toBe(2);
  });

  it("collects all occurrences when multiple notes share a guide pitch class", () => {
    // F3(53) A4(69) C5(72) F5(77) — two F notes (3rd) and one C (7th)
    const guides = getGuideTones([53, 69, 72, 77], DM7_PCS);
    expect(guides).toContain(53);  // F3 — 3rd
    expect(guides).toContain(72);  // C5 — 7th
    expect(guides).toContain(77);  // F5 — 3rd
    expect(guides).not.toContain(69); // A is 5th
  });
});
