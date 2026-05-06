export const NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const DEGREE_FORMULAS = {
  I:   { intervals: [0, 4, 7, 11], guideDegrees: [1, 3] },
  ii:  { intervals: [2, 5, 9, 0],  guideDegrees: [1, 3] },
  iii: { intervals: [4, 7, 11, 2], guideDegrees: [1, 3] },
  IV:  { intervals: [5, 9, 0, 4],  guideDegrees: [1, 3] },
  V:   { intervals: [7, 11, 2, 5], guideDegrees: [1, 3] },
  vi:  { intervals: [9, 0, 4, 7],  guideDegrees: [1, 3] },
  vii: { intervals: [11, 2, 5, 9], guideDegrees: [1, 3] },
};

export const PROGRESSION_OPTIONS = {
  "ii–V–I":   ["ii", "V", "I"],
  "vi–IV–V–I": ["vi", "IV", "V", "I"],
  "I–vi–IV–V": ["I", "vi", "IV", "V"],
  "I–IV–V–I":  ["I", "IV", "V", "I"],
};

export const STAGES = [
  { key: "START_CHORD",    title: "Build starting chord." },
  { key: "IDENTIFY_GUIDES", title: "Identify guide tones." },
  { key: "MOVE_GUIDES",    title: "Move guide tones." },
  { key: "FILL_CHORD",     title: "Fill destination chord." },
];

// LinnStrument 200 default base note
export const MIDI_BASE_NOTE = 30;
export const MIDI_OFFSET = MIDI_BASE_NOTE - 6; // grid startNote=6

export const PIANO_MIDI_START = 48;
export const PIANO_MIDI_END   = 84;
export const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

// ── Note helpers ────────────────────────────────────────────────────────────

export function normalizeNote(index) {
  return NOTES[((index % 12) + 12) % 12];
}

export function noteIndex(note) {
  return NOTES.indexOf(note);
}

export function transposeNote(note, semitones) {
  return normalizeNote(noteIndex(note) + semitones);
}

export function getChordName(symbol, tones) {
  const root = tones[0];
  if (symbol === "I" || symbol === "IV") return root + "maj7";
  if (symbol === "V") return root + "7";
  if (symbol === "ii" || symbol === "iii" || symbol === "vi") return root + "m7";
  if (symbol === "vii") return root + "m7b5";
  return root;
}

export function buildChordsForKey(key) {
  const rootOffset = noteIndex(key);
  return Object.fromEntries(
    Object.entries(DEGREE_FORMULAS).map(([symbol, formula]) => {
      const tones = formula.intervals.map((interval) => normalizeNote(rootOffset + interval));
      const guide = formula.guideDegrees.map((index) => tones[index]);
      return [symbol, { tones, guide }];
    })
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────

export function buildGrid(rows = 6, cols = 12, startNote = 6) {
  const grid = [];
  for (let visualRow = 0; visualRow < rows; visualRow++) {
    const rowOffset = (rows - 1 - visualRow) * 5;
    const cells = [];
    for (let col = 0; col < cols; col++) {
      const pitchClass = col + rowOffset + startNote;
      cells.push({
        id: `${visualRow}-${col}`,
        row: visualRow,
        col,
        pitchClass,
        note: normalizeNote(pitchClass),
      });
    }
    grid.push(cells);
  }
  return grid;
}

// ── Piano ───────────────────────────────────────────────────────────────────

export function buildPianoKeys() {
  const keys = [];
  let whiteIndex = 0;
  for (let midi = PIANO_MIDI_START; midi <= PIANO_MIDI_END; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    const isBlack = BLACK_PCS.has(pc);
    keys.push({ midi, pc, note: NOTES[pc], isBlack, whiteIndex: isBlack ? null : whiteIndex });
    if (!isBlack) whiteIndex++;
  }
  return keys;
}

export const PIANO_KEYS = buildPianoKeys();

export function buildPianoCells() {
  return PIANO_KEYS.map((k) => ({
    id: `piano-${k.midi}`,
    row: 0,
    col: k.midi - PIANO_MIDI_START,
    pitchClass: k.pc,
    note: k.note,
    midi: k.midi,
  }));
}

export const PIANO_CELLS = buildPianoCells();

export function getPrevWhiteIndex(blackKey) {
  const whites = PIANO_KEYS.filter((k) => !k.isBlack && k.midi < blackKey.midi);
  return whites[whites.length - 1]?.whiteIndex ?? 0;
}

// ── Misc utilities ───────────────────────────────────────────────────────────

export function uniqueNotesFromCells(cells) {
  return [...new Set(cells.map((c) => c.note))];
}

export function parseProgression(text, chords) {
  const tokens = text
    .replaceAll("–", " ")
    .replaceAll("-", " ")
    .replaceAll("→", " ")
    .replaceAll(",", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const valid = tokens.filter((token) => chords[token]);
  return valid.length >= 2 ? valid : null;
}

export function generateRandomProgression() {
  const transitions = {
    I:   [["ii", 3], ["IV", 3], ["V", 4], ["vi", 3], ["iii", 1]],
    ii:  [["V", 5], ["IV", 2], ["vii", 2]],
    iii: [["vi", 4], ["IV", 2], ["I", 1]],
    IV:  [["V", 4], ["ii", 3], ["I", 2], ["vii", 1]],
    V:   [["I", 5], ["vi", 3]],
    vi:  [["ii", 4], ["IV", 3], ["V", 2]],
    vii: [["I", 5], ["iii", 2]],
  };
  function pick(weighted) {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of weighted) { r -= w; if (r <= 0) return v; }
    return weighted[0][0];
  }
  const len = 3 + Math.floor(Math.random() * 8);
  const result = [pick([["I", 3], ["vi", 2], ["ii", 2], ["IV", 1]])];
  for (let i = 1; i < len; i++) {
    const opts = transitions[result[result.length - 1]];
    if (!opts) break;
    result.push(pick(opts));
  }
  return result.join(" ");
}

// ── Pitch / voice-leading helpers ────────────────────────────────────────────

export function samePitchSet(cells, targetNotes) {
  if (cells.length !== targetNotes.length) return false;
  const getPC = (note) => {
    const pc = NOTES.indexOf(note);
    if (pc !== -1) return pc;
    const map = { "C#": 1, "Db": 1, "D#": 3, "Eb": 3, "F#": 6, "Gb": 6, "G#": 8, "Ab": 8, "A#": 10, "Bb": 10 };
    return map[note] ?? -1;
  };
  const cellPCs   = cells.map((c) => (c.pitchClass % 12 + 12) % 12).sort();
  const targetPCs = targetNotes.map((n) => getPC(n)).sort();
  return cellPCs.join(",") === targetPCs.join(",");
}

export function containsPitchSet(cells, targetNotes) {
  const selected = cells.map((c) => c.note);
  return targetNotes.every((note) => selected.includes(note));
}

export function distance(a, b) {
  if (a.midi != null && b.midi != null) return Math.abs(a.midi - b.midi);
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) * 1.35;
}

export function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((item, index) => {
    const rest = [...arr.slice(0, index), ...arr.slice(index + 1)];
    for (const perm of permutations(rest)) out.push([item, ...perm]);
  });
  return out;
}

export function bestMapping(fromCells, toCells) {
  let best = null;
  for (const perm of permutations(toCells)) {
    const pairs = fromCells.map((from, index) => {
      const to = perm[index];
      return { from, to, distance: distance(from, to) };
    });
    const total   = pairs.reduce((sum, pair) => sum + pair.distance, 0);
    const maxJump = Math.max(...pairs.map((pair) => pair.distance));
    const score   = total + maxJump * 0.15;
    if (!best || score < best.score) best = { pairs, total, maxJump, score };
  }
  return best;
}

export function generateGuideCandidates(startGuides, toGuideNotes, grid) {
  const allCells = grid.flat();
  const candidatesByNote = toGuideNotes.map((note) => allCells.filter((cell) => cell.note === note));
  const out = [];
  for (const a of candidatesByNote[0]) {
    for (const b of candidatesByNote[1]) {
      if (a.id !== b.id) out.push([a, b]);
    }
  }
  for (const first of startGuides) {
    for (const second of startGuides) {
      if (first.id === second.id) continue;
      const pair = [first, second];
      if (samePitchSet(pair, toGuideNotes)) out.push(pair);
    }
  }
  const seen = new Set();
  return out.filter((pair) => {
    const key = pair.map((cell) => cell.id).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
