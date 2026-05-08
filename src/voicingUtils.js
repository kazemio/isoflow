import { bestMapping } from "./musicUtils";

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

  const perVoiceSigned = pairs.map((p) => (p.to.midi ?? 0) - (p.from.midi ?? 0));
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
