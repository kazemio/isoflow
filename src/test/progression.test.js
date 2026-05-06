import { describe, it, expect } from "vitest";
import { parseProgression, generateRandomProgression, buildChordsForKey } from "../musicUtils";

const CHORDS = buildChordsForKey("C");

describe("parseProgression", () => {
  it("parses space-separated tokens", () => {
    expect(parseProgression("ii V I", CHORDS)).toEqual(["ii", "V", "I"]);
  });

  it("strips em-dash separators", () => {
    expect(parseProgression("ii–V–I", CHORDS)).toEqual(["ii", "V", "I"]);
  });

  it("strips regular hyphen separators", () => {
    expect(parseProgression("ii-V-I", CHORDS)).toEqual(["ii", "V", "I"]);
  });

  it("strips arrow separators", () => {
    expect(parseProgression("ii→V→I", CHORDS)).toEqual(["ii", "V", "I"]);
  });

  it("strips comma separators", () => {
    expect(parseProgression("ii,V,I", CHORDS)).toEqual(["ii", "V", "I"]);
  });

  it("returns null for unknown tokens", () => {
    expect(parseProgression("X Y Z", CHORDS)).toBeNull();
  });

  it("silently drops unknown tokens but keeps valid ones", () => {
    // "ii X I" → ["ii","I"] which is 2 valid → should return them
    expect(parseProgression("ii X I", CHORDS)).toEqual(["ii", "I"]);
  });

  it("returns null when fewer than 2 valid tokens", () => {
    expect(parseProgression("ii", CHORDS)).toBeNull();
    expect(parseProgression("X", CHORDS)).toBeNull();
    expect(parseProgression("", CHORDS)).toBeNull();
  });

  it("returns null for a single invalid chord", () => {
    expect(parseProgression("Z", CHORDS)).toBeNull();
  });

  it("handles extra whitespace", () => {
    expect(parseProgression("  ii   V   I  ", CHORDS)).toEqual(["ii", "V", "I"]);
  });
});

describe("generateRandomProgression", () => {
  const VALID_STARTS = new Set(["I", "vi", "ii", "IV"]);
  const VALID_DEGREES = new Set(["I", "ii", "iii", "IV", "V", "vi", "vii"]);

  const TRANSITIONS = {
    I:   new Set(["ii", "IV", "V", "vi", "iii"]),
    ii:  new Set(["V", "IV", "vii"]),
    iii: new Set(["vi", "IV", "I"]),
    IV:  new Set(["V", "ii", "I", "vii"]),
    V:   new Set(["I", "vi"]),
    vi:  new Set(["ii", "IV", "V"]),
    vii: new Set(["I", "iii"]),
  };

  function validateProgression(prog) {
    const tokens = prog.split(" ");
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens.length).toBeLessThanOrEqual(10);
    expect(VALID_STARTS.has(tokens[0])).toBe(true);
    for (const t of tokens) {
      expect(VALID_DEGREES.has(t)).toBe(true);
    }
    for (let i = 0; i < tokens.length - 1; i++) {
      const from = tokens[i], to = tokens[i + 1];
      expect(TRANSITIONS[from].has(to), `${from} → ${to} is not a valid transition`).toBe(true);
    }
  }

  it("produces a valid progression every time (100 runs)", () => {
    for (let i = 0; i < 100; i++) {
      const prog = generateRandomProgression();
      validateProgression(prog);
    }
  });

  it("returns a string (space-separated degrees)", () => {
    const prog = generateRandomProgression();
    expect(typeof prog).toBe("string");
    expect(prog.length).toBeGreaterThan(0);
  });
});
