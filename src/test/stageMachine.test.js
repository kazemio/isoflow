import { describe, it, expect } from "vitest";
import { checkStage } from "../stageMachine";
import {
  pairGuidesByNoteName,
  suggestGuideTarget,
} from "../voicingUtils";

// Cell factory matching the canonical shape (id + midi + pitchClass + note).
function cell(id, midi, note) {
  return { id, midi, note, pitchClass: ((midi % 12) + 12) % 12, row: 0, col: 0 };
}

// Reusable C-major chord cells (close position around C3).
const C3 = cell("c3", 48, "C");
const E3 = cell("e3", 52, "E");
const G3 = cell("g3", 55, "G");
const B3 = cell("b3", 59, "B");
const cmaj7 = [C3, E3, G3, B3];

// G7 chord cells (G3 B3 D4 F4) — close-position destination for ii–V or V–I.
const D4 = cell("d4", 62, "D");
const F4 = cell("f4", 65, "F");

const C_KEY_CHORDS = {
  I: { tones: ["C", "E", "G", "B"], guide: ["E", "B"] },
  ii: { tones: ["D", "F", "A", "C"], guide: ["F", "C"] },
  V: { tones: ["G", "B", "D", "F"], guide: ["B", "F"] },
};

const baseInputs = {
  fromChord: C_KEY_CHORDS.I,
  toChord: C_KEY_CHORDS.V,
  fromSymbol: "I",
  toSymbol: "V",
  keyCenter: "C",
  mode: "learn",
  midiPlayMode: false,
  selection: [],
  startVoicing: [],
  startGuides: [],
  movedGuides: [],
  selected: [],
  layoutMidiRange: { midiMin: 36, midiMax: 84 },
};

// ── pairGuidesByNoteName ────────────────────────────────────────────────────

describe("pairGuidesByNoteName", () => {
  it("matches voices by note name first (common-tone preserved)", () => {
    // Source guides: E3, B3. Moved guides: F3 (was E3, +1), B3 (common tone).
    // Note-name pass pairs B3↔B3 (0); proximity then pairs E3→F3 (1).
    const source = [E3, B3];
    const moved = [cell("f3", 53, "F"), B3];
    const m = pairGuidesByNoteName(source, moved);
    expect(m.total).toBe(1);
    expect(m.maxJump).toBe(1);
    const bPair = m.pairs.find((p) => p.from.note === "B");
    expect(bPair.to.note).toBe("B");
    expect(bPair.distance).toBe(0);
  });

  it("falls back to proximity when no note names match", () => {
    const source = [E3, B3];
    const moved = [cell("f3", 53, "F"), cell("c4", 60, "C")];
    const m = pairGuidesByNoteName(source, moved);
    // E3(52)→F3(53)=1, B3(59)→C4(60)=1
    expect(m.total).toBe(2);
    expect(m.maxJump).toBe(1);
  });

  it("returns null when sizes are not 2/2", () => {
    expect(pairGuidesByNoteName([E3], [B3, F4])).toBeNull();
    expect(pairGuidesByNoteName([E3, B3], [F4])).toBeNull();
    expect(pairGuidesByNoteName([], [])).toBeNull();
  });

  it("does NOT permute to minimise total motion (unlike bestMapping)", () => {
    // Source E3(52), B3(59). Moved F3(53), Bb3(58).
    // Note-name pass: no matches. Proximity: E3→F3(1), B3→Bb3(1). Total 2.
    // bestMapping might or might not pick the same; key point is name-first
    // doesn't reorder once names match.
    const source = [E3, B3];
    const moved = [cell("f3", 53, "F"), cell("bb3", 58, "Bb")];
    const m = pairGuidesByNoteName(source, moved);
    expect(m.total).toBe(2);
  });
});

// ── suggestGuideTarget ──────────────────────────────────────────────────────

describe("suggestGuideTarget", () => {
  it("returns the nearest matching pitch class", () => {
    // Source C4 (60). Targets B, F. Nearest: B3 (59) at distance 1.
    const t = suggestGuideTarget(60, ["B", "F"]);
    expect(t.note).toBe("B");
    expect(t.midi).toBe(59);
  });

  it("can return the source itself as a common tone", () => {
    // Source B3 (59), targets ["B", "F"] — answer is B3 (distance 0).
    const t = suggestGuideTarget(59, ["B", "F"]);
    expect(t.note).toBe("B");
    expect(t.midi).toBe(59);
  });

  it("returns null for empty targets", () => {
    expect(suggestGuideTarget(60, [])).toBeNull();
    expect(suggestGuideTarget(60, null)).toBeNull();
  });

  it("returns null when source midi is missing", () => {
    expect(suggestGuideTarget(null, ["B", "F"])).toBeNull();
  });

  it("handles enharmonic spellings (Gb)", () => {
    // Source G3 (55). Target Gb (= F#, pc 6). Nearest is Gb3 (54), distance 1.
    const t = suggestGuideTarget(55, ["Gb"]);
    expect(t.midi).toBe(54);
  });
});

// ── checkStage: START_CHORD ─────────────────────────────────────────────────

describe("checkStage: START_CHORD", () => {
  it("ok when the four cells form the source chord", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "START_CHORD",
      selection: cmaj7,
    });
    expect(result.ok).toBe(true);
    expect(result.feedback.type).toBe("good");
  });

  it("not ok when fewer than 4 cells", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "START_CHORD",
      selection: [C3, E3, G3],
    });
    expect(result.ok).toBe(false);
    expect(result.feedback.type).toBe("bad");
  });

  it("not ok when wrong pitch set", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "START_CHORD",
      selection: [C3, E3, G3, F4],
    });
    expect(result.ok).toBe(false);
  });
});

// ── checkStage: IDENTIFY_GUIDES ─────────────────────────────────────────────

describe("checkStage: IDENTIFY_GUIDES", () => {
  it("ok when guides are the 3rd and 7th from the start voicing", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "IDENTIFY_GUIDES",
      startVoicing: cmaj7,
      selection: [E3, B3],
    });
    expect(result.ok).toBe(true);
  });

  it("not ok when a selection comes from outside the start voicing", () => {
    // F4 is correct pitch class for V's guide but never built into Cmaj7.
    const result = checkStage({
      ...baseInputs,
      stageKey: "IDENTIFY_GUIDES",
      startVoicing: cmaj7,
      selection: [E3, F4],
    });
    expect(result.ok).toBe(false);
    expect(result.feedback.body).toMatch(/starting voicing/);
  });

  it("ok when MIDI re-press maps to a different cell id with same midi", () => {
    // Same MIDI value, different id (e.g. anchor changed) — still inside.
    const eAlt = { ...E3, id: "alt-e3" };
    const bAlt = { ...B3, id: "alt-b3" };
    const result = checkStage({
      ...baseInputs,
      stageKey: "IDENTIFY_GUIDES",
      startVoicing: cmaj7,
      selection: [eAlt, bAlt],
    });
    expect(result.ok).toBe(true);
  });
});

// ── checkStage: MOVE_GUIDES (mouse mode) ────────────────────────────────────

describe("checkStage: MOVE_GUIDES (mouse)", () => {
  // I → V in C: guide tones E,B → F,B (B is common tone, E moves up to F).
  it("silent (no feedback) while user still holds source guides", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      startGuides: [E3, B3],
      selection: [E3, B3],
    });
    expect(result.ok).toBe(false);
    expect(result.feedback).toBeNull();
  });

  it("ok when guides resolve smoothly (B common tone, E→F by step)", () => {
    const f3 = cell("f3", 53, "F");
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      startGuides: [E3, B3],
      selection: [f3, B3],
    });
    expect(result.ok).toBe(true);
    expect(result.feedback.type).toMatch(/good|okay/);
  });

  it("not ok when destination notes are wrong", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      startGuides: [E3, B3],
      selection: [C3, G3],
    });
    expect(result.ok).toBe(false);
    expect(result.feedback.type).toBe("bad");
  });

  it("ok on I → I when held source guides are also the destination guides", () => {
    // Regression: same-chord transition (I → I) means fromChord.guide ===
    // toChord.guide. The "still holding source" silent-return must not block
    // grading in this case — the source guides ARE the correct answer.
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      fromChord: C_KEY_CHORDS.I,
      toChord: C_KEY_CHORDS.I,
      toSymbol: "I",
      startGuides: [E3, B3],
      selection: [E3, B3],
    });
    expect(result.ok).toBe(true);
    expect(result.feedback).not.toBeNull();
  });
});

// ── checkStage: MOVE_GUIDES (MIDI play mode) ────────────────────────────────

describe("checkStage: MOVE_GUIDES (MIDI play)", () => {
  it("ok when each voice stays or moves by step (≤2 semitones)", () => {
    const f3 = cell("f3", 53, "F");
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      midiPlayMode: true,
      startGuides: [E3, B3],
      selection: [f3, B3],
    });
    expect(result.ok).toBe(true);
  });

  it("not ok and surfaces the leaping voice when one jumps > 2 semitones", () => {
    // E3 → F4 is +13 semitones; B common tone should pair B↔B (0).
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      midiPlayMode: true,
      startGuides: [E3, B3],
      selection: [F4, B3],
    });
    expect(result.ok).toBe(false);
    // Title should name E3 (the offender) and the suggested closer F.
    expect(result.feedback.title).toMatch(/E3/);
    expect(result.feedback.title).toMatch(/jumped/);
  });

  it("not ok and explains when destination notes are wrong", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      midiPlayMode: true,
      startGuides: [E3, B3],
      selection: [C3, G3],
    });
    expect(result.ok).toBe(false);
    expect(result.feedback.title).toMatch(/Wrong destination/);
  });

  it("ok on I → I when source guides are still held (also the destination)", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "MOVE_GUIDES",
      midiPlayMode: true,
      fromChord: C_KEY_CHORDS.I,
      toChord: C_KEY_CHORDS.I,
      toSymbol: "I",
      startGuides: [E3, B3],
      selection: [E3, B3],
    });
    expect(result.ok).toBe(true);
  });
});

// ── checkStage: FILL_CHORD ──────────────────────────────────────────────────

describe("checkStage: FILL_CHORD", () => {
  it("ok in learn mode when movedGuides + selected complete the destination", () => {
    // Destination V (G7): G3 B3 D4 F4. movedGuides = [F4, B3], selected = [G3, D4].
    const result = checkStage({
      ...baseInputs,
      stageKey: "FILL_CHORD",
      mode: "learn",
      startVoicing: cmaj7,
      movedGuides: [F4, B3],
      selected: [G3, D4],
    });
    expect(result.ok).toBe(true);
    expect(result.feedback).toBeNull();
    expect(result.pendingDestination).toHaveLength(4);
    expect(result.transitionGrade).toMatch(/good|okay/);
    expect(result.transitionSummary).toBeTruthy();
  });

  it("ok in play mode when current selection alone forms the destination", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "FILL_CHORD",
      mode: "play",
      startVoicing: cmaj7,
      selection: [G3, B3, D4, F4],
    });
    expect(result.ok).toBe(true);
    expect(result.pendingDestination).toHaveLength(4);
  });

  it("not ok when pitch set is incomplete", () => {
    const result = checkStage({
      ...baseInputs,
      stageKey: "FILL_CHORD",
      mode: "learn",
      startVoicing: cmaj7,
      movedGuides: [F4, B3],
      selected: [G3], // missing D
    });
    expect(result.ok).toBe(false);
    expect(result.feedback.type).toBe("bad");
    expect(result.pendingDestination).toBeUndefined();
  });

  it("downgrades transitionGrade to okay when scoring is Acceptable+", () => {
    // Build a destination that forces wide leaps from the start voicing.
    // Source Cmaj7 close. Destination G7 placed an octave up to force motion.
    const G4 = cell("g4", 67, "G");
    const B4 = cell("b4", 71, "B");
    const D5 = cell("d5", 74, "D");
    const F5 = cell("f5", 77, "F");
    const result = checkStage({
      ...baseInputs,
      stageKey: "FILL_CHORD",
      mode: "play",
      startVoicing: cmaj7,
      selection: [G4, B4, D5, F5],
    });
    expect(result.ok).toBe(true);
    expect(result.transitionGrade).toBe("okay");
  });
});
