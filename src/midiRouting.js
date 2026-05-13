import { isChannelVoiceStatus } from "./midiOutput";

// Pure helpers for MIDI device & channel routing decisions in IsoFlow.
//
// Web MIDI exposes the input and output halves of the same physical device
// under SEPARATE ids (e.g. an input id like "abc-123" and an output id like
// "abc-456" can refer to the same Deluge port). Matching by `id` therefore
// cannot detect "this is the same device on both sides." We compare by
// `name` + `manufacturer` instead, which is the only reliable cross-port
// identifier.

export function isSameMidiDevice(deviceA, deviceB) {
  if (!deviceA || !deviceB) return false;
  return (
    deviceA.name === deviceB.name &&
    deviceA.manufacturer === deviceB.manufacturer
  );
}

// Pick the first output device that is NOT the same physical device as
// `inputDevice`. Used when:
//   1. Choosing an initial default output on first MIDI access.
//   2. Auto-migrating the output after the input changes (e.g. Input Learn
//      captures a device that happens to match the current output).
//
// Returns null if `outputs` is empty. If `inputDevice` is null, returns the
// first output (no conflict to avoid).
export function findAlternativeOutput(outputs, inputDevice) {
  if (!outputs || outputs.length === 0) return null;
  if (!inputDevice) return outputs[0];
  const alt = outputs.find((o) => !isSameMidiDevice(o, inputDevice));
  return alt ?? null;
}

// Returns the next MIDI channel in 1..16, wrapping back to 1 after 16.
// Invalid input falls back to 1 — defensive only; callers always pass a
// valid 1..16 value.
export function nextChannel(channel) {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return 1;
  return channel === 16 ? 1 : channel + 1;
}

// Returns true if a MIDI message should pass the user's input channel
// filter. System messages (status >= 0xF0) have no channel and always pass.
// Channel-voice messages pass only when their source channel matches
// `filterChannel` (1..16).
export function passesInputChannelFilter(statusByte, filterChannel) {
  if (!isChannelVoiceStatus(statusByte)) return true;
  const messageChannel = (statusByte & 0x0f) + 1;
  return messageChannel === filterChannel;
}

// When Input Learn is armed, the first incoming channel-voice message
// determines both the device and the channel IsoFlow should listen on.
// Given a status byte and the id of the input port the message came from,
// returns `{ channel, deviceId }` to apply, or null if the message is a
// system message (no channel — can't be used for learn).
export function captureLearnFromMessage(statusByte, deviceId) {
  if (!isChannelVoiceStatus(statusByte)) return null;
  return {
    channel: (statusByte & 0x0f) + 1,
    deviceId: deviceId ?? null,
  };
}
