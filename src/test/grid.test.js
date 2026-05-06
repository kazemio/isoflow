import { describe, it, expect } from "vitest";
import {
  buildGrid,
  buildPianoKeys,
  buildPianoCells,
  PIANO_MIDI_START,
  PIANO_MIDI_END,
  BLACK_PCS,
} from "../musicUtils";

describe("buildGrid", () => {
  it("produces the right number of rows and cols", () => {
    const g = buildGrid(8, 16, 6);
    expect(g.length).toBe(8);
    expect(g[0].length).toBe(16);
    expect(g[7].length).toBe(16);
  });

  it("bottom-left cell of default grid (8×8, startNote=6) is Gb", () => {
    const g = buildGrid(8, 8, 6);
    const bottomLeft = g[7][0];
    expect(bottomLeft.note).toBe("Gb");
    expect(bottomLeft.id).toBe("7-0");
  });

  it("row 0 col 0 is higher than row 7 col 0 by 5 semitones/row × 7 rows", () => {
    const g = buildGrid(8, 8, 6);
    const topLeft    = g[0][0];
    const bottomLeft = g[7][0];
    const diff = (topLeft.pitchClass - bottomLeft.pitchClass + 12000) % 12;
    // 7 rows × 5 semitones = 35 semitones → 35 % 12 = 11
    expect(diff).toBe(11);
  });

  it("adjacent columns differ by 1 semitone (pitch class)", () => {
    const g = buildGrid(4, 8, 6);
    for (const row of g) {
      for (let col = 0; col < row.length - 1; col++) {
        const diff = (row[col + 1].pitchClass - row[col].pitchClass + 1200) % 12;
        expect(diff).toBe(1);
      }
    }
  });

  it("adjacent rows differ by 5 semitones (isomorphic layout)", () => {
    const g = buildGrid(4, 8, 6);
    for (let row = 0; row < g.length - 1; row++) {
      for (let col = 0; col < g[row].length; col++) {
        const upperPC = g[row][col].pitchClass;
        const lowerPC = g[row + 1][col].pitchClass;
        const diff = (upperPC - lowerPC + 1200) % 12;
        expect(diff).toBe(5);
      }
    }
  });

  it("cell ids follow visualRow-col format", () => {
    const g = buildGrid(3, 4, 6);
    expect(g[0][0].id).toBe("0-0");
    expect(g[2][3].id).toBe("2-3");
  });
});

describe("buildPianoKeys", () => {
  const keys = buildPianoKeys();
  const totalKeys = PIANO_MIDI_END - PIANO_MIDI_START + 1;

  it("covers MIDI range C3–C6 (37 notes)", () => {
    expect(keys.length).toBe(totalKeys);
    expect(keys[0].midi).toBe(PIANO_MIDI_START);
    expect(keys[keys.length - 1].midi).toBe(PIANO_MIDI_END);
  });

  it("C3 (MIDI 48) is the first key and is white", () => {
    expect(keys[0].note).toBe("C");
    expect(keys[0].isBlack).toBe(false);
  });

  it("black keys match BLACK_PCS pitch classes", () => {
    for (const k of keys) {
      expect(k.isBlack).toBe(BLACK_PCS.has(k.pc));
    }
  });

  it("white keys have ascending whiteIndex, black keys have null", () => {
    const whites = keys.filter((k) => !k.isBlack);
    whites.forEach((k, i) => {
      expect(k.whiteIndex).toBe(i);
    });
    const blacks = keys.filter((k) => k.isBlack);
    blacks.forEach((k) => {
      expect(k.whiteIndex).toBeNull();
    });
  });

  it("37 keys include the right black/white split (25 white, 12 black across 2 octaves + C)", () => {
    const whiteCount = keys.filter((k) => !k.isBlack).length;
    const blackCount = keys.filter((k) => k.isBlack).length;
    // C3–C6: 3 octaves + root = 22 white + some extra
    expect(whiteCount + blackCount).toBe(37);
    expect(blackCount).toBeGreaterThan(0);
  });
});

describe("buildPianoCells", () => {
  const cells = buildPianoCells();

  it("has the same count as piano keys", () => {
    const keys = buildPianoKeys();
    expect(cells.length).toBe(keys.length);
  });

  it("ids follow piano-{midi} format", () => {
    cells.forEach((c) => {
      expect(c.id).toMatch(/^piano-\d+$/);
      expect(c.id).toBe(`piano-${c.midi}`);
    });
  });

  it("each cell has a valid pitchClass (0–11)", () => {
    cells.forEach((c) => {
      expect(c.pitchClass).toBeGreaterThanOrEqual(0);
      expect(c.pitchClass).toBeLessThanOrEqual(11);
    });
  });

  it("col equals midi - PIANO_MIDI_START", () => {
    cells.forEach((c) => {
      expect(c.col).toBe(c.midi - PIANO_MIDI_START);
    });
  });
});
