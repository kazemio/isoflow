// True-passthrough MIDI router.
// Forwards raw MIDI bytes to an output, rewriting the low nibble of the
// status byte (channel) on channel-voice messages so the host app can
// expose a configurable output channel separate from the input.
// `output` is any object with a `.send(bytes)` method (real MIDIOutput or stub).

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const SYSTEM_MIN = 0xf0;

export function isValidChannel(channel) {
  return Number.isInteger(channel) && channel >= 1 && channel <= 16;
}

export function isChannelVoiceStatus(statusByte) {
  return statusByte >= NOTE_OFF && statusByte < SYSTEM_MIN;
}

// Returns the original byte unchanged for system messages or invalid channels.
export function rewriteChannel(statusByte, channel) {
  if (!isChannelVoiceStatus(statusByte)) return statusByte;
  if (!isValidChannel(channel)) return statusByte;
  return (statusByte & 0xf0) | ((channel - 1) & 0x0f);
}

// Decide whether a message should be forwarded to the output, given the
// loop-detection inputs. Returns false in same-device configurations where
// the echoed message would re-enter the input filter and feed back.
//
//   sameDevice        — input device id === output device id
//   isChannelVoice    — true for status 0x80..0xEF
//   inFilterChannel   — 0 means "All" (omni); otherwise 1..16
//   outChannel        — 1..16
export function shouldForward({ sameDevice, isChannelVoice, inFilterChannel, outChannel }) {
  if (!sameDevice) return true;
  if (!isChannelVoice) return false;        // system messages always loop on same device
  if (inFilterChannel === 0) return false;  // "All" filter would re-accept the echo
  return inFilterChannel !== outChannel;
}

export function buildNoteOff(note, channel) {
  const status = NOTE_OFF | ((channel - 1) & 0x0f);
  return [status, note & 0x7f, 0];
}

export function createMidiPassthrough() {
  // Note numbers currently sounding on the output, so switching device or
  // channel mid-play can release them on the *previous* device/channel.
  const active = new Set();

  return {
    // Forward a raw MIDI message to `output`, rewriting the channel for
    // channel-voice messages. Returns true if anything was sent.
    forward(output, data, channel) {
      if (!output || !data || data.length === 0) return false;
      const statusIn = data[0];
      const op = statusIn & 0xf0;
      const statusOut = rewriteChannel(statusIn, channel);

      const bytes = new Array(data.length);
      bytes[0] = statusOut;
      for (let i = 1; i < data.length; i++) bytes[i] = data[i];
      output.send(bytes);

      // Track note state for hanging-note cleanup on device/channel switch.
      if (data.length >= 3) {
        const note = data[1];
        const velocity = data[2];
        if (op === NOTE_ON && velocity > 0) {
          active.add(note);
        } else if (op === NOTE_OFF || (op === NOTE_ON && velocity === 0)) {
          active.delete(note);
        }
      }

      return true;
    },

    // Release every currently-active note on the given output + channel.
    // Called when switching device or channel.
    flush(output, channel) {
      const flushed = Array.from(active);
      if (output && isValidChannel(channel)) {
        for (const note of flushed) {
          output.send(buildNoteOff(note, channel));
        }
      }
      active.clear();
      return flushed;
    },

    getActiveNotes() {
      return Array.from(active);
    },
  };
}
