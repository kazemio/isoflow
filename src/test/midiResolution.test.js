import { describe, it, expect } from "vitest";
import {
  resolveMidiCellPiano,
  resolveMidiCellOctave,
  resolveMidiCellProximity,
  resolveMidiCell,
} from "../midiResolution";
import { buildGrid, buildPianoCells, MIDI_OFFSET, PIANO_MIDI_START } from "../musicUtils";

const GRID = buildGrid(8, 8, 6);
const PIANO_CELLS = buildPianoCells();

// ── resolveMidiCellPiano ─────────────────────────────────────────────────────

describe("resolveMidiCellPiano", () => {
  it("returns the piano cell with the matching MIDI number", () => {
    const cell = resolveMidiCellPiano(60, PIANO_CELLS); // C4
    expect(cell).not.toBeNull();
    expect(cell.midi).toBe(60);
    expect(cell.id).toBe("piano-60");
  });

  it("returns the first piano cell (C3, MIDI 48)", () => {
    const cell = resolveMidiCellPiano(PIANO_MIDI_START, PIANO_CELLS);
    expect(cell.midi).toBe(PIANO_MIDI_START);
    expect(cell.note).toBe("C");
  });

  it("returns null when MIDI number is outside piano range", () => {
    expect(resolveMidiCellPiano(20, PIANO_CELLS)).toBeNull();  // below range
    expect(resolveMidiCellPiano(100, PIANO_CELLS)).toBeNull(); // above range
  });

  it("returns null for empty piano cells array", () => {
    expect(resolveMidiCellPiano(60, [])).toBeNull();
  });
});

// ── resolveMidiCellOctave ────────────────────────────────────────────────────

describe("resolveMidiCellOctave", () => {
  const ALL_GRID_CELLS = GRID.flat();

  it("returns the cell whose pitchClass + midiOffset is closest to the note", () => {
    // LinnStrument: MIDI_OFFSET = 24. A cell with pitchClass = 6 (Gb) estimates midi = 30.
    // MIDI note 30 should resolve to a Gb cell (pitchClass 6).
    const gbCells = ALL_GRID_CELLS.filter((c) => ((c.pitchClass % 12) + 12) % 12 === 6);
    const cell = resolveMidiCellOctave(30, gbCells, MIDI_OFFSET);
    expect(cell).not.toBeNull();
    expect(((cell.pitchClass % 12) + 12) % 12).toBe(6); // Gb pitch class
  });

  it("picks the closest-octave cell when multiple candidates share pitch class", () => {
    // Pick F cells (pitchClass 5). Estimated MIDI = pitchClass + 24 varies per row.
    const fCells = ALL_GRID_CELLS.filter((c) => ((c.pitchClass % 12) + 12) % 12 === 5);
    expect(fCells.length).toBeGreaterThan(1); // multiple F cells exist
    const target = fCells[0].pitchClass + MIDI_OFFSET; // exact match for first cell
    const resolved = resolveMidiCellOctave(target, fCells, MIDI_OFFSET);
    expect(resolved.id).toBe(fCells[0].id);
  });

  it("returns null for an empty cell list", () => {
    expect(resolveMidiCellOctave(60, [], MIDI_OFFSET)).toBeNull();
  });
});

// ── resolveMidiCellProximity ─────────────────────────────────────────────────

describe("resolveMidiCellProximity", () => {
  const ALL_GRID_CELLS = GRID.flat();

  it("returns the cell closest to the anchor", () => {
    const anchor = { row: 7, col: 0 }; // bottom-left corner
    const bCells = ALL_GRID_CELLS.filter((c) => ((c.pitchClass % 12) + 12) % 12 === 11); // B cells
    const resolved = resolveMidiCellProximity(59, bCells, anchor);
    // The nearest B to the bottom-left is the one with the lowest row+col distance
    const expected = bCells.slice().sort(
      (a, b) =>
        Math.abs(a.row - anchor.row) + Math.abs(a.col - anchor.col) -
        (Math.abs(b.row - anchor.row) + Math.abs(b.col - anchor.col))
    )[0];
    expect(resolved.id).toBe(expected.id);
  });

  it("returns the cell closest to the grid centre when anchor is the centre", () => {
    const centre = { row: 3.5, col: 3.5 }; // 8x8 centre
    const cCells = ALL_GRID_CELLS.filter((c) => ((c.pitchClass % 12) + 12) % 12 === 0); // C cells
    const resolved = resolveMidiCellProximity(60, cCells, centre);
    expect(resolved).not.toBeNull();
    // Resolved cell should be closer to centre than any other C cell
    const dist = (cell) =>
      Math.abs(cell.row - centre.row) + Math.abs(cell.col - centre.col);
    for (const c of cCells) {
      expect(dist(resolved)).toBeLessThanOrEqual(dist(c));
    }
  });

  it("returns null for an empty cell list", () => {
    expect(resolveMidiCellProximity(60, [], { row: 4, col: 4 })).toBeNull();
  });
});

// ── resolveMidiCell (main entry) ─────────────────────────────────────────────

describe("resolveMidiCell", () => {
  const opts = (overrides) => ({
    viewMode: "grid",
    pianoCells: PIANO_CELLS,
    grid: GRID,
    useOctaveMapping: false,
    midiOffset: MIDI_OFFSET,
    anchor: null,
    ...overrides,
  });

  describe("piano mode", () => {
    it("returns the matching piano cell by exact MIDI number", () => {
      const cell = resolveMidiCell(60, opts({ viewMode: "piano" }));
      expect(cell?.midi).toBe(60);
      expect(cell?.id).toBe("piano-60");
    });

    it("falls through to grid resolution when MIDI is outside piano range", () => {
      // MIDI 20 has no piano cell; should fall through to grid
      const cell = resolveMidiCell(20, opts({ viewMode: "piano" }));
      // pitch class of 20 = 8 (Ab). Grid has Ab cells.
      expect(cell).not.toBeNull();
      expect(((cell.pitchClass % 12) + 12) % 12).toBe(8);
    });
  });

  describe("octave mapping mode", () => {
    it("uses pitchClass + midiOffset proximity", () => {
      const cell = resolveMidiCell(30, opts({ useOctaveMapping: true }));
      // MIDI 30 → pitchClass 6 (Gb). Closest grid cell by offset estimate.
      expect(cell).not.toBeNull();
      expect(((cell.pitchClass % 12) + 12) % 12).toBe(6);
    });
  });

  describe("proximity mode (training mode)", () => {
    it("with no anchor, resolves to the cell nearest the grid centre", () => {
      const cell = resolveMidiCell(60, opts({ anchor: null })); // C, no anchor
      expect(cell).not.toBeNull();
      expect(((cell.pitchClass % 12) + 12) % 12).toBe(0); // C pitch class
    });

    it("with an anchor, resolves to the cell nearest that anchor", () => {
      const anchor = GRID[7][0]; // bottom-left cell
      const cell = resolveMidiCell(60, opts({ anchor }));
      // Should pick the C cell nearest the bottom-left
      const cCells = GRID.flat().filter((c) => ((c.pitchClass % 12) + 12) % 12 === 0);
      const nearest = cCells.slice().sort(
        (a, b) =>
          Math.abs(a.row - anchor.row) + Math.abs(a.col - anchor.col) -
          (Math.abs(b.row - anchor.row) + Math.abs(b.col - anchor.col))
      )[0];
      expect(cell?.id).toBe(nearest.id);
    });

    it("returns null when pitch class has no match on the grid", () => {
      // Build a 1x1 grid with only Gb (pitchClass 6)
      const tinyGrid = [[{ id: "0-0", row: 0, col: 0, pitchClass: 6, note: "Gb" }]];
      const cell = resolveMidiCell(60, opts({ grid: tinyGrid, anchor: null })); // C has no cell
      expect(cell).toBeNull();
    });
  });

  describe("note number edge cases", () => {
    it("handles MIDI 0 (C-1)", () => {
      const cell = resolveMidiCell(0, opts());
      if (cell) expect(((cell.pitchClass % 12) + 12) % 12).toBe(0);
    });

    it("handles MIDI 127 (G9)", () => {
      const cell = resolveMidiCell(127, opts());
      if (cell) expect(((cell.pitchClass % 12) + 12) % 12).toBe(7);
    });
  });
});
