import { describe, it, expect } from "vitest";
import {
  isValidChannel,
  isChannelVoiceStatus,
  rewriteChannel,
  buildNoteOff,
  createMidiPassthrough,
  shouldForward,
  isForwardableMessage,
} from "../midiOutput";

function makeOutputStub() {
  const sent = [];
  return {
    send(bytes) { sent.push([...bytes]); },
    sent,
  };
}

// ── isValidChannel ──────────────────────────────────────────────────────────

describe("isValidChannel", () => {
  it("accepts 1..16", () => {
    expect(isValidChannel(1)).toBe(true);
    expect(isValidChannel(16)).toBe(true);
  });
  it("rejects 0, 17, fractional, null", () => {
    expect(isValidChannel(0)).toBe(false);
    expect(isValidChannel(17)).toBe(false);
    expect(isValidChannel(1.5)).toBe(false);
    expect(isValidChannel(null)).toBe(false);
  });
});

// ── isChannelVoiceStatus ────────────────────────────────────────────────────

describe("isChannelVoiceStatus", () => {
  it("accepts 0x80..0xEF", () => {
    expect(isChannelVoiceStatus(0x80)).toBe(true);
    expect(isChannelVoiceStatus(0x90)).toBe(true);
    expect(isChannelVoiceStatus(0xb0)).toBe(true);
    expect(isChannelVoiceStatus(0xef)).toBe(true);
  });
  it("rejects system messages 0xF0+", () => {
    expect(isChannelVoiceStatus(0xf0)).toBe(false); // sysex start
    expect(isChannelVoiceStatus(0xf8)).toBe(false); // timing clock
    expect(isChannelVoiceStatus(0xfe)).toBe(false); // active sense
  });
  it("rejects data bytes < 0x80", () => {
    expect(isChannelVoiceStatus(0x7f)).toBe(false);
    expect(isChannelVoiceStatus(0)).toBe(false);
  });
});

// ── rewriteChannel ──────────────────────────────────────────────────────────

describe("rewriteChannel", () => {
  it("rewrites the low nibble of channel-voice messages", () => {
    expect(rewriteChannel(0x90, 1)).toBe(0x90);  // ch 1
    expect(rewriteChannel(0x90, 5)).toBe(0x94);  // ch 5
    expect(rewriteChannel(0x90, 16)).toBe(0x9f); // ch 16
  });
  it("preserves the message type (high nibble)", () => {
    expect(rewriteChannel(0x80, 7)).toBe(0x86); // note off ch 7
    expect(rewriteChannel(0xb0, 7)).toBe(0xb6); // CC ch 7
    expect(rewriteChannel(0xe0, 7)).toBe(0xe6); // pitch bend ch 7
  });
  it("ignores any existing channel bits in the input status byte", () => {
    expect(rewriteChannel(0x9f, 1)).toBe(0x90);
    expect(rewriteChannel(0x95, 16)).toBe(0x9f);
  });
  it("leaves system messages untouched", () => {
    expect(rewriteChannel(0xf0, 5)).toBe(0xf0);
    expect(rewriteChannel(0xf8, 5)).toBe(0xf8);
  });
  it("leaves channel-voice messages untouched if channel is invalid", () => {
    expect(rewriteChannel(0x90, 0)).toBe(0x90);
    expect(rewriteChannel(0x90, 17)).toBe(0x90);
    expect(rewriteChannel(0x90, null)).toBe(0x90);
  });
});

// ── buildNoteOff ────────────────────────────────────────────────────────────

describe("buildNoteOff", () => {
  it("produces correct bytes for ch 1 and ch 16", () => {
    expect(buildNoteOff(60, 1)).toEqual([0x80, 60, 0]);
    expect(buildNoteOff(60, 16)).toEqual([0x8f, 60, 0]);
  });
});

// ── shouldForward (loop guard) ──────────────────────────────────────────────

describe("shouldForward", () => {
  it("forwards when input and output are different devices", () => {
    expect(shouldForward({
      sameDevice: false, isChannelVoice: true, inFilterChannel: 0, outChannel: 1,
    })).toBe(true);
    expect(shouldForward({
      sameDevice: false, isChannelVoice: true, inFilterChannel: 1, outChannel: 1,
    })).toBe(true);
    expect(shouldForward({
      sameDevice: false, isChannelVoice: false, inFilterChannel: 0, outChannel: 1,
    })).toBe(true);
  });

  it("blocks same-device + 'All' input filter (omni accepts the echo)", () => {
    expect(shouldForward({
      sameDevice: true, isChannelVoice: true, inFilterChannel: 0, outChannel: 1,
    })).toBe(false);
  });

  it("blocks same-device + same channel (filter accepts the echo)", () => {
    expect(shouldForward({
      sameDevice: true, isChannelVoice: true, inFilterChannel: 1, outChannel: 1,
    })).toBe(false);
    expect(shouldForward({
      sameDevice: true, isChannelVoice: true, inFilterChannel: 16, outChannel: 16,
    })).toBe(false);
  });

  it("allows same-device + different channels (filter rejects the echo)", () => {
    expect(shouldForward({
      sameDevice: true, isChannelVoice: true, inFilterChannel: 1, outChannel: 2,
    })).toBe(true);
    expect(shouldForward({
      sameDevice: true, isChannelVoice: true, inFilterChannel: 5, outChannel: 12,
    })).toBe(true);
  });

  it("blocks same-device system messages (no channel, always loops)", () => {
    expect(shouldForward({
      sameDevice: true, isChannelVoice: false, inFilterChannel: 1, outChannel: 2,
    })).toBe(false);
    expect(shouldForward({
      sameDevice: true, isChannelVoice: false, inFilterChannel: 0, outChannel: 1,
    })).toBe(false);
  });
});

// ── createMidiPassthrough.forward ───────────────────────────────────────────

describe("createMidiPassthrough.forward", () => {
  it("forwards a note-on and rewrites the channel", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    // Incoming note-on on channel 1 → forward to channel 5
    const ok = pass.forward(out, [0x90, 60, 100], 5);

    expect(ok).toBe(true);
    expect(out.sent).toEqual([[0x94, 60, 100]]);
    expect(pass.getActiveNotes()).toEqual([60]);
  });

  it("forwards a note-off and removes the note from the active set", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1);
    pass.forward(out, [0x80, 60, 0], 1);

    expect(out.sent).toEqual([
      [0x90, 60, 100],
      [0x80, 60, 0],
    ]);
    expect(pass.getActiveNotes()).toEqual([]);
  });

  it("treats note-on with velocity 0 as note-off (running-status convention)", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1);
    pass.forward(out, [0x90, 60, 0], 1);

    expect(pass.getActiveNotes()).toEqual([]);
    // Bytes are forwarded verbatim (still note-on with vel 0, not rewritten to 0x80)
    expect(out.sent.at(-1)).toEqual([0x90, 60, 0]);
  });

  it("forwards control-change (sustain pedal) without affecting active notes", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1); // note on
    pass.forward(out, [0xb0, 64, 127], 1); // sustain pedal down (CC64)
    pass.forward(out, [0xb0, 64, 0], 1);   // sustain pedal up

    expect(out.sent).toEqual([
      [0x90, 60, 100],
      [0xb0, 64, 127],
      [0xb0, 64, 0],
    ]);
    expect(pass.getActiveNotes()).toEqual([60]); // CC didn't disturb tracking
  });

  it("forwards pitch bend with channel rewrite", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0xe0, 0, 64], 3); // centered pitch bend on ch 1 → ch 3

    expect(out.sent).toEqual([[0xe2, 0, 64]]);
  });

  it("forwards program change (2-byte message) with channel rewrite", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0xc0, 42], 4); // program change → ch 4

    expect(out.sent).toEqual([[0xc3, 42]]);
  });

  it("forwards system messages unchanged (clock, active sensing)", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0xf8], 5);  // timing clock — no channel
    pass.forward(out, [0xfe], 5);  // active sensing

    expect(out.sent).toEqual([[0xf8], [0xfe]]);
  });

  it("strips the source channel and replaces it with the configured output channel", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    // Source sends note-on on channel 9 (status 0x98)
    pass.forward(out, [0x98, 60, 100], 1);

    // Output should be channel 1 (status 0x90)
    expect(out.sent).toEqual([[0x90, 60, 100]]);
  });

  it("returns false and sends nothing when output is null", () => {
    const pass = createMidiPassthrough();
    expect(pass.forward(null, [0x90, 60, 100], 1)).toBe(false);
    expect(pass.getActiveNotes()).toEqual([]);
  });

  it("returns false for empty data", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();
    expect(pass.forward(out, [], 1)).toBe(false);
    expect(pass.forward(out, null, 1)).toBe(false);
    expect(out.sent).toEqual([]);
  });

  it("accepts Uint8Array data (the type Web MIDI actually delivers)", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, new Uint8Array([0x90, 60, 100]), 5);

    expect(out.sent).toEqual([[0x94, 60, 100]]);
  });

  it("does not mutate the source buffer", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();
    const data = new Uint8Array([0x90, 60, 100]);

    pass.forward(out, data, 16);

    expect(Array.from(data)).toEqual([0x90, 60, 100]);
  });
});

// ── createMidiPassthrough.flush ─────────────────────────────────────────────

describe("createMidiPassthrough.flush", () => {
  it("sends note-off for every active note on the given channel", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1);
    pass.forward(out, [0x90, 64, 100], 1);
    pass.forward(out, [0x90, 67, 100], 1);
    out.sent.length = 0;

    const flushed = pass.flush(out, 1);

    expect(flushed.sort()).toEqual([60, 64, 67]);
    expect(out.sent).toEqual(
      expect.arrayContaining([
        [0x80, 60, 0],
        [0x80, 64, 0],
        [0x80, 67, 0],
      ])
    );
    expect(out.sent.length).toBe(3);
    expect(pass.getActiveNotes()).toEqual([]);
  });

  it("uses the passed channel — releases on the OLD channel during a switch", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1); // started on ch 1
    out.sent.length = 0;

    pass.flush(out, 1); // released on ch 1 (passed before switching to new channel)

    expect(out.sent).toEqual([[0x80, 60, 0]]);
  });

  it("clears active notes even when output is null (e.g. device unplugged)", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    pass.forward(out, [0x90, 60, 100], 1);
    const flushed = pass.flush(null, 1);

    expect(flushed).toEqual([60]);
    expect(pass.getActiveNotes()).toEqual([]);
  });

  it("does nothing when nothing is held", () => {
    const pass = createMidiPassthrough();
    const out = makeOutputStub();

    const flushed = pass.flush(out, 1);

    expect(flushed).toEqual([]);
    expect(out.sent).toEqual([]);
  });
});

// ── isForwardableMessage (performance-only whitelist) ───────────────────────

describe("isForwardableMessage", () => {
  it("allows Note On (status 0x90..0x9F) regardless of channel", () => {
    expect(isForwardableMessage(0x90, 60)).toBe(true);
    expect(isForwardableMessage(0x9f, 60)).toBe(true);
  });

  it("allows Note Off (status 0x80..0x8F)", () => {
    expect(isForwardableMessage(0x80, 60)).toBe(true);
    expect(isForwardableMessage(0x8f, 60)).toBe(true);
  });

  it("allows Pitch Bend (0xE0..0xEF)", () => {
    expect(isForwardableMessage(0xe0, 0)).toBe(true);
    expect(isForwardableMessage(0xef, 64)).toBe(true);
  });

  it("allows Channel Pressure (0xD0..0xDF)", () => {
    expect(isForwardableMessage(0xd0, 90)).toBe(true);
    expect(isForwardableMessage(0xdf, 12)).toBe(true);
  });

  it("allows CC #64 (sustain pedal) only", () => {
    expect(isForwardableMessage(0xb0, 64)).toBe(true);
    expect(isForwardableMessage(0xbf, 64)).toBe(true);
  });

  it("blocks all other CCs (the Deluge parameter-dump chatter)", () => {
    // CC numbers seen in the Deluge state dump: 3, 5, 7, 10, 12, 13, …
    expect(isForwardableMessage(0xb0, 3)).toBe(false);
    expect(isForwardableMessage(0xb0, 5)).toBe(false);
    expect(isForwardableMessage(0xb0, 7)).toBe(false);
    expect(isForwardableMessage(0xb0, 1)).toBe(false);   // mod wheel — also blocked
    expect(isForwardableMessage(0xb0, 11)).toBe(false);  // expression — also blocked
    expect(isForwardableMessage(0xb0, 63)).toBe(false);  // adjacent to sustain
    expect(isForwardableMessage(0xb0, 65)).toBe(false);  // adjacent to sustain
  });

  it("blocks Program Change (0xC0..0xCF)", () => {
    expect(isForwardableMessage(0xc0, 42)).toBe(false);
    expect(isForwardableMessage(0xcf, 0)).toBe(false);
  });

  it("blocks Poly Aftertouch (0xA0..0xAF)", () => {
    expect(isForwardableMessage(0xa0, 60)).toBe(false);
  });

  it("allows System messages (status 0xF0+) — clock, sysex, transport", () => {
    expect(isForwardableMessage(0xf0, 0)).toBe(true);  // sysex start
    expect(isForwardableMessage(0xf8, 0)).toBe(true);  // timing clock
    expect(isForwardableMessage(0xfa, 0)).toBe(true);  // start
    expect(isForwardableMessage(0xfe, 0)).toBe(true);  // active sensing
  });

  it("real-world scenario: Deluge parameter dump is fully blocked", () => {
    // Sequence pulled from an actual Deluge clip-select state dump.
    const dump = [
      [0xb0, 3, 64], [0xb0, 5, 0], [0xb0, 7, 127], [0xb0, 10, 64],
      [0xb0, 12, 64], [0xb0, 13, 64], [0xb0, 14, 64], [0xb0, 15, 64],
      [0xb0, 50, 64], [0xb0, 74, 72], [0xb0, 113, 0],
    ];
    for (const [status, data1] of dump) {
      expect(isForwardableMessage(status, data1)).toBe(false);
    }
  });

  it("real-world scenario: a held note with sustain pedal flows through", () => {
    // Press: note-on. Pedal down. Release key. Pedal up.
    const stream = [
      [0x90, 60, 100, "note-on"],
      [0xb0, 64, 127, "sustain on"],
      [0x80, 60, 0, "note-off"],
      [0xb0, 64, 0, "sustain off"],
    ];
    for (const [status, data1] of stream) {
      expect(isForwardableMessage(status, data1)).toBe(true);
    }
  });
});
