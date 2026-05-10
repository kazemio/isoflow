import { bestMapping, NOTES } from "./musicUtils";

// ── Voice-leading scoring ────────────────────────────────────────────────────

// Penalty for a single voice's motion in semitones.
// 0–2: stepwise/common-tone (free), 3–5: small motion, 6–11: larger leap,
// 12+: octave or larger leap.
export function penaltyFor(distance) {
  const d = Math.abs(distance);
  if (d <= 2) return 0;
  if (d <= 5) return 1;
  if (d <= 11) return 2;
  return 4;
}

export function classifyScore(totalScore) {
  if (totalScore === 0) return "Optimal";
  if (totalScore <= 2) return "Good";
  if (totalScore <= 5) return "Acceptable";
  return "Wide";
}

export function feedbackFor(classification) {
  switch (classification) {
    case "Optimal": return "Smooth.";
    case "Good": return "Mostly smooth.";
    case "Acceptable": return "Some leaping.";
    case "Wide": return "Wide leap.";
    default: return "";
  }
}

// Evaluates the voice-leading transition between two equivalent-pitch-set
// chords. The caller is responsible for verifying chord correctness; this
// function only scores motion.
//
// Pairs source → target voices via bestMapping (voice crossings allowed when
// they reduce total motion), then sums per-voice penalties. Tags surface
// optional structural signals (large leap, wide leap, parallel shift) that
// don't drive the score but can be displayed.
export function evaluateVoiceLeading(sourceCells, targetCells) {
  if (sourceCells.length !== targetCells.length || sourceCells.length === 0) {
    return {
      totalScore: 0,
      classification: "Optimal",
      perVoiceDistances: [],
      perVoiceSigned: [],
      hasLargeLeap: false,
      hasWideLeap: false,
      hasParallelShift: false,
      feedback: feedbackFor("Optimal"),
    };
  }

  const mapping = bestMapping(sourceCells, targetCells);
  const pairs = mapping?.pairs ?? [];

  const perVoiceSigned = pairs.map((p) => p.to.midi - p.from.midi);
  const perVoiceDistances = perVoiceSigned.map((d) => Math.abs(d));

  const totalScore = perVoiceDistances.reduce((sum, d) => sum + penaltyFor(d), 0);
  const classification = classifyScore(totalScore);

  const hasLargeLeap = perVoiceDistances.some((d) => d >= 6);
  const hasWideLeap = perVoiceDistances.some((d) => d >= 12);
  const hasParallelShift =
    perVoiceSigned.length > 0 &&
    perVoiceDistances.every((d) => d >= 6) &&
    (perVoiceSigned.every((d) => d > 0) || perVoiceSigned.every((d) => d < 0));

  return {
    totalScore,
    classification,
    perVoiceDistances,
    perVoiceSigned,
    hasLargeLeap,
    hasWideLeap,
    hasParallelShift,
    feedback: feedbackFor(classification),
  };
}

// Returns true when a cell is part of the just-completed destination chord
// and should flash green. Matches by id first (specific cell within a layout
// — the most precise check, prevents same-note cells in other octaves from
// also lighting up), then by MIDI for cross-layout, then by note name as a
// last resort.
export function isCellInPendingDestination(cell, awaitingNextRound, pendingDestination) {
  if (!awaitingNextRound || !pendingDestination) return false;
  return pendingDestination.some((dest) => {
    if (cell.id != null && dest.id != null) return dest.id === cell.id;
    if (cell.midi != null && dest.midi != null) return dest.midi === cell.midi;
    return dest.note === cell.note;
  });
}

// ── Note-name-first pairing (MIDI play mode) ────────────────────────────────

// Pairs source guide voices to moved guide voices by note name first (so a
// common tone or correctly-resolved voice is identified independently of
// register), then matches any remaining voices by MIDI proximity.
//
// Returns null unless both inputs have length 2. The output mapping shape
// matches bestMapping(): { pairs: [{from, to, distance}], total, maxJump }.
//
// This pairing intentionally differs from bestMapping(): it does NOT permute
// to minimise total motion. The MIDI-mode strictness check ("each voice ≤2
// semitones") only makes sense when "your B" is compared to "my B", not when
// voices cross to flatter the score.
export function pairGuidesByNoteName(sourceGuides, movedGuides) {
  if (sourceGuides.length !== 2 || movedGuides.length !== 2) return null;

  const unmatched = [...movedGuides];
  const pairs = [];

  for (const from of sourceGuides) {
    const idx = unmatched.findIndex((to) => to.note === from.note);
    if (idx >= 0) pairs.push({ from, to: unmatched.splice(idx, 1)[0] });
  }

  const leftFrom = sourceGuides.filter(
    (f) => !pairs.find((p) => p.from.id === f.id)
  );
  for (const from of leftFrom) {
    const fMidi = from.midi ?? 0;
    unmatched.sort(
      (a, b) =>
        Math.abs((a.midi ?? 0) - fMidi) - Math.abs((b.midi ?? 0) - fMidi)
    );
    if (unmatched.length) pairs.push({ from, to: unmatched.shift() });
  }

  if (pairs.length !== 2) return null;

  const dists = pairs.map((p) => Math.abs((p.from.midi ?? 0) - (p.to.midi ?? 0)));
  return {
    pairs: pairs.map((p, i) => ({ ...p, distance: dists[i] })),
    total: dists.reduce((s, d) => s + d, 0),
    maxJump: Math.max(...dists),
  };
}

// ── Guide-target suggestion (MIDI play mode feedback) ───────────────────────

const ENHARMONIC_PC = {
  "C#": 1, "Db": 1,
  "D#": 3, "Eb": 3,
  "F#": 6, "Gb": 6,
  "G#": 8, "Ab": 8,
  "A#": 10, "Bb": 10,
};

function pitchClassOf(note) {
  const pc = NOTES.indexOf(note);
  return pc !== -1 ? pc : (ENHARMONIC_PC[note] ?? 0);
}

// Given a source MIDI note that resolved incorrectly, returns the nearest
// destination guide tone the user should have hit instead. Searches the
// three nearest octaves above/below the source, ties broken by preferring
// the same octave as the source. Returns { note, midi } or null.
export function suggestGuideTarget(sourceMidi, destinationGuideNotes) {
  if (sourceMidi == null || !destinationGuideNotes?.length) return null;
  const sourceOctave = Math.floor(sourceMidi / 12) - 1;
  const sourcePc = ((sourceMidi % 12) + 12) % 12;

  const candidates = destinationGuideNotes.flatMap((note) => {
    const targetPc = pitchClassOf(note);
    const pcOffset = ((targetPc - sourcePc + 12) % 12);
    return [-12, 0, 12].map((octaveOffset) => ({
      note,
      midi: sourceMidi + pcOffset + octaveOffset,
    }));
  });

  return candidates
    .filter((c) => c.midi > 0 && c.midi < 128)
    .sort((a, b) => {
      const dA = Math.abs(a.midi - sourceMidi);
      const dB = Math.abs(b.midi - sourceMidi);
      if (dA !== dB) return dA - dB;
      const sameA = (Math.floor(a.midi / 12) - 1) === sourceOctave ? 0 : 1;
      const sameB = (Math.floor(b.midi / 12) - 1) === sourceOctave ? 0 : 1;
      return sameA - sameB;
    })[0] ?? null;
}

// ── Voicing-hint outline ────────────────────────────────────────────────────

// Returns true when a cell should show the orange voicing-hint outline.
//
// IDENTIFY_GUIDES: every cell from the starting voicing that hasn't been
//   selected yet gets an outline, guiding the user to pick guide tones
//   from within the chord they just built.
//
// MOVE_GUIDES: source guide tones that haven't been moved (or selected as
//   the new destination) get an outline to show where they started.
export function shouldShowVoicingHint(
  cell,
  stageKey,
  startVoicing,
  startGuides,
  movedGuides,
  isSelected,
  isMovedGuide
) {
  if (stageKey === "IDENTIFY_GUIDES") {
    return startVoicing.some((c) => c.id === cell.id) && !isSelected;
  }
  if (stageKey === "MOVE_GUIDES") {
    return (
      startGuides.some((c) => c.id === cell.id) &&
      !isSelected &&
      !isMovedGuide
    );
  }
  return false;
}
