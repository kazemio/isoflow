import { distance } from "./musicUtils";

// Branch 1: piano view — exact MIDI-number lookup in PIANO_CELLS
export function resolveMidiCellPiano(noteNumber, pianoCells) {
  return pianoCells.find((c) => c.midi === noteNumber) ?? null;
}

// Branch 2: octave-mapping mode — pick the grid cell whose estimated MIDI
// (pitchClass + midiOffset) is closest to the actual MIDI note number.
export function resolveMidiCellOctave(noteNumber, gridCells, midiOffset) {
  if (gridCells.length === 0) return null;
  return gridCells
    .map((c) => ({ c, diff: Math.abs((c.pitchClass + midiOffset) - noteNumber) }))
    .sort((a, b) => a.diff - b.diff)[0].c;
}

// Branch 3: proximity mode — pick the grid cell closest (by distance) to the
// anchor point. anchor must be { row, col } — pass the grid centre when no
// anchor is established yet.
export function resolveMidiCellProximity(noteNumber, gridCells, anchor) {
  if (gridCells.length === 0) return null;
  return gridCells
    .map((c) => ({ c, d: distance(anchor, c) }))
    .sort((a, b) => a.d - b.d)[0].c;
}

// Main resolution: mirrors App.jsx resolveMidiCell exactly, but takes all
// dependencies as explicit parameters so it can be called from tests.
// NOTE: does NOT set the anchor as a side effect — the caller (App.jsx) is
// responsible for initialising registerAnchorRef on first use.
export function resolveMidiCell(noteNumber, { viewMode, pianoCells, grid, useOctaveMapping, midiOffset, anchor }) {
  if (viewMode === "piano") {
    const pianoCell = resolveMidiCellPiano(noteNumber, pianoCells);
    if (pianoCell) return pianoCell;
  }

  const pitchClass = ((noteNumber % 12) + 12) % 12;
  const gridCells = grid.flat().filter((c) => ((c.pitchClass % 12) + 12) % 12 === pitchClass);
  if (gridCells.length === 0) return null;

  if (useOctaveMapping) {
    return resolveMidiCellOctave(noteNumber, gridCells, midiOffset);
  }

  const target = anchor ?? { row: (grid.length - 1) / 2, col: (grid[0].length - 1) / 2 };
  return resolveMidiCellProximity(noteNumber, gridCells, target);
}
