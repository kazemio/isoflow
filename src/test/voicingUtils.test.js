import { describe, it, expect } from "vitest";
import { detectWiderVoicing, shouldShowVoicingHint } from "../voicingUtils";

// Minimal cell factory. midi is required for distance() to work accurately.
function cell(id, midi) {
  return { id, midi, row: 0, col: 0, note: "C", pitchClass: midi };
}

// ── detectWiderVoicing ───────────────────────────────────────────────────────

describe("detectWiderVoicing", () => {
  // startVoicing: root(C3=48) + 3rd(E3=52) + 5th(G3=55) + 7th(B3=59)
  // startGuides (3rd + 7th): E3=52, B3=59
  // startNonGuides (root + 5th): C3=48, G3=55

  const c3 = cell("c3", 48);
  const e3 = cell("e3", 52);
  const g3 = cell("g3", 55);
  const b3 = cell("b3", 59);

  const startVoicing = [c3, e3, g3, b3];
  const startGuides  = [e3, b3];

  it("returns false when non-guide tones stay put (common tones)", () => {
    expect(detectWiderVoicing(startVoicing, startGuides, [c3, g3])).toBe(false);
  });

  it("returns false when non-guide tones move by a step or less", () => {
    const c3b = cell("c3b", 49); // C#3 — one semitone up
    const g3b = cell("g3b", 57); // A3  — two semitones up
    expect(detectWiderVoicing(startVoicing, startGuides, [c3b, g3b])).toBe(false);
  });

  it("returns false when non-guide tones move up to 11 semitones (sub-register)", () => {
    // 11 semitones is a large interval but not a full register — should not flag.
    const f3 = cell("f3", 53);   // F3 — 5 semitones from C3
    const eb4 = cell("eb4", 63); // Eb4 — 8 semitones from G3
    expect(detectWiderVoicing(startVoicing, startGuides, [f3, eb4])).toBe(false);
  });

  it("returns true when a non-guide tone drops exactly one register (12 semitones)", () => {
    const c2 = cell("c2", 36); // C2 — one octave below C3
    expect(detectWiderVoicing(startVoicing, startGuides, [c2, g3])).toBe(true);
  });

  it("returns true when both non-guide tones drop a register", () => {
    const c2 = cell("c2", 36); // C2 — octave below C3
    const g2 = cell("g2", 43); // G2 — octave below G3
    expect(detectWiderVoicing(startVoicing, startGuides, [c2, g2])).toBe(true);
  });

  it("returns true when both non-guide tones rise a register", () => {
    // Both leap 12 — even optimal voice crossing produces maxJump >= 12.
    const c4 = cell("c4", 60); // C4 — octave above C3
    const g4 = cell("g4", 67); // G4 — octave above G3
    expect(detectWiderVoicing(startVoicing, startGuides, [c4, g4])).toBe(true);
  });

  it("returns true when one non-guide tone drops a register, the other stays", () => {
    // C3→C2 (12 down), G3→G3 (0). Crossing alt (G3→C2=19) costs more,
    // so bestMapping picks literal. maxJump = 12 >= 12 → wider.
    const c2 = cell("c2", 36);
    expect(detectWiderVoicing(startVoicing, startGuides, [c2, g3])).toBe(true);
  });

  it("returns false when one voice rises a register while the other stays (voices converge)", () => {
    // C3(48)+G3(55) → G3(55)+C4(60): bestMapping picks crossing C3→G3(7)+G3→C4(5).
    // maxJump = 7, under the 12-semitone register threshold → smooth.
    const c4 = cell("c4", 60);
    expect(detectWiderVoicing(startVoicing, startGuides, [c4, g3])).toBe(false);
  });

  it("returns false when maintaining a previously wide voicing (smooth continuation)", () => {
    // Simulate: first round used C2/G2 (wide). Next round, move by step from there.
    const c2 = cell("c2", 36);
    const g2 = cell("g2", 43);
    const prevWideVoicing = [c2, e3, g2, b3];  // wide non-guides: c2, g2
    const prevGuides = [e3, b3];

    // Next non-guides: move by a semitone each — smooth from wide position
    const c2b = cell("c2b", 37);  // C#2 — one step from C2
    const ab2 = cell("ab2", 44);  // Ab2 — one step from G2
    expect(detectWiderVoicing(prevWideVoicing, prevGuides, [c2b, ab2])).toBe(false);
  });

  it("returns false when startVoicing has fewer than 4 cells (guard)", () => {
    expect(detectWiderVoicing([c3, e3], startGuides, [c3, g3])).toBe(false);
  });

  it("returns false when newNonGuides has fewer than 2 cells (guard)", () => {
    const c2 = cell("c2", 36);
    expect(detectWiderVoicing(startVoicing, startGuides, [c2])).toBe(false);
  });

  it("uses optimal voice pairing — picks the assignment with least total motion", () => {
    // C3(48) and G3(55) start. Destination: Db3(49) and Ab3(56).
    // Correct pairing: C3→Db3 (1), G3→Ab3 (1). maxJump = 1.
    // Wrong pairing: C3→Ab3 (8), G3→Db3 (6). maxJump = 8.
    // bestMapping should pick the correct one → not wider.
    const db3 = cell("db3", 49);
    const ab3 = cell("ab3", 56);
    expect(detectWiderVoicing(startVoicing, startGuides, [db3, ab3])).toBe(false);
  });
});

// ── shouldShowVoicingHint ────────────────────────────────────────────────────

describe("shouldShowVoicingHint", () => {
  const c3 = cell("c3", 48);
  const e3 = cell("e3", 52);
  const g3 = cell("g3", 55);
  const b3 = cell("b3", 59);

  const startVoicing = [c3, e3, g3, b3];
  const startGuides  = [e3, b3];
  const movedGuides  = [];

  // ── IDENTIFY_GUIDES stage ──────────────────────────────────────────────────

  it("shows hint for a voicing cell that is not yet selected during IDENTIFY_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ false, /*isMovedGuide*/ false
    )).toBe(true);
  });

  it("hides hint for a voicing cell that IS selected during IDENTIFY_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ true, /*isMovedGuide*/ false
    )).toBe(false);
  });

  it("hides hint for a cell NOT in the starting voicing during IDENTIFY_GUIDES", () => {
    const outsider = cell("x", 60);
    expect(shouldShowVoicingHint(
      outsider, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(false);
  });

  // ── MOVE_GUIDES stage ──────────────────────────────────────────────────────

  it("shows hint for an unresolved source guide tone during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(true);
  });

  it("hides hint for a guide tone that has been moved (is a movedGuide)", () => {
    const movedE3 = cell("e3-moved", 51); // landed on Eb3
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, [movedE3],
      false, /*isMovedGuide*/ true
    )).toBe(false);
  });

  it("hides hint for a guide tone that is currently selected during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ true, false
    )).toBe(false);
  });

  it("hides hint for a non-guide cell during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(false);
  });

  // ── Other stages ──────────────────────────────────────────────────────────

  it("never shows hint during START_CHORD", () => {
    expect(shouldShowVoicingHint(
      c3, "START_CHORD", startVoicing, startGuides, movedGuides, false, false
    )).toBe(false);
  });

  it("never shows hint during FILL_CHORD", () => {
    expect(shouldShowVoicingHint(
      e3, "FILL_CHORD", startVoicing, startGuides, movedGuides, false, false
    )).toBe(false);
  });
});
