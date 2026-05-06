import { describe, it, expect } from "vitest";
import {
  NOTES,
  normalizeNote,
  noteIndex,
  transposeNote,
  getChordName,
  buildChordsForKey,
} from "../musicUtils";

describe("normalizeNote", () => {
  it("returns the note for a valid index", () => {
    expect(normalizeNote(0)).toBe("C");
    expect(normalizeNote(6)).toBe("Gb");
    expect(normalizeNote(11)).toBe("B");
  });

  it("wraps positive overflow", () => {
    expect(normalizeNote(12)).toBe("C");
    expect(normalizeNote(13)).toBe("Db");
    expect(normalizeNote(24)).toBe("C");
  });

  it("wraps negative indices", () => {
    expect(normalizeNote(-1)).toBe("B");
    expect(normalizeNote(-12)).toBe("C");
  });
});

describe("noteIndex", () => {
  it("returns 0–11 for all notes", () => {
    NOTES.forEach((note, i) => {
      expect(noteIndex(note)).toBe(i);
    });
  });

  it("returns -1 for unknown note", () => {
    expect(noteIndex("X")).toBe(-1);
  });
});

describe("transposeNote", () => {
  it("transposes up by semitones", () => {
    expect(transposeNote("C", 4)).toBe("E");
    expect(transposeNote("C", 7)).toBe("G");
    expect(transposeNote("C", 11)).toBe("B");
  });

  it("wraps around the octave", () => {
    expect(transposeNote("B", 1)).toBe("C");
    expect(transposeNote("C", 12)).toBe("C");
  });

  it("transposes down", () => {
    expect(transposeNote("C", -1)).toBe("B");
    expect(transposeNote("D", -2)).toBe("C");
  });
});

describe("getChordName", () => {
  it("labels I and IV as maj7", () => {
    expect(getChordName("I", ["C", "E", "G", "B"])).toBe("Cmaj7");
    expect(getChordName("IV", ["F", "A", "C", "E"])).toBe("Fmaj7");
  });

  it("labels V as dominant 7", () => {
    expect(getChordName("V", ["G", "B", "D", "F"])).toBe("G7");
  });

  it("labels ii, iii, vi as m7", () => {
    expect(getChordName("ii", ["D", "F", "A", "C"])).toBe("Dm7");
    expect(getChordName("vi", ["A", "C", "E", "G"])).toBe("Am7");
  });

  it("labels vii as m7b5", () => {
    expect(getChordName("vii", ["B", "D", "F", "A"])).toBe("Bm7b5");
  });
});

describe("buildChordsForKey", () => {
  describe("key of C", () => {
    const chords = buildChordsForKey("C");

    it("ii = Dm7: tones [D,F,A,C]", () => {
      expect(chords.ii.tones).toEqual(["D", "F", "A", "C"]);
    });

    it("ii guide tones = [F, C] (3rd and 7th)", () => {
      expect(chords.ii.guide).toEqual(["F", "C"]);
    });

    it("V = G7: tones [G,B,D,F]", () => {
      expect(chords.V.tones).toEqual(["G", "B", "D", "F"]);
    });

    it("V guide tones = [B, F]", () => {
      expect(chords.V.guide).toEqual(["B", "F"]);
    });

    it("I = Cmaj7: tones [C,E,G,B]", () => {
      expect(chords.I.tones).toEqual(["C", "E", "G", "B"]);
    });

    it("I guide tones = [E, B]", () => {
      expect(chords.I.guide).toEqual(["E", "B"]);
    });

    it("all 7 degrees are present", () => {
      expect(Object.keys(chords)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii"]);
    });
  });

  describe("key of G", () => {
    const chords = buildChordsForKey("G");

    it("V = D7: tones [D,Gb,A,C]", () => {
      // G major: V degree roots on D; 0+7=7→G… wait, root=G(7), +7=14→D
      expect(chords.V.tones[0]).toBe("D");
    });

    it("ii roots on A", () => {
      expect(chords.ii.tones[0]).toBe("A");
    });
  });

  describe("key of Bb", () => {
    const chords = buildChordsForKey("Bb");

    it("V = F7: roots on F", () => {
      expect(chords.V.tones[0]).toBe("F");
    });

    it("ii roots on C", () => {
      expect(chords.ii.tones[0]).toBe("C");
    });
  });

  it("every chord has exactly 4 tones and 2 guide tones", () => {
    const keys = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "G", "D", "A", "E", "B"];
    for (const key of keys) {
      const chords = buildChordsForKey(key);
      for (const [sym, chord] of Object.entries(chords)) {
        expect(chord.tones.length, `${key} ${sym} tones`).toBe(4);
        expect(chord.guide.length, `${key} ${sym} guide`).toBe(2);
      }
    }
  });
});
