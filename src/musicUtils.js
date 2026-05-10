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

// LinnStrument 200 default base note — MIDI of grid bottom-left cell.
export const MIDI_BASE_NOTE = 30;

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

// Each cell carries `.midi` (canonical pitch, 0–127) and `.pitchClass` (0–11).
// Grid is laid out in 4ths (each row up = +5 semitones from the row below).
export function buildGrid(rows = 6, cols = 12, baseMidi = MIDI_BASE_NOTE) {
  const grid = [];
  for (let visualRow = 0; visualRow < rows; visualRow++) {
    const rowOffset = (rows - 1 - visualRow) * 5;
    const cells = [];
    for (let col = 0; col < cols; col++) {
      const midi = baseMidi + col + rowOffset;
      cells.push({
        id: `${visualRow}-${col}`,
        row: visualRow,
        col,
        midi,
        pitchClass: ((midi % 12) + 12) % 12,
        note: normalizeNote(midi),
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

// Set-equality for two arrays of note-name strings (e.g. chord.guide vs
// chord.guide). For cells, use samePitchSet — that one normalizes enharmonics
// via .pitchClass. This helper assumes inputs are already canonical spellings
// (which is the case for everything that comes out of buildChordsForKey).
export function sameNoteSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

// Voice-leading motion distance — always semitones. Both inputs MUST carry
// `.midi` (every cell does, post-canonical refactor); failure to do so is a
// programming error, not a fallback condition.
export function distance(a, b) {
  return Math.abs(a.midi - b.midi);
}

// Layout-coordinate distance for input mapping (e.g. proximity-based MIDI →
// grid-cell resolution). Operates on `.row` / `.col` only — used when picking
// the visually-nearest cell to an anchor on the LinnStrument-style grid.
// Row weighted because rows are vertically taller than columns are wide.
export function gridDistance(a, b) {
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

// Build an abstract voice (no layout fields) at a given MIDI value.
export function makeVoice(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return {
    id: `voice-${midi}`,
    midi,
    pitchClass: pc,
    note: NOTES[pc],
  };
}

// Layout-agnostic guide-candidate generator. Enumerates every pair of MIDI
// notes within the provided range whose pitch classes match `toGuideNotes`,
// plus any reordered pair from `startGuides` that already satisfies the set
// (a "common-tone hold" candidate).
//
// Returns an array of `[voice, voice]` pairs; voices have `.midi`,
// `.pitchClass`, `.note`, `.id`. Callers compare against these via
// `bestMapping` which uses MIDI distance.
export function generateGuideCandidates(startGuides, toGuideNotes, options = {}) {
  const { midiMin = 0, midiMax = 127 } = options;

  const targetPCs = toGuideNotes.map((note) => {
    const pc = NOTES.indexOf(note);
    if (pc !== -1) return pc;
    const map = { "C#": 1, "Db": 1, "D#": 3, "Eb": 3, "F#": 6, "Gb": 6, "G#": 8, "Ab": 8, "A#": 10, "Bb": 10 };
    return map[note];
  });

  const candidatesByNote = targetPCs.map((pc) => {
    const voices = [];
    for (let m = midiMin; m <= midiMax; m++) {
      if ((((m % 12) + 12) % 12) === pc) voices.push(makeVoice(m));
    }
    return voices;
  });

  const out = [];
  for (const a of candidatesByNote[0]) {
    for (const b of candidatesByNote[1]) {
      if (a.midi !== b.midi) out.push([a, b]);
    }
  }

  // Common-tone holds: any reordering of the user's starting guides that
  // already matches the destination pitch set, expressed as abstract voices
  // (uniform output shape; downstream comparison is by `.midi`).
  for (const first of startGuides) {
    for (const second of startGuides) {
      if (first.id === second.id) continue;
      if (samePitchSet([first, second], toGuideNotes)) {
        out.push([makeVoice(first.midi), makeVoice(second.midi)]);
      }
    }
  }

  // Dedupe by unordered MIDI pair.
  const seen = new Set();
  return out.filter((pair) => {
    const key = [pair[0].midi, pair[1].midi].sort((x, y) => x - y).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
