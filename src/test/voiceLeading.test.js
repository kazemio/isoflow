import { describe, it, expect } from "vitest";
import {
  distance,
  gridDistance,
  permutations,
  bestMapping,
  samePitchSet,
  containsPitchSet,
  generateGuideCandidates,
  buildGrid,
} from "../musicUtils";

// Helper: build a minimal cell with midi
function midiCell(id, midi, note, pitchClass) {
  return { id, row: 0, col: 0, pitchClass, note, midi };
}

// Helper: build a grid cell (no midi)
function gridCell(id, row, col, pitchClass, note) {
  return { id, row, col, pitchClass, note };
}

describe("distance", () => {
  it("returns MIDI semitone distance (always — cells must have .midi)", () => {
    const a = midiCell("a", 60, "C", 0);
    const b = midiCell("b", 64, "E", 4);
    expect(distance(a, b)).toBe(4);
  });

  it("is symmetric", () => {
    const a = midiCell("a", 60, "C", 0);
    const b = midiCell("b", 67, "G", 7);
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it("returns 0 for same cell", () => {
    const a = midiCell("a", 60, "C", 0);
    expect(distance(a, a)).toBe(0);
  });

  it("layout-equivalence: a grid cell and a piano cell at the same MIDI compare as 0", () => {
    const gridLikeC4 = { id: "0-0", row: 0, col: 0, midi: 60, pitchClass: 0, note: "C" };
    const pianoC4    = { id: "piano-60", row: 0, col: 12, midi: 60, pitchClass: 0, note: "C" };
    expect(distance(gridLikeC4, pianoC4)).toBe(0);
  });
});

describe("gridDistance", () => {
  it("uses Manhattan with row weighted 1.35× (for input mapping only, NOT motion math)", () => {
    const a = { row: 0, col: 0 };
    const b = { row: 2, col: 3 };
    expect(gridDistance(a, b)).toBeCloseTo(3 + 2 * 1.35, 5);
  });

  it("is symmetric", () => {
    const a = { row: 1, col: 4 };
    const b = { row: 3, col: 2 };
    expect(gridDistance(a, b)).toBe(gridDistance(b, a));
  });
});

describe("permutations", () => {
  it("single-element array has exactly one permutation", () => {
    expect(permutations([1])).toEqual([[1]]);
  });

  it("[1,2,3] produces 6 permutations", () => {
    const result = permutations([1, 2, 3]);
    expect(result.length).toBe(6);
  });

  it("contains every ordering of [1,2,3]", () => {
    const result = permutations([1, 2, 3]);
    const asStrings = result.map((p) => p.join(","));
    expect(asStrings).toContain("1,2,3");
    expect(asStrings).toContain("1,3,2");
    expect(asStrings).toContain("2,1,3");
    expect(asStrings).toContain("2,3,1");
    expect(asStrings).toContain("3,1,2");
    expect(asStrings).toContain("3,2,1");
  });

  it("[a,b] produces 2 permutations", () => {
    const result = permutations(["a", "b"]);
    expect(result.length).toBe(2);
  });
});

describe("bestMapping", () => {
  it("finds the minimal-movement assignment", () => {
    // C→B (1 semitone) + F→F (0) beats C→F (5) + F→B (6)
    const from = [midiCell("c4",  60, "C", 0), midiCell("f4", 65, "F", 5)];
    const to   = [midiCell("b3",  59, "B", 11), midiCell("f4b", 65, "F", 5)];
    const m = bestMapping(from, to);
    expect(m.total).toBe(1);
    expect(m.maxJump).toBe(1);
  });

  it("returns non-null for two-voice mapping", () => {
    const from = [midiCell("a", 60, "C", 0), midiCell("b", 64, "E", 4)];
    const to   = [midiCell("c", 62, "D", 2), midiCell("d", 65, "F", 5)];
    const m = bestMapping(from, to);
    expect(m).not.toBeNull();
    expect(m.pairs.length).toBe(2);
  });

  it("score penalises max jump (score = total + maxJump × 0.15)", () => {
    const from = [midiCell("a", 60, "C", 0), midiCell("b", 72, "C", 0)];
    const to   = [midiCell("c", 61, "Db", 1), midiCell("d", 71, "B", 11)];
    const m = bestMapping(from, to);
    expect(m.score).toBeCloseTo(m.total + m.maxJump * 0.15, 10);
  });
});

describe("samePitchSet", () => {
  it("returns true when cells match target notes (order-independent)", () => {
    const cells = [
      { pitchClass: 2 },  // D
      { pitchClass: 5 },  // F
      { pitchClass: 9 },  // A
      { pitchClass: 0 },  // C
    ];
    expect(samePitchSet(cells, ["C", "D", "F", "A"])).toBe(true);
  });

  it("returns false when a note differs", () => {
    const cells = [{ pitchClass: 2 }, { pitchClass: 5 }, { pitchClass: 9 }, { pitchClass: 1 }];
    expect(samePitchSet(cells, ["D", "F", "A", "C"])).toBe(false);
  });

  it("returns false when count differs", () => {
    const cells = [{ pitchClass: 0 }, { pitchClass: 4 }];
    expect(samePitchSet(cells, ["C", "E", "G", "B"])).toBe(false);
  });

  it("handles enharmonics (Gb == F#)", () => {
    const cells = [{ pitchClass: 6 }, { pitchClass: 11 }];
    expect(samePitchSet(cells, ["F#", "B"])).toBe(true);
  });

  it("empty cells against empty target is true", () => {
    expect(samePitchSet([], [])).toBe(true);
  });
});

describe("containsPitchSet", () => {
  const cells = [
    { note: "G" }, { note: "B" }, { note: "D" }, { note: "F" },
  ];

  it("returns true when all target notes are present", () => {
    expect(containsPitchSet(cells, ["B", "F"])).toBe(true);
  });

  it("returns false when a target note is missing", () => {
    expect(containsPitchSet(cells, ["B", "E"])).toBe(false);
  });

  it("superset: extra cells are ignored", () => {
    expect(containsPitchSet(cells, ["G"])).toBe(true);
  });
});

describe("generateGuideCandidates", () => {
  // MIDI range covering roughly an octave or two for testing.
  const range = { midiMin: 48, midiMax: 71 }; // C3..B4

  it("returns pairs of voices whose notes match the guide note names", () => {
    const candidates = generateGuideCandidates([], ["B", "F"], range);
    for (const [a, b] of candidates) {
      const notes = new Set([a.note, b.note]);
      expect(notes.has("B")).toBe(true);
      expect(notes.has("F")).toBe(true);
    }
  });

  it("no duplicate (unordered) MIDI pairs", () => {
    const candidates = generateGuideCandidates([], ["B", "F"], range);
    const seen = new Set();
    for (const [a, b] of candidates) {
      const key = [a.midi, b.midi].sort((x, y) => x - y).join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("emits voices within the requested MIDI range", () => {
    const candidates = generateGuideCandidates([], ["B", "F"], range);
    for (const [a, b] of candidates) {
      expect(a.midi).toBeGreaterThanOrEqual(range.midiMin);
      expect(a.midi).toBeLessThanOrEqual(range.midiMax);
      expect(b.midi).toBeGreaterThanOrEqual(range.midiMin);
      expect(b.midi).toBeLessThanOrEqual(range.midiMax);
    }
  });

  it("includes a candidate at the MIDI of start guides that already match", () => {
    const bCell = midiCell("b3", 59, "B", 11);
    const fCell = midiCell("f3", 53, "F", 5);
    const candidates = generateGuideCandidates([bCell, fCell], ["B", "F"], range);
    const containsStartPair = candidates.some(
      ([a, b]) => new Set([a.midi, b.midi]).has(59) && new Set([a.midi, b.midi]).has(53)
    );
    expect(containsStartPair).toBe(true);
  });
});
