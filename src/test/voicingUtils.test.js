import { describe, it, expect } from "vitest";
import {
  evaluateVoiceLeading,
  shouldShowVoicingHint,
  isCellInPendingDestination,
  penaltyFor,
  classifyScore,
  feedbackFor,
} from "../voicingUtils";

// Minimal cell factory. midi is required for distance() to work accurately.
function cell(id, midi) {
  return { id, midi, row: 0, col: 0, note: "C", pitchClass: midi };
}

// ── penaltyFor / classifyScore / feedbackFor ────────────────────────────────

describe("penaltyFor", () => {
  it("0–2 semitones → 0 penalty", () => {
    expect(penaltyFor(0)).toBe(0);
    expect(penaltyFor(1)).toBe(0);
    expect(penaltyFor(2)).toBe(0);
  });
  it("3–5 semitones → +1", () => {
    expect(penaltyFor(3)).toBe(1);
    expect(penaltyFor(5)).toBe(1);
  });
  it("6–11 semitones → +2", () => {
    expect(penaltyFor(6)).toBe(2);
    expect(penaltyFor(11)).toBe(2);
  });
  it("12+ semitones → +4", () => {
    expect(penaltyFor(12)).toBe(4);
    expect(penaltyFor(24)).toBe(4);
  });
  it("treats negative distances as their absolute value", () => {
    expect(penaltyFor(-12)).toBe(4);
    expect(penaltyFor(-3)).toBe(1);
  });
});

describe("classifyScore", () => {
  it("0 → Optimal", () => { expect(classifyScore(0)).toBe("Optimal"); });
  it("1–2 → Good", () => {
    expect(classifyScore(1)).toBe("Good");
    expect(classifyScore(2)).toBe("Good");
  });
  it("3–5 → Acceptable", () => {
    expect(classifyScore(3)).toBe("Acceptable");
    expect(classifyScore(5)).toBe("Acceptable");
  });
  it("6+ → Wide", () => {
    expect(classifyScore(6)).toBe("Wide");
    expect(classifyScore(20)).toBe("Wide");
  });
});

describe("feedbackFor", () => {
  it("returns the matching short feedback string", () => {
    expect(feedbackFor("Optimal")).toBe("Smooth.");
    expect(feedbackFor("Good")).toBe("Mostly smooth.");
    expect(feedbackFor("Acceptable")).toBe("Some leaping.");
    expect(feedbackFor("Wide")).toBe("Wide leap.");
  });
});

// ── evaluateVoiceLeading ────────────────────────────────────────────────────

describe("evaluateVoiceLeading", () => {
  // Reference starting voicing: Cmaj7 close position
  const c3 = cell("c3", 48);
  const e3 = cell("e3", 52);
  const g3 = cell("g3", 55);
  const b3 = cell("b3", 59);
  const start = [c3, e3, g3, b3];

  it("scores Optimal when all voices stay (common tones)", () => {
    const result = evaluateVoiceLeading(start, [c3, e3, g3, b3]);
    expect(result.totalScore).toBe(0);
    expect(result.classification).toBe("Optimal");
    expect(result.feedback).toBe("Smooth.");
    expect(result.hasLargeLeap).toBe(false);
    expect(result.hasWideLeap).toBe(false);
    expect(result.hasParallelShift).toBe(false);
  });

  it("scores Optimal when all voices move stepwise (≤2 semitones)", () => {
    // C→C, E→F (1), G→G, B→Bb (1). all ≤2 → 0 penalty.
    const f3 = cell("f3", 53);
    const bb3 = cell("bb3", 58);
    const result = evaluateVoiceLeading(start, [c3, f3, g3, bb3]);
    expect(result.totalScore).toBe(0);
    expect(result.classification).toBe("Optimal");
  });

  it("scores Good when one voice moves a 4th-5th (3–5 semitones)", () => {
    // One voice moves 5 (penalty 1), others stepwise (0). total = 1 → Good.
    const ab3 = cell("ab3", 56); // 1 from G3
    const f3 = cell("f3", 53);   // 1 from E3
    const d4 = cell("d4", 62);   // 3 from B3 (penalty 1)
    const result = evaluateVoiceLeading(start, [c3, f3, ab3, d4]);
    expect(result.totalScore).toBe(1);
    expect(result.classification).toBe("Good");
    expect(result.feedback).toBe("Mostly smooth.");
  });

  it("scores Good when one voice has a 6–11 semitone motion (penalty 2)", () => {
    // Move B3 up to F#4 (7 semitones). Other crossings would force much
    // larger motions, so bestMapping picks the literal pairing.
    // Penalty: 0+0+0+2 = 2 → Good.
    const fsharp4 = cell("fs4", 66);
    const result = evaluateVoiceLeading(start, [c3, e3, g3, fsharp4]);
    expect(result.totalScore).toBe(2);
    expect(result.classification).toBe("Good");
    expect(result.hasLargeLeap).toBe(true);
    expect(result.hasWideLeap).toBe(false);
  });

  it("scores Acceptable for sums in 3–5 range", () => {
    // 3 voices each move 5 semitones (penalty 1×3 = 3) → Acceptable.
    const f3 = cell("f3", 53); // E3+1=F3 (1)
    const b3b = cell("b3-down", 54); // C3→F3=5? No. Use bigger moves.
    // C→F (5), E→A (5), G→C4 (5), B→F4? Too far. Just construct exact 3-penalty.
    // C→F (5,p1), E→A (5,p1), G→C4 (5,p1), B→B (0). Sum = 3.
    const f3_ = cell("f3", 53);
    const a3_ = cell("a3", 57);
    const c4_ = cell("c4", 60);
    const result = evaluateVoiceLeading(start, [f3_, a3_, c4_, b3]);
    expect(result.totalScore).toBe(3);
    expect(result.classification).toBe("Acceptable");
    expect(result.feedback).toBe("Some leaping.");
  });

  it("scores Wide when total penalties exceed 5", () => {
    // All 4 voices leap an octave up: 4 × +4 = 16 → Wide.
    const c4 = cell("c4", 60);
    const e4 = cell("e4", 64);
    const g4 = cell("g4", 67);
    const b4 = cell("b4", 71);
    const result = evaluateVoiceLeading(start, [c4, e4, g4, b4]);
    expect(result.totalScore).toBe(16);
    expect(result.classification).toBe("Wide");
    expect(result.feedback).toBe("Wide leap.");
  });

  it("flags hasWideLeap when any voice moves ≥ 12 semitones", () => {
    // Source: C2 + E3 + G3 + B3 → C3 + E3 + G3 + B3.
    // Only C2 has to move; crossing C2 with any other voice produces a much
    // larger total, so bestMapping picks literal C2→C3 = 12.
    const c2 = cell("c2", 36);
    const wideStart = [c2, e3, g3, b3];
    const result = evaluateVoiceLeading(wideStart, [c3, e3, g3, b3]);
    expect(result.hasWideLeap).toBe(true);
    expect(result.hasLargeLeap).toBe(true);
  });

  it("flags hasLargeLeap (but not hasWideLeap) when motion is in the 6–11 range", () => {
    const fsharp4 = cell("fs4", 66); // 7 semitones from B3
    const result = evaluateVoiceLeading(start, [c3, e3, g3, fsharp4]);
    expect(result.hasLargeLeap).toBe(true);
    expect(result.hasWideLeap).toBe(false);
  });

  it("flags hasParallelShift when all voices move ≥6 in the same direction", () => {
    // Whole chord up an octave — all voices +12, all up.
    const c4 = cell("c4", 60);
    const e4 = cell("e4", 64);
    const g4 = cell("g4", 67);
    const b4 = cell("b4", 71);
    const result = evaluateVoiceLeading(start, [c4, e4, g4, b4]);
    expect(result.hasParallelShift).toBe(true);
  });

  it("does not flag parallel shift when voices move in mixed directions", () => {
    // Some up, some down.
    const c2 = cell("c2", 36); // -12 from C3
    const e4 = cell("e4", 64); // +12 from E3
    const g4 = cell("g4", 67); // +12 from G3
    const b3_ = b3; // 0
    const result = evaluateVoiceLeading(start, [c2, e4, g4, b3_]);
    expect(result.hasParallelShift).toBe(false);
  });

  it("preserves voice crossing as smooth when bestMapping finds it", () => {
    // C3+G3+E3+B3 → G3+C4+E3+B3: bestMapping pairs C3→G3(7) + G3→C4(5)
    // rather than the literal C3→C4(12). maxJump under crossing = 7, total 4
    // (penalty 2+1+0+0). Score 3 → Acceptable, but never Wide.
    const c4 = cell("c4", 60);
    const result = evaluateVoiceLeading(start, [g3, c4, e3, b3]);
    // Expect bestMapping found a smoother interpretation (no 12-leap surfaced)
    expect(result.hasWideLeap).toBe(false);
  });

  it("scores Optimal when maintaining a previously wide voicing (no motion)", () => {
    // Round 1: voicing is wide (C2 + G2 + E3 + B3). Round 2 voices barely move.
    const c2 = cell("c2", 36);
    const g2 = cell("g2", 43);
    const wideStart = [c2, e3, g2, b3];
    // Move each non-guide by 1, guide tones by 1: all ≤2 → 0 penalty.
    const c2b = cell("c2b", 37);
    const ab2 = cell("ab2", 44);
    const f3 = cell("f3", 53);
    const bb3 = cell("bb3", 58);
    const result = evaluateVoiceLeading(wideStart, [c2b, f3, ab2, bb3]);
    expect(result.classification).toBe("Optimal");
    expect(result.feedback).toBe("Smooth.");
  });

  it("returns Optimal-with-empty arrays when input is empty (guard)", () => {
    const result = evaluateVoiceLeading([], []);
    expect(result.totalScore).toBe(0);
    expect(result.classification).toBe("Optimal");
    expect(result.perVoiceDistances).toEqual([]);
  });

  it("returns Optimal when source/target lengths differ (guard)", () => {
    const result = evaluateVoiceLeading(start, [c3, e3]);
    expect(result.classification).toBe("Optimal");
  });

  it("returns perVoiceDistances and perVoiceSigned for inspection", () => {
    // C2 + E3 + G3 + B3 → C3 + E3 + G3 + B3 forces a literal C2→C3 = +12.
    const c2 = cell("c2", 36);
    const wideStart = [c2, e3, g3, b3];
    const result = evaluateVoiceLeading(wideStart, [c3, e3, g3, b3]);
    expect(result.perVoiceDistances.length).toBe(4);
    expect(Math.max(...result.perVoiceDistances)).toBe(12);
    expect(result.perVoiceSigned.some((d) => d === 12)).toBe(true);
  });
});

// ── shouldShowVoicingHint ────────────────────────────────────────────────────

describe("shouldShowVoicingHint", () => {
  const c3 = cell("c3", 48);
  const e3 = cell("e3", 52);
  const g3 = cell("g3", 55);
  const b3 = cell("b3", 59);

  const startVoicing = [c3, e3, g3, b3];
  const startGuides  = [e3, b3];
  const movedGuides  = [];

  // ── IDENTIFY_GUIDES stage ──────────────────────────────────────────────────

  it("shows hint for a voicing cell that is not yet selected during IDENTIFY_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ false, /*isMovedGuide*/ false
    )).toBe(true);
  });

  it("hides hint for a voicing cell that IS selected during IDENTIFY_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ true, /*isMovedGuide*/ false
    )).toBe(false);
  });

  it("hides hint for a cell NOT in the starting voicing during IDENTIFY_GUIDES", () => {
    const outsider = cell("x", 60);
    expect(shouldShowVoicingHint(
      outsider, "IDENTIFY_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(false);
  });

  // ── MOVE_GUIDES stage ──────────────────────────────────────────────────────

  it("shows hint for an unresolved source guide tone during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(true);
  });

  it("hides hint for a guide tone that has been moved (is a movedGuide)", () => {
    const movedE3 = cell("e3-moved", 51); // landed on Eb3
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, [movedE3],
      false, /*isMovedGuide*/ true
    )).toBe(false);
  });

  it("hides hint for a guide tone that is currently selected during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      e3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      /*isSelected*/ true, false
    )).toBe(false);
  });

  it("hides hint for a non-guide cell during MOVE_GUIDES", () => {
    expect(shouldShowVoicingHint(
      c3, "MOVE_GUIDES", startVoicing, startGuides, movedGuides,
      false, false
    )).toBe(false);
  });

  // ── Other stages ──────────────────────────────────────────────────────────

  it("never shows hint during START_CHORD", () => {
    expect(shouldShowVoicingHint(
      c3, "START_CHORD", startVoicing, startGuides, movedGuides, false, false
    )).toBe(false);
  });

  it("never shows hint during FILL_CHORD", () => {
    expect(shouldShowVoicingHint(
      e3, "FILL_CHORD", startVoicing, startGuides, movedGuides, false, false
    )).toBe(false);
  });

  // ── Cross-layout (piano cells use the same logic as grid cells) ───────────

  describe("piano-shaped cells", () => {
    // Piano cells use ids like "piano-48". The function is id-driven, so this
    // verifies the same logic applies regardless of cell origin.
    const pianoC3 = { id: "piano-48", midi: 48, note: "C", row: 0, col: 0 };
    const pianoE3 = { id: "piano-52", midi: 52, note: "E", row: 0, col: 4 };
    const pianoG3 = { id: "piano-55", midi: 55, note: "G", row: 0, col: 7 };
    const pianoB3 = { id: "piano-59", midi: 59, note: "B", row: 0, col: 11 };

    const pianoStartVoicing = [pianoC3, pianoE3, pianoG3, pianoB3];
    const pianoStartGuides = [pianoE3, pianoB3];

    it("shows hint for unselected piano voicing cell during IDENTIFY_GUIDES", () => {
      expect(shouldShowVoicingHint(
        pianoC3, "IDENTIFY_GUIDES", pianoStartVoicing, pianoStartGuides, [],
        /*isSelected*/ false, /*isMovedGuide*/ false
      )).toBe(true);
    });

    it("shows hint for unmoved piano source guide during MOVE_GUIDES", () => {
      expect(shouldShowVoicingHint(
        pianoE3, "MOVE_GUIDES", pianoStartVoicing, pianoStartGuides, [],
        false, false
      )).toBe(true);
    });

    it("hides hint for a piano cell that is currently selected", () => {
      expect(shouldShowVoicingHint(
        pianoC3, "IDENTIFY_GUIDES", pianoStartVoicing, pianoStartGuides, [],
        /*isSelected*/ true, false
      )).toBe(false);
    });
  });
});

// ── isCellInPendingDestination ──────────────────────────────────────────────

describe("isCellInPendingDestination", () => {
  it("matches by id when both cells have ids (specific cell, same layout)", () => {
    // Same note name across different cells (octaves) must NOT match — only
    // the specific cell selected. This prevents the regression where every
    // grid cell with the chord's note name would light up green.
    const cell = { id: "0-3", note: "C", pitchClass: 24 };
    const dest = [{ id: "0-3", note: "C", pitchClass: 24 }];
    expect(isCellInPendingDestination(cell, true, dest)).toBe(true);
  });

  it("rejects same-note cells from different positions (id mismatch)", () => {
    // Two grid cells with note "C" but different ids (different octaves on
    // the isomorphic grid): only the cell that was actually selected lights up.
    const cellA = { id: "0-3", note: "C", pitchClass: 24 };
    const cellB = { id: "5-0", note: "C", pitchClass: 12 };
    const dest = [cellA];
    expect(isCellInPendingDestination(cellB, true, dest)).toBe(false);
  });

  it("returns false when not awaiting next round", () => {
    const cell = { id: "g-0-0", midi: 60, note: "C" };
    const dest = [{ id: "x", midi: 60, note: "C" }];
    expect(isCellInPendingDestination(cell, false, dest)).toBe(false);
  });

  it("returns false when pendingDestination is null", () => {
    const cell = { id: "g-0-0", midi: 60, note: "C" };
    expect(isCellInPendingDestination(cell, true, null)).toBe(false);
  });

  it("matches by midi when both cell and destination have midi", () => {
    const cell = { id: "piano-60", midi: 60, note: "C" };
    const dest = [{ midi: 60, note: "C" }];
    expect(isCellInPendingDestination(cell, true, dest)).toBe(true);
  });

  it("does NOT match when midi differs even if note name matches", () => {
    // Piano flow: distinct octaves of the same note name should not collide.
    const cell = { id: "piano-72", midi: 72, note: "C" }; // C5
    const dest = [{ midi: 60, note: "C" }];               // C4
    expect(isCellInPendingDestination(cell, true, dest)).toBe(false);
  });

  it("falls back to note name when destination has no midi (mouse-clicked grid cell)", () => {
    const cell = { id: "0-3", note: "F", midi: 53 };
    const dest = [{ note: "F" }]; // dest has no midi — common in mouse mode
    expect(isCellInPendingDestination(cell, true, dest)).toBe(true);
  });

  it("works for piano cells matched against MIDI-tagged destinations", () => {
    // Lock-in: piano success-tone matches when MIDI numbers align.
    const pianoKey = { midi: 64, note: "E" };
    const dest = [
      { midi: 60, note: "C" },
      { midi: 64, note: "E" },
      { midi: 67, note: "G" },
      { midi: 71, note: "B" },
    ];
    expect(isCellInPendingDestination(pianoKey, true, dest)).toBe(true);
  });

  it("matches ALL 4 cells of a completed destination chord, including moved-guide cells", () => {
    // Regression: when FILL_CHORD completes, pendingDestination contains 4 cells —
    // two that were the moved guide tones, two that the user newly selected as
    // non-guide tones. ALL four must match (so all four flash green together).
    // The CSS handles the visual override of moved-guide orange; this test
    // ensures the JS contract returns true for every destination cell.
    const movedGuideE = { id: "piano-53", midi: 53, note: "F" };  // guide moved E→F
    const movedGuideB = { id: "piano-58", midi: 58, note: "Bb" }; // guide moved B→Bb
    const nonGuide1 = { id: "piano-48", midi: 48, note: "C" };
    const nonGuide2 = { id: "piano-55", midi: 55, note: "G" };
    const pendingDestination = [movedGuideE, movedGuideB, nonGuide1, nonGuide2];

    for (const cell of pendingDestination) {
      expect(
        isCellInPendingDestination(cell, true, pendingDestination)
      ).toBe(true);
    }
  });

  it("matches all 4 grid cells of a completed destination chord", () => {
    // Same scenario as above but with grid-style cell ids — ensures the id-first
    // match works for the grid layout too.
    const movedA = { id: "3-2", note: "F", pitchClass: 29 };
    const movedB = { id: "2-5", note: "Bb", pitchClass: 34 };
    const newC = { id: "5-0", note: "C", pitchClass: 24 };
    const newD = { id: "4-3", note: "G", pitchClass: 31 };
    const pendingDestination = [movedA, movedB, newC, newD];

    for (const cell of pendingDestination) {
      expect(
        isCellInPendingDestination(cell, true, pendingDestination)
      ).toBe(true);
    }
  });
});

// ── Layout-equivalence: identical MIDI motion → identical score ─────────────

describe("layout equivalence", () => {
  // Cells with grid-style ids (`row-col`) vs piano-style ids (`piano-N`).
  // Identical MIDI sequences must produce identical scoring results.
  function gridLike(row, col, midi) {
    return { id: `${row}-${col}`, row, col, midi, pitchClass: ((midi % 12) + 12) % 12, note: "X" };
  }
  function pianoLike(midi) {
    return { id: `piano-${midi}`, row: 0, col: midi - 48, midi, pitchClass: ((midi % 12) + 12) % 12, note: "X" };
  }

  it("evaluateVoiceLeading produces identical results for grid-shaped vs piano-shaped cells", () => {
    const sourceMidi = [60, 64, 67, 71]; // Cmaj7
    const targetMidi = [60, 65, 67, 70]; // C7-ish (E→F, B→Bb)

    const gridSource = sourceMidi.map((m, i) => gridLike(0, i, m));
    const gridTarget = targetMidi.map((m, i) => gridLike(1, i, m));
    const pianoSource = sourceMidi.map(pianoLike);
    const pianoTarget = targetMidi.map(pianoLike);

    const gridResult = evaluateVoiceLeading(gridSource, gridTarget);
    const pianoResult = evaluateVoiceLeading(pianoSource, pianoTarget);

    expect(gridResult.totalScore).toBe(pianoResult.totalScore);
    expect(gridResult.classification).toBe(pianoResult.classification);
    expect(gridResult.feedback).toBe(pianoResult.feedback);
    expect(gridResult.hasLargeLeap).toBe(pianoResult.hasLargeLeap);
    expect(gridResult.hasWideLeap).toBe(pianoResult.hasWideLeap);
    expect(gridResult.hasParallelShift).toBe(pianoResult.hasParallelShift);
  });

  it("a grid C3 → piano B2 transition scores 1 semitone (not Manhattan grid distance)", () => {
    const c3Grid = gridLike(7, 0, 48);  // C3 on grid
    const b2Grid = gridLike(7, 0, 47);  // B2 — same grid cell, different MIDI
    const c3Piano = pianoLike(48);
    const b2Piano = pianoLike(47);

    // Single-voice motion: 48 → 47 = 1 semitone. Same regardless of layout.
    const gridScore = evaluateVoiceLeading([c3Grid], [b2Grid]);
    const pianoScore = evaluateVoiceLeading([c3Piano], [b2Piano]);

    expect(gridScore.perVoiceDistances[0]).toBe(1);
    expect(pianoScore.perVoiceDistances[0]).toBe(1);
    expect(gridScore.totalScore).toBe(pianoScore.totalScore);
  });
});
