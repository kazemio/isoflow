import {
  NOTES,
  samePitchSet,
  distance,
  bestMapping,
  generateGuideCandidates,
} from "./musicUtils";

// ── START_CHORD ──────────────────────────────────────────────────────────────

export function checkStartChord(selectedCells, fromChordTones) {
  return selectedCells.length === 4 && samePitchSet(selectedCells, fromChordTones);
}

// ── IDENTIFY_GUIDES ──────────────────────────────────────────────────────────

// withMidiFn maps a cell to { ...cell, midi } using the caller's registry.
// Pass identity (c => c) when cells already carry a .midi field.
export function checkIdentifyGuides(selectedCells, startVoicing, fromChordGuide, withMidiFn = (c) => c) {
  const selectedInsideVoicing = selectedCells.every((cell) => {
    const cellMidi = withMidiFn(cell).midi;
    return startVoicing.some((v) => {
      if (v.id === cell.id) return true;
      const vMidi = withMidiFn(v).midi;
      return vMidi != null && vMidi === cellMidi;
    });
  });
  return selectedInsideVoicing && selectedCells.length === 2 && samePitchSet(selectedCells, fromChordGuide);
}

// ── MOVE_GUIDES (MIDI mode) ──────────────────────────────────────────────────

// startGuides and currentCells must carry a .midi field.
// Returns { ok, mapping } where mapping is { pairs, total, maxJump } or null.
export function checkMoveGuidesMidi(startGuides, currentCells, toChordGuide) {
  if (!samePitchSet(currentCells, toChordGuide)) return { ok: false, mapping: null };

  const sg = startGuides;
  const mg = currentCells;
  if (sg.length !== 2 || mg.length !== 2) return { ok: false, mapping: null };

  const unmatched = [...mg];
  const pairs = [];

  // Pass 1: same note name (common tone or step resolution by name)
  for (const from of sg) {
    const idx = unmatched.findIndex((t) => t.note === from.note);
    if (idx >= 0) pairs.push({ from, to: unmatched.splice(idx, 1)[0] });
  }

  // Pass 2: remaining voices by MIDI proximity
  const leftFrom = sg.filter((f) => !pairs.find((p) => p.from.id === f.id));
  for (const from of leftFrom) {
    const fMidi = from.midi ?? 0;
    unmatched.sort((a, b) => Math.abs((a.midi ?? 0) - fMidi) - Math.abs((b.midi ?? 0) - fMidi));
    if (unmatched.length) pairs.push({ from, to: unmatched.shift() });
  }

  if (pairs.length !== 2) return { ok: false, mapping: null };

  const dists = pairs.map((p) => {
    const a = p.from.midi, b = p.to.midi;
    return a != null && b != null ? Math.abs(a - b) : distance(p.from, p.to);
  });

  const mapping = {
    pairs: pairs.map((p, i) => ({ ...p, distance: dists[i] })),
    total: dists.reduce((s, d) => s + d, 0),
    maxJump: Math.max(...dists),
  };

  return { ok: mapping.maxJump <= 2, mapping };
}

// ── MOVE_GUIDES (grid / mouse mode) ─────────────────────────────────────────

export function checkMoveGuidesGrid(startGuides, movedGuides, toChordGuide, grid) {
  const correctNotes = samePitchSet(movedGuides, toChordGuide);
  if (!correctNotes) return { ok: false, correctNotes: false, mapping: null, optimal: null };

  const mapping = startGuides.length === 2 && movedGuides.length === 2
    ? bestMapping(startGuides, movedGuides)
    : null;

  const guideCandidates = generateGuideCandidates(startGuides, toChordGuide, grid);
  let optimal = null;
  for (const candidate of guideCandidates) {
    const solved = bestMapping(startGuides, candidate);
    if (!optimal || solved.score < optimal.score) optimal = solved;
  }

  const extra = mapping && optimal ? mapping.total - optimal.total : null;
  const ok = extra !== null && extra <= 2.5;

  return { ok, correctNotes, mapping, optimal };
}

// ── FILL_CHORD ───────────────────────────────────────────────────────────────

export function checkFillChord(movedGuides, selectedExtra, toChordTones, mode = "learn") {
  const combined = mode === "play" ? selectedExtra : [...movedGuides, ...selectedExtra];
  return combined.length === 4 && samePitchSet(combined, toChordTones);
}

// Returns false (widerVoicing) when any extra tone is more than maxInterval
// semitones away from every guide tone.  null MIDI values are treated as ok.
export function checkRegister(extraToneMidis, guideMidis, maxInterval = 12) {
  if (guideMidis.length === 0) return true;
  return extraToneMidis.every(
    (m) => m == null || guideMidis.some((gm) => Math.abs(m - gm) <= maxInterval)
  );
}
