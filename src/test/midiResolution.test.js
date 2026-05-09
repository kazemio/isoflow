import { describe, it, expect } from "vitest";
import {
  resolveMidiCellPiano,
  resolveMidiCellOctave,
  resolveMidiCellProximity,
  resolveMidiCell,
} from "../midiResolution";
import { buildGrid, buildPianoCells, PIANO_MIDI_START } from "../musicUtils";

const GRID = buildGrid(8, 8);
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

  it("returns the cell whose intrinsic MIDI is closest to the played note", () => {
    // Bottom-left cell has midi 30 (Gb-1). MIDI note 30 should resolve to it.
    const gbCells = ALL_GRID_CELLS.filter((c) => c.pitchClass === 6);
    const cell = resolveMidiCellOctave(30, gbCells);
    expect(cell).not.toBeNull();
    expect(cell.pitchClass).toBe(6);
  });

  it("picks the closest-octave cell when multiple candidates share pitch class", () => {
    const fCells = ALL_GRID_CELLS.filter((c) => c.pitchClass === 5);
    expect(fCells.length).toBeGreaterThan(1);
    const resolved = resolveMidiCellOctave(fCells[0].midi, fCells);
    expect(resolved.id).toBe(fCells[0].id);
  });

  it("returns null for an empty cell list", () => {
    expect(resolveMidiCellOctave(60, [])).toBeNull();
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
      // MIDI 20 has no piano cell; should fall through to grid (pc 8 = Ab).
      const cell = resolveMidiCell(20, opts({ viewMode: "piano" }));
      expect(cell).not.toBeNull();
      expect(cell.pitchClass).toBe(8);
    });
  });

  describe("octave mapping mode", () => {
    it("picks the grid cell whose intrinsic MIDI is closest to the played note", () => {
      const cell = resolveMidiCell(30, opts({ useOctaveMapping: true }));
      expect(cell).not.toBeNull();
      expect(cell.pitchClass).toBe(6); // Gb
    });
  });

  describe("proximity mode (training mode)", () => {
    it("with no anchor, resolves to the cell nearest the grid centre", () => {
      const cell = resolveMidiCell(60, opts({ anchor: null }));
      expect(cell).not.toBeNull();
      expect(cell.pitchClass).toBe(0); // C
    });

    it("with an anchor, resolves to the cell nearest that anchor", () => {
      const anchor = GRID[7][0];
      const cell = resolveMidiCell(60, opts({ anchor }));
      const cCells = GRID.flat().filter((c) => c.pitchClass === 0);
      const nearest = cCells.slice().sort(
        (a, b) =>
          Math.abs(a.row - anchor.row) + Math.abs(a.col - anchor.col) -
          (Math.abs(b.row - anchor.row) + Math.abs(b.col - anchor.col))
      )[0];
      expect(cell?.id).toBe(nearest.id);
    });

    it("returns null when pitch class has no match on the grid", () => {
      const tinyGrid = [[{ id: "0-0", row: 0, col: 0, midi: 30, pitchClass: 6, note: "Gb" }]];
      const cell = resolveMidiCell(60, opts({ grid: tinyGrid, anchor: null }));
      expect(cell).toBeNull();
    });
  });

  describe("note number edge cases", () => {
    it("handles MIDI 0 (C-1)", () => {
      const cell = resolveMidiCell(0, opts());
      if (cell) expect(cell.pitchClass).toBe(0);
    });

    it("handles MIDI 127 (G9)", () => {
      const cell = resolveMidiCell(127, opts());
      if (cell) expect(cell.pitchClass).toBe(7);
    });
  });
});
