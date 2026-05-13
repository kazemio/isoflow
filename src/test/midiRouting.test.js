import { describe, it, expect } from "vitest";
import {
  isSameMidiDevice,
  findAlternativeOutput,
  nextChannel,
  passesInputChannelFilter,
  captureLearnFromMessage,
} from "../midiRouting";

// Helper: shape mimics what `refreshDevices` puts on the state arrays.
function dev(name, manufacturer = "Test Maker", id = `${name}-${manufacturer}`) {
  return { id, name, manufacturer };
}

// ── isSameMidiDevice ────────────────────────────────────────────────────────

describe("isSameMidiDevice", () => {
  it("matches when name and manufacturer both match", () => {
    const input = dev("Deluge Port 1", "Synthstrom Audible", "input-1");
    const output = dev("Deluge Port 1", "Synthstrom Audible", "output-1");
    // Note distinct ids — Web MIDI assigns separate ids to the in/out sides.
    expect(isSameMidiDevice(input, output)).toBe(true);
  });

  it("does not match when names differ (e.g. Port 1 vs Port 2)", () => {
    const input = dev("Deluge Port 1", "Synthstrom Audible");
    const output = dev("Deluge Port 2", "Synthstrom Audible");
    expect(isSameMidiDevice(input, output)).toBe(false);
  });

  it("does not match when manufacturers differ (same name, different brand)", () => {
    const input = dev("USB MIDI", "Vendor A");
    const output = dev("USB MIDI", "Vendor B");
    expect(isSameMidiDevice(input, output)).toBe(false);
  });

  it("returns false when either argument is null/undefined", () => {
    const d = dev("X");
    expect(isSameMidiDevice(null, d)).toBe(false);
    expect(isSameMidiDevice(d, null)).toBe(false);
    expect(isSameMidiDevice(null, null)).toBe(false);
    expect(isSameMidiDevice(undefined, d)).toBe(false);
  });

  it("matches regardless of id values (the bug fix this helper was created for)", () => {
    // Web MIDI gives "input-port-abc-123" and "output-port-abc-456" for the
    // same hardware. We must not be tricked by the id difference.
    const a = { id: "input-port-abc-123", name: "Foo", manufacturer: "Bar" };
    const b = { id: "output-port-abc-456", name: "Foo", manufacturer: "Bar" };
    expect(isSameMidiDevice(a, b)).toBe(true);
  });
});

// ── findAlternativeOutput ───────────────────────────────────────────────────

describe("findAlternativeOutput", () => {
  it("returns the first output that doesn't match the input device", () => {
    const inputDev = dev("Deluge Port 1", "Synthstrom Audible");
    const outputs = [
      dev("Deluge Port 1", "Synthstrom Audible"),
      dev("Deluge Port 2", "Synthstrom Audible"),
      dev("Hydrasynth", "ASM"),
    ];
    const alt = findAlternativeOutput(outputs, inputDev);
    expect(alt.name).toBe("Deluge Port 2");
  });

  it("skips multiple matching outputs to find the first non-matching one", () => {
    // Some virtual MIDI drivers expose the same name multiple times.
    const inputDev = dev("Loopback", "Virtual");
    const outputs = [
      dev("Loopback", "Virtual"),
      dev("Loopback", "Virtual"),
      dev("Real Synth", "ASM"),
    ];
    const alt = findAlternativeOutput(outputs, inputDev);
    expect(alt.name).toBe("Real Synth");
  });

  it("returns the first output when no inputDevice is given (no conflict to avoid)", () => {
    const outputs = [dev("A"), dev("B")];
    expect(findAlternativeOutput(outputs, null).name).toBe("A");
  });

  it("returns null when every output matches the input device", () => {
    const inputDev = dev("Solo Device", "Solo Maker");
    const outputs = [
      dev("Solo Device", "Solo Maker"),
      dev("Solo Device", "Solo Maker"),
    ];
    expect(findAlternativeOutput(outputs, inputDev)).toBeNull();
  });

  it("returns null when outputs is empty", () => {
    expect(findAlternativeOutput([], dev("X"))).toBeNull();
    expect(findAlternativeOutput([], null)).toBeNull();
  });

  it("preserves the original output objects (no mutation)", () => {
    const inputDev = dev("A");
    const outputs = [dev("A"), dev("B")];
    const before = JSON.parse(JSON.stringify(outputs));
    findAlternativeOutput(outputs, inputDev);
    expect(outputs).toEqual(before);
  });
});

// ── nextChannel ─────────────────────────────────────────────────────────────

describe("nextChannel", () => {
  it("returns ch+1 for normal values", () => {
    expect(nextChannel(1)).toBe(2);
    expect(nextChannel(2)).toBe(3);
    expect(nextChannel(8)).toBe(9);
    expect(nextChannel(15)).toBe(16);
  });

  it("wraps 16 back to 1", () => {
    expect(nextChannel(16)).toBe(1);
  });

  it("returns 1 for invalid input (defensive)", () => {
    expect(nextChannel(0)).toBe(1);
    expect(nextChannel(17)).toBe(1);
    expect(nextChannel(-1)).toBe(1);
    expect(nextChannel(1.5)).toBe(1);
    expect(nextChannel(null)).toBe(1);
    expect(nextChannel(undefined)).toBe(1);
    expect(nextChannel("3")).toBe(1);
  });
});

// ── Composition: real-world scenarios ───────────────────────────────────────

describe("scenario: Input Learn captures a device that conflicts with output", () => {
  it("auto-migrate flow: alternative output is preferred over channel bump", () => {
    // Initial state: in & out both on Deluge Port 1 after Input Learn.
    const learnedInput = dev("Deluge Port 1", "Synthstrom Audible");
    const outputs = [
      dev("Deluge Port 1", "Synthstrom Audible"),
      dev("Deluge Port 2", "Synthstrom Audible"),
    ];
    const alt = findAlternativeOutput(outputs, learnedInput);
    expect(alt).not.toBeNull();
    expect(alt.name).toBe("Deluge Port 2");
  });

  it("single-device scenario: no alternative output → fall back to channel bump", () => {
    const learnedInput = dev("Solo MIDI", "Solo Maker");
    const outputs = [dev("Solo MIDI", "Solo Maker")];
    expect(findAlternativeOutput(outputs, learnedInput)).toBeNull();
    // Caller then uses nextChannel to bump.
    expect(nextChannel(2)).toBe(3);
    expect(nextChannel(16)).toBe(1);
  });
});

// ── passesInputChannelFilter ────────────────────────────────────────────────

describe("passesInputChannelFilter", () => {
  it("passes a channel-voice message when its source channel matches the filter", () => {
    // 0x95 = Note On ch 6  (status nibble 0x90 | (6-1) = 0x95)
    expect(passesInputChannelFilter(0x95, 6)).toBe(true);
    // 0x80 = Note Off ch 1
    expect(passesInputChannelFilter(0x80, 1)).toBe(true);
    // 0x9f = Note On ch 16
    expect(passesInputChannelFilter(0x9f, 16)).toBe(true);
  });

  it("blocks a channel-voice message whose source channel differs from the filter", () => {
    expect(passesInputChannelFilter(0x90, 2)).toBe(false); // ch 1 message, filter on ch 2
    expect(passesInputChannelFilter(0x95, 1)).toBe(false); // ch 6 message, filter on ch 1
    expect(passesInputChannelFilter(0x9f, 15)).toBe(false); // ch 16 message, filter on ch 15
  });

  it("passes system messages regardless of filter channel (they have no channel)", () => {
    expect(passesInputChannelFilter(0xf0, 1)).toBe(true);  // sysex start
    expect(passesInputChannelFilter(0xf8, 5)).toBe(true);  // timing clock
    expect(passesInputChannelFilter(0xfa, 10)).toBe(true); // start
    expect(passesInputChannelFilter(0xfe, 16)).toBe(true); // active sensing
  });

  it("works across all message types (note on/off, CC, pitch bend) — filters purely on channel", () => {
    // Same channel (ch 3 = low nibble 2 → status type | 0x02), filter ch 3
    expect(passesInputChannelFilter(0x82, 3)).toBe(true);  // note off ch 3
    expect(passesInputChannelFilter(0x92, 3)).toBe(true);  // note on ch 3
    expect(passesInputChannelFilter(0xb2, 3)).toBe(true);  // CC ch 3
    expect(passesInputChannelFilter(0xe2, 3)).toBe(true);  // pitch bend ch 3
  });
});

// ── captureLearnFromMessage ─────────────────────────────────────────────────

describe("captureLearnFromMessage", () => {
  it("captures channel + deviceId from a note-on", () => {
    // 0x91 = Note On ch 2
    expect(captureLearnFromMessage(0x91, "deluge-port-1")).toEqual({
      channel: 2,
      deviceId: "deluge-port-1",
    });
  });

  it("captures from any channel-voice message type (CC, pitch bend, etc.)", () => {
    expect(captureLearnFromMessage(0xb4, "ctrl")).toEqual({ channel: 5, deviceId: "ctrl" });
    expect(captureLearnFromMessage(0xe0, "ctrl")).toEqual({ channel: 1, deviceId: "ctrl" });
    expect(captureLearnFromMessage(0x8f, "ctrl")).toEqual({ channel: 16, deviceId: "ctrl" });
  });

  it("returns null for system messages (no channel to capture)", () => {
    expect(captureLearnFromMessage(0xf0, "ctrl")).toBeNull(); // sysex
    expect(captureLearnFromMessage(0xf8, "ctrl")).toBeNull(); // clock
    expect(captureLearnFromMessage(0xfe, "ctrl")).toBeNull(); // active sensing
  });

  it("handles a missing deviceId by returning deviceId: null", () => {
    expect(captureLearnFromMessage(0x90, null)).toEqual({ channel: 1, deviceId: null });
    expect(captureLearnFromMessage(0x90, undefined)).toEqual({ channel: 1, deviceId: null });
  });

  it("real-world: capture from a fresh-pressed C4 note-on on channel 2 of Deluge Port 1", () => {
    // statusByte: 0x90 | (2-1) = 0x91 = 145
    // The MIDI IN line for this was: Deluge Port 1 ch 2 [145, 60, 100]
    const result = captureLearnFromMessage(145, "deluge-port-1-input");
    expect(result).toEqual({ channel: 2, deviceId: "deluge-port-1-input" });
  });
});
