import { describe, it, expect } from "vitest";
import { scoreVoiceLeadingTransition } from "../voiceLeadingScore";

// Pitch classes for ii–V–I in C major
// Dm7: D(2) F(5) A(9) C(0)
// G7:  G(7) B(11) D(2) F(5)
// Cmaj7: C(0) E(4) G(7) B(11)
const DM7_PC = [2, 5, 9, 0];
const G7_PC  = [7, 11, 2, 5];
const CMAJ7_PC = [0, 4, 7, 11];

// Typical close-position voicing for Dm7 (MIDI)
const DM7_MIDI  = [62, 65, 69, 72]; // D4 F4 A4 C5
// Close G7 voicing from Dm7=[62,65,69,72]: D4 stays, F4 stays, A4→G4, C5→B4
// D4(62) F4(65) G4(67) B4(71) — total movement = 0+0+2+1 = 3
// PCs: 2,5,7,11 sorted = 2,5,7,11 ✓
const G7_MIDI_CLOSE = [62, 65, 67, 71];

// Wide G7 voicing: G2(43) B3(59) D5(74) F5(77) — spread of 34 semitones
// PCs: 7,11,2,5 sorted = 2,5,7,11 ✓
const G7_MIDI_WIDE = [43, 59, 74, 77];

describe("scoreVoiceLeadingTransition", () => {
  describe("correct chord with minimal motion", () => {
    it("grade is minimal or close when movement is tight", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toMatch(/^(minimal|close)$/);
      expect(result.excessDistance).toBeGreaterThanOrEqual(0);
    });

    it("excessDistance is 0 for an optimal voicing", () => {
      // Score an arrangement against itself — should be 0 excess
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, DM7_MIDI, DM7_PC, DM7_PC, DM7_PC
      );
      expect(result.grade).toBe("minimal");
      expect(result.excessDistance).toBe(0);
    });
  });

  describe("correct chord with wide motion", () => {
    it("grade is wide when voicing jumps far", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_WIDE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toBe("wide");
      expect(result.excessDistance).toBeGreaterThan(2);
    });

    it("userDistance > optimalDistance for wide voicing", () => {
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, G7_MIDI_WIDE, G7_PC, DM7_PC, G7_PC
      );
      expect(result.userDistance).toBeGreaterThan(result.optimalDistance ?? 0);
    });
  });

  describe("wrong chord", () => {
    it("returns grade=incorrect when pitch classes don't match target", () => {
      const wrongMidi = [60, 64, 67, 71]; // Cmaj7, not G7
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, wrongMidi, G7_PC, DM7_PC, G7_PC
      );
      expect(result.grade).toBe("incorrect");
    });

    it("message includes 'not the target chord' for wrong chord", () => {
      const wrongMidi = [60, 64, 67, 71];
      const result = scoreVoiceLeadingTransition(
        DM7_MIDI, wrongMidi, G7_PC, DM7_PC, G7_PC
      );
      expect(result.message).toMatch(/not the target/i);
    });
  });

  describe("wide-voicing crash guard", () => {
    it("does not crash when source voicing spans > 24 semitones", () => {
      // Extremely wide: C2(36) to C6(84) — 48 semitones
      const wideSource = [36, 48, 72, 84];
      expect(() => {
        scoreVoiceLeadingTransition(wideSource, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC);
      }).not.toThrow();
    });

    it("returns a result object even for wide source voicing", () => {
      const wideSource = [30, 50, 70, 90];
      const result = scoreVoiceLeadingTransition(wideSource, G7_MIDI_CLOSE, G7_PC, DM7_PC, G7_PC);
      expect(result).toHaveProperty("grade");
      expect(result).toHaveProperty("userDistance");
    });
  });
});
