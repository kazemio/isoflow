import { bestMapping } from "./musicUtils";

// Returns true when the non-guide tones jumped more than a 5th (7 semitones)
// relative to where they started — indicating a wider voicing transition.
// Cells must have a .midi property for accurate distance calculation.
export function detectWiderVoicing(startVoicing, startGuides, newNonGuides) {
  const startNonGuides = startVoicing.filter(
    (v) => !startGuides.some((g) => g.id === v.id)
  );
  if (startNonGuides.length !== 2 || newNonGuides.length !== 2) return false;
  const motion = bestMapping(startNonGuides, newNonGuides);
  return motion != null && motion.maxJump >= 12; // moved a full register (octave)
}

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
