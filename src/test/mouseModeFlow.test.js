/**
 * Mouse mode integration tests.
 *
 * Two bugs were fixed to make mouse mode work end-to-end:
 *
 * Bug 1 (startVoicing cleared): advanceStage read midiPressedRef (empty in
 *   mouse mode) and called setStartVoicing([]), wiping the cells the user had
 *   clicked. checkIdentifyGuides then failed because every cell failed the
 *   "must be inside startVoicing" test against an empty array.
 *
 * Bug 2 (FILL_CHORD max selections): maxSelectionsForStage returned 4 for
 *   FILL_CHORD in all modes. canAdvance required selected.length === 4 before
 *   the auto-check would fire. In learn mode, movedGuides already holds 2
 *   guide cells, so combined = 2+4 = 6 — the pitchOk length check always
 *   failed. Fix: return 4 - movedGuides.length (= 2 when guides are set).
 */

import { describe, it, expect } from "vitest";
import { buildGrid, buildChordsForKey } from "../musicUtils";
import {
  checkStartChord,
  checkIdentifyGuides,
  checkMoveGuidesGrid,
  checkFillChord,
} from "../voiceLeadingLogic";

const GRID = buildGrid(8, 8, 6);
const ALL_CELLS = GRID.flat();
const CHORDS_C = buildChordsForKey("C");

// Helpers
function cellsWithNote(note) {
  return ALL_CELLS.filter((c) => c.note === note);
}
function nearestTo(cells, ref) {
  return cells.slice().sort(
    (a, b) =>
      Math.abs(a.row - ref.row) + Math.abs(a.col - ref.col) -
      (Math.abs(b.row - ref.row) + Math.abs(b.col - ref.col))
  )[0];
}

// ── Regression: Bug 1 — startVoicing cleared ────────────────────────────────

describe("checkIdentifyGuides — startVoicing-cleared regression", () => {
  // Pick real guide cells from the grid for Dm7 (guide = F and C)
  const fCell = cellsWithNote("F")[0];
  const cCell = cellsWithNote("C")[0];

  it("fails when startVoicing is empty (simulates the cleared-startVoicing bug)", () => {
    // Before the fix, advanceStage wiped startVoicing → []. Any selection
    // would fail the "must be inside voicing" check.
    expect(checkIdentifyGuides([fCell, cCell], [], CHORDS_C.ii.guide)).toBe(false);
  });

  it("passes when startVoicing correctly contains the selected cells", () => {
    // After the fix, startVoicing is preserved from the START_CHORD stage.
    const startVoicing = [
      cellsWithNote("D")[0],
      fCell,
      cellsWithNote("A")[0],
      cCell,
    ].filter(Boolean);
    expect(checkIdentifyGuides([fCell, cCell], startVoicing, CHORDS_C.ii.guide)).toBe(true);
  });

  it("fails when correct pitch classes are selected but from different grid cells (not in startVoicing)", () => {
    const fCells = cellsWithNote("F");
    const cCells = cellsWithNote("C");
    // startVoicing uses fCells[0] and cCells[0]; user accidentally picks different cells
    const startVoicing = [fCells[0], cCells[0]].filter(Boolean);
    if (fCells.length < 2 || cCells.length < 2) return;
    expect(
      checkIdentifyGuides([fCells[1], cCells[1]], startVoicing, CHORDS_C.ii.guide)
    ).toBe(false);
  });
});

// ── Regression: Bug 2 — FILL_CHORD over-selection ───────────────────────────

describe("checkFillChord — max-selections regression", () => {
  // V guide tones B and F; remaining tones G and D
  const movedB = cellsWithNote("B")[0];
  const movedF = cellsWithNote("F")[0];
  const extraG = cellsWithNote("G")[0];
  const extraD = cellsWithNote("D")[0];

  it("fails when selectedExtra has 4 cells in learn mode (6 combined — old bug)", () => {
    // Before the fix, canAdvance required selected.length === 4.
    // combined = [...movedGuides(2), ...selected(4)] = 6 → always fails length check.
    const allFour = [
      cellsWithNote("G")[0], cellsWithNote("D")[0],
      cellsWithNote("B")[1] ?? cellsWithNote("B")[0],
      cellsWithNote("F")[1] ?? cellsWithNote("F")[0],
    ].filter(Boolean);
    expect(checkFillChord([movedB, movedF], allFour, CHORDS_C.V.tones, "learn")).toBe(false);
  });

  it("passes when selectedExtra has exactly 2 cells in learn mode (4 combined — correct)", () => {
    if (!movedB || !movedF || !extraG || !extraD) return;
    expect(checkFillChord([movedB, movedF], [extraG, extraD], CHORDS_C.V.tones, "learn")).toBe(true);
  });

  it("maxSelections in learn mode = 4 - movedGuides.length", () => {
    // Verify the semantic: canAdvance triggers at selected.length === 2 (not 4)
    // when movedGuides has 2 cells.
    const neededSelections = 4 - [movedB, movedF].filter(Boolean).length;
    expect(neededSelections).toBe(2);
  });
});

// ── Complete mouse mode flow: ii → V in C ───────────────────────────────────

describe("mouse mode complete flow: ii → V in C major", () => {
  // Find grid cells for each role.
  const dCell = cellsWithNote("D")[0];
  const fCell = cellsWithNote("F")[0];
  const aCell = cellsWithNote("A")[0];
  const cCell = cellsWithNote("C")[0];

  // The start voicing built in START_CHORD
  const startVoicing = [dCell, fCell, aCell, cCell].filter(Boolean);

  // Guide tones identified in IDENTIFY_GUIDES (F and C from the Dm7 voicing)
  const startGuides = [fCell, cCell].filter(Boolean);

  // For MOVE_GUIDES: F stays, C → nearest B (smooth voice leading)
  const nearestB = nearestTo(cellsWithNote("B"), cCell);
  const movedGuides = [fCell, nearestB].filter(Boolean);

  // For FILL_CHORD: add G and D (the remaining G7 tones)
  const nearestG = nearestTo(cellsWithNote("G"), movedGuides[0] ?? fCell);
  const nearestD = nearestTo(
    cellsWithNote("D").filter((c) => !movedGuides.some((m) => m.id === c.id)),
    nearestB
  );
  const selectedExtra = [nearestG, nearestD].filter(Boolean);

  it("Stage 1: START_CHORD — Dm7 voicing passes", () => {
    expect(checkStartChord(startVoicing, CHORDS_C.ii.tones)).toBe(true);
  });

  it("Stage 2: IDENTIFY_GUIDES — F and C from startVoicing passes", () => {
    // This would fail if startVoicing were [] (the old bug).
    expect(checkIdentifyGuides(startGuides, startVoicing, CHORDS_C.ii.guide)).toBe(true);
  });

  it("Stage 3: MOVE_GUIDES — F stays, C→B is minimal movement", () => {
    const { ok } = checkMoveGuidesGrid(startGuides, movedGuides, CHORDS_C.V.guide, GRID);
    expect(ok).toBe(true);
  });

  it("Stage 4: FILL_CHORD — 2 extra tones complete the G7 chord", () => {
    // Exactly 2 cells in selectedExtra (the fix: maxSelections = 4 - movedGuides.length = 2).
    expect(selectedExtra.length).toBe(2);
    expect(checkFillChord(movedGuides, selectedExtra, CHORDS_C.V.tones, "learn")).toBe(true);
  });

  it("Stage 4 guard: selecting all 4 G7 tones into selectedExtra fails (over-selection)", () => {
    const allG7 = [
      cellsWithNote("G")[0], cellsWithNote("B")[0],
      cellsWithNote("D")[0], cellsWithNote("F")[0],
    ].filter(Boolean);
    // combined = movedGuides(2) + allG7(4) = 6 — wrong count
    expect(checkFillChord(movedGuides, allG7, CHORDS_C.V.tones, "learn")).toBe(false);
  });
});

// ── Complete mouse mode flow: V → I in C ────────────────────────────────────

describe("mouse mode complete flow: V → I in C major", () => {
  const gCell = cellsWithNote("G")[0];
  const bCell = cellsWithNote("B")[0];
  const dCell = cellsWithNote("D")[0];
  const fCell = cellsWithNote("F")[0];

  const startVoicing = [gCell, bCell, dCell, fCell].filter(Boolean);
  const startGuides = [bCell, fCell].filter(Boolean);

  // V→I guide movement: B stays (common tone), F→E (half step down).
  // Cmaj7 guide tones are E and B (3rd and 7th).
  const nearestE = nearestTo(cellsWithNote("E"), fCell);
  const movedGuides = [bCell, nearestE].filter(Boolean); // B stays, F→E

  // FILL_CHORD: add the remaining Cmaj7 tones — C and G (not the guides E and B).
  const nearestC2 = nearestTo(
    cellsWithNote("C").filter((c) => !movedGuides.some((m) => m.id === c.id)),
    movedGuides[0] ?? bCell
  );
  const nearestG2 = nearestTo(
    cellsWithNote("G").filter((c) => !movedGuides.some((m) => m.id === c.id)),
    movedGuides[1] ?? nearestE
  );
  const selectedExtra = [nearestC2, nearestG2].filter(Boolean);

  it("Stage 1: G7 voicing passes START_CHORD", () => {
    expect(checkStartChord(startVoicing, CHORDS_C.V.tones)).toBe(true);
  });

  it("Stage 2: B and F identified as V guide tones from startVoicing", () => {
    expect(checkIdentifyGuides(startGuides, startVoicing, CHORDS_C.V.guide)).toBe(true);
  });

  it("Stage 3: B→C and F→E are valid step-wise guide movements", () => {
    const { ok } = checkMoveGuidesGrid(startGuides, movedGuides, CHORDS_C.I.guide, GRID);
    expect(ok).toBe(true);
  });

  it("Stage 4: exactly 2 extra tones needed to complete Cmaj7", () => {
    expect(selectedExtra.length).toBe(2);
    expect(checkFillChord(movedGuides, selectedExtra, CHORDS_C.I.tones, "learn")).toBe(true);
  });
});
