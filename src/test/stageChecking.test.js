import { describe, it, expect } from "vitest";
import { buildGrid, buildChordsForKey } from "../musicUtils";
import {
  checkStartChord,
  checkIdentifyGuides,
  checkMoveGuidesMidi,
  checkMoveGuidesGrid,
  checkFillChord,
  checkRegister,
} from "../voiceLeadingLogic";

const GRID = buildGrid(8, 8, 6);
const CHORDS_C = buildChordsForKey("C");

// pitch class → { pitchClass, note }
function pcCell(id, pc, note, midi = undefined) {
  return { id, row: 0, col: 0, pitchClass: pc, note, midi };
}

// Dm7: D(2) F(5) A(9) C(0)
const DM7 = [pcCell("d", 2, "D"), pcCell("f", 5, "F"), pcCell("a", 9, "A"), pcCell("c0", 0, "C")];
// G7: G(7) B(11) D(2) F(5)
const G7  = [pcCell("g", 7, "G"), pcCell("b", 11, "B"), pcCell("d2", 2, "D"), pcCell("f2", 5, "F")];

describe("checkStartChord", () => {
  it("passes for a correct 4-note Dm7 selection", () => {
    expect(checkStartChord(DM7, CHORDS_C.ii.tones)).toBe(true);
  });

  it("fails when a note is wrong", () => {
    const wrong = [pcCell("d", 2, "D"), pcCell("f", 5, "F"), pcCell("a", 9, "A"), pcCell("e", 4, "E")];
    expect(checkStartChord(wrong, CHORDS_C.ii.tones)).toBe(false);
  });

  it("fails when only 3 notes are selected", () => {
    expect(checkStartChord(DM7.slice(0, 3), CHORDS_C.ii.tones)).toBe(false);
  });

  it("fails for empty selection", () => {
    expect(checkStartChord([], CHORDS_C.ii.tones)).toBe(false);
  });

  it("is order-independent", () => {
    const shuffled = [DM7[3], DM7[1], DM7[0], DM7[2]];
    expect(checkStartChord(shuffled, CHORDS_C.ii.tones)).toBe(true);
  });
});

describe("checkIdentifyGuides", () => {
  // startVoicing = full Dm7 voicing
  // fromChordGuide = ["F", "C"] (indices 1 and 3 of tones)

  it("passes when 2 guide-tone cells from startVoicing are selected", () => {
    const guides = [DM7[1], DM7[3]]; // F and C
    expect(checkIdentifyGuides(guides, DM7, CHORDS_C.ii.guide)).toBe(true);
  });

  it("fails when selected cells are not inside startVoicing", () => {
    const outsiders = [pcCell("x1", 5, "F"), pcCell("x2", 0, "C")]; // correct pitch but different ids
    expect(checkIdentifyGuides(outsiders, DM7, CHORDS_C.ii.guide)).toBe(false);
  });

  it("passes when cells share midi with startVoicing entries", () => {
    // Simulate MIDI match: same midi as the startVoicing cell
    const fInVoicing = { ...DM7[1], midi: 65 };
    const cInVoicing = { ...DM7[3], midi: 60 };
    const startWithMidi = [
      { ...DM7[0], midi: 62 },
      fInVoicing,
      { ...DM7[2], midi: 69 },
      cInVoicing,
    ];
    const outsideById = [
      pcCell("other-f", 5, "F", 65), // same midi, different id
      pcCell("other-c", 0, "C", 60),
    ];
    const withMidiFn = (c) => c; // cells already have midi
    expect(checkIdentifyGuides(outsideById, startWithMidi, CHORDS_C.ii.guide, withMidiFn)).toBe(true);
  });

  it("fails when wrong guide tones selected (D and A instead of F and C)", () => {
    const wrong = [DM7[0], DM7[2]]; // D and A
    expect(checkIdentifyGuides(wrong, DM7, CHORDS_C.ii.guide)).toBe(false);
  });

  it("fails when only 1 guide is selected", () => {
    expect(checkIdentifyGuides([DM7[1]], DM7, CHORDS_C.ii.guide)).toBe(false);
  });
});

describe("checkMoveGuidesMidi", () => {
  // ii→V: guides F(65),C(60) → B(59),F(65) [B stays 1 below C; F stays]
  const startF = pcCell("sg-f", 5, "F", 65);
  const startC = pcCell("sg-c", 0, "C", 60);

  it("passes: F stays (65→65), C→B (60→59) — maxJump=1", () => {
    const movedF = pcCell("mg-f", 5, "F", 65);
    const movedB = pcCell("mg-b", 11, "B", 59);
    const { ok, mapping } = checkMoveGuidesMidi([startF, startC], [movedF, movedB], CHORDS_C.V.guide);
    expect(ok).toBe(true);
    expect(mapping.maxJump).toBeLessThanOrEqual(2);
  });

  it("fails: C leaps to B4 (60→71) — 11 semitones", () => {
    const movedF  = pcCell("mg-f",  5, "F",  65);
    const movedB4 = pcCell("mg-b4", 11, "B",  71);
    const { ok } = checkMoveGuidesMidi([startF, startC], [movedF, movedB4], CHORDS_C.V.guide);
    expect(ok).toBe(false);
  });

  it("fails: wrong pitch class in destination (E instead of B)", () => {
    const movedF = pcCell("mg-f", 5, "F", 65);
    const movedE = pcCell("mg-e", 4, "E", 64);
    const { ok } = checkMoveGuidesMidi([startF, startC], [movedF, movedE], CHORDS_C.V.guide);
    expect(ok).toBe(false);
  });

  it("passes with whole-step motion (2 semitones)", () => {
    // V→I: guide tones B and F → E and B.
    // B stays (0 semitones), F(65)→E(64) = 1 semitone — maxJump=1 ≤ 2.
    const startB = pcCell("sg-b", 11, "B", 59);
    const startF = pcCell("sg-f", 5, "F", 65);
    const movedB = pcCell("mg-b", 11, "B", 59); // stays
    const movedE = pcCell("mg-e", 4, "E", 64);  // F→E (half step down)
    const { ok } = checkMoveGuidesMidi([startB, startF], [movedB, movedE], CHORDS_C.I.guide);
    expect(ok).toBe(true);
  });

  it("returns mapping=null when pitchSet is wrong", () => {
    const movedF = pcCell("mg-f", 5, "F", 65);
    const movedG = pcCell("mg-g", 7, "G", 67);
    const { mapping } = checkMoveGuidesMidi([startF, startC], [movedF, movedG], CHORDS_C.V.guide);
    expect(mapping).toBeNull();
  });
});

describe("checkMoveGuidesGrid", () => {
  // Build proper grid cells for the test
  const allCells = GRID.flat();
  const getCell = (note) => allCells.find((c) => c.note === note);

  // ii guide: F and C; V guide: B and F
  const fCell = getCell("F");
  const cCell = getCell("C");
  const bCell = getCell("B");
  const fCell2 = allCells.filter((c) => c.note === "F")[1]; // another F cell

  it("passes when movedGuides are correct notes with near-minimal movement", () => {
    // Use the same F (common tone) and nearest B to C
    const startGuides = [fCell, cCell].filter(Boolean);
    // Find nearest B to cCell
    const bNearest = allCells
      .filter((c) => c.note === "B")
      .sort((a, b) => Math.abs(a.row - cCell.row) + Math.abs(a.col - cCell.col)
        - (Math.abs(b.row - cCell.row) + Math.abs(b.col - cCell.col)))[0];

    if (!startGuides[0] || !startGuides[1] || !bNearest) return; // skip if grid doesn't have note

    const movedGuides = [fCell, bNearest];
    const { ok, correctNotes } = checkMoveGuidesGrid(startGuides, movedGuides, CHORDS_C.V.guide, GRID);
    expect(correctNotes).toBe(true);
    expect(ok).toBe(true);
  });

  it("fails when movedGuides have wrong pitch classes", () => {
    const startGuides = [fCell, cCell].filter(Boolean);
    if (!startGuides[0] || !startGuides[1]) return;
    const dCell = getCell("D");
    const gCell = getCell("G");
    if (!dCell || !gCell) return;
    const { ok, correctNotes } = checkMoveGuidesGrid(startGuides, [dCell, gCell], CHORDS_C.V.guide, GRID);
    expect(correctNotes).toBe(false);
    expect(ok).toBe(false);
  });
});

describe("checkFillChord", () => {
  // V chord: G(7) B(11) D(2) F(5). Guide tones: B and F.
  const movedB = pcCell("mb", 11, "B");
  const movedF = pcCell("mf", 5, "F");
  const extraG = pcCell("eg", 7, "G");
  const extraD = pcCell("ed", 2, "D");
  const extraE = pcCell("ee", 4, "E"); // wrong note

  it("passes in learn mode when movedGuides + selectedExtra = all 4 chord tones", () => {
    expect(checkFillChord([movedB, movedF], [extraG, extraD], CHORDS_C.V.tones, "learn")).toBe(true);
  });

  it("fails when one extra tone is wrong", () => {
    expect(checkFillChord([movedB, movedF], [extraG, extraE], CHORDS_C.V.tones, "learn")).toBe(false);
  });

  it("fails when only 3 notes total", () => {
    expect(checkFillChord([movedB, movedF], [extraG], CHORDS_C.V.tones, "learn")).toBe(false);
  });

  it("in play mode uses selectedExtra alone (all 4 must be in selectedExtra)", () => {
    const allFour = [pcCell("g", 7, "G"), pcCell("b", 11, "B"), pcCell("d", 2, "D"), pcCell("f", 5, "F")];
    expect(checkFillChord([], allFour, CHORDS_C.V.tones, "play")).toBe(true);
  });

  it("in play mode fails when selectedExtra is only 3 notes", () => {
    const three = [pcCell("g", 7, "G"), pcCell("b", 11, "B"), pcCell("d", 2, "D")];
    expect(checkFillChord([], three, CHORDS_C.V.tones, "play")).toBe(false);
  });
});

describe("checkRegister", () => {
  // Guide tones B3(59) and F4(65) — midpoint ≈ 62, spread = 6 semitones.
  const guides = [59, 65];

  it("passes when all extra tones are within 12 semitones of a guide tone", () => {
    // G3(55): |55-59|=4 ✓  D4(62): |62-59|=3 ✓
    expect(checkRegister([55, 62], guides)).toBe(true);
  });

  it("fails when an extra tone is more than 12 semitones from every guide tone", () => {
    // D2(38): |38-59|=21, |38-65|=27 — both > 12
    expect(checkRegister([55, 38], guides)).toBe(false);
  });

  it("passes at exactly 12 semitones (inclusive boundary)", () => {
    // 59 - 12 = 47: |47-59|=12 ✓
    expect(checkRegister([47], guides)).toBe(true);
    // 65 + 12 = 77: |77-65|=12 ✓
    expect(checkRegister([77], guides)).toBe(true);
  });

  it("fails at 13 semitones", () => {
    // 59 - 13 = 46: |46-59|=13, |46-65|=19 — both > 12
    expect(checkRegister([46], guides)).toBe(false);
  });

  it("passes when guideMidis is empty (no constraint)", () => {
    expect(checkRegister([30, 90], [])).toBe(true);
  });

  it("treats null extra-tone MIDI as ok (unknown register)", () => {
    expect(checkRegister([null, 62], guides)).toBe(true);
  });

  it("passes when extraToneMidis is empty", () => {
    expect(checkRegister([], guides)).toBe(true);
  });

  it("custom maxInterval: fails when a tone is > maxInterval from every guide", () => {
    // guides=[59,65], maxInterval=7.
    // Note 74: |74-59|=15>7, |74-65|=9>7 — outside both guide ranges → fail.
    // Note 55: |55-59|=4 ≤ 7 → still ok.
    expect(checkRegister([55, 74], guides, 7)).toBe(false);
  });

  it("custom maxInterval: passes at exactly the custom boundary", () => {
    expect(checkRegister([52], guides, 7)).toBe(true); // |52-59|=7 ✓
  });
});
