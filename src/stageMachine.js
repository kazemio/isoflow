import {
  samePitchSet,
  sameNoteSet,
  bestMapping,
  generateGuideCandidates,
} from "./musicUtils";
import {
  evaluateVoiceLeading,
  pairGuidesByNoteName,
  suggestGuideTarget,
} from "./voicingUtils";

// Pure stage-check entry point. Given the current stage and selection state
// (with all cells pre-resolved through any MIDI-registry mapping), returns
// the verdict + UI feedback + any side-effect payload for FILL_CHORD success.
//
// Inputs:
//   stageKey         "START_CHORD" | "IDENTIFY_GUIDES" | "MOVE_GUIDES" | "FILL_CHORD"
//   fromChord        { tones: string[], guide: string[] }
//   toChord          same shape
//   fromSymbol       "ii" / "V" / etc. (used in feedback strings)
//   toSymbol         same
//   keyCenter        "C" / "G" / etc. (feedback strings)
//   mode             "learn" | "play"  (only changes FILL_CHORD assembly + body text)
//   midiPlayMode     bool (selects MOVE_GUIDES strictness model)
//   selection        cells the user is currently building for this stage
//   startVoicing     cells of the previously-built source chord (FILL_CHORD scoring)
//   startGuides      cells the user identified at IDENTIFY_GUIDES (MOVE_GUIDES anchor)
//   movedGuides      cells of the locked guide-tone resolution (FILL_CHORD assembly)
//   selected         non-guide cells in the FILL_CHORD learn-mode build
//   layoutMidiRange  { midiMin, midiMax } — bounds the optimal-candidate search
//
// Returns:
//   { ok, feedback, pendingDestination?, transitionSummary?, transitionGrade? }
//   - feedback is { type, title, body? } or null (silent — keep existing UI state).
//   - pendingDestination/transitionSummary/transitionGrade are only present on
//     successful FILL_CHORD; the caller mirrors them into React state.
export function checkStage({
  stageKey,
  fromChord,
  toChord,
  fromSymbol,
  toSymbol,
  keyCenter,
  mode,
  midiPlayMode,
  selection,
  startVoicing,
  startGuides,
  movedGuides,
  selected,
  layoutMidiRange,
}) {
  if (stageKey === "START_CHORD") return checkStartChord({
    selection, fromChord, fromSymbol, keyCenter,
  });

  if (stageKey === "IDENTIFY_GUIDES") return checkIdentifyGuides({
    selection, startVoicing, fromChord, fromSymbol, keyCenter,
  });

  if (stageKey === "MOVE_GUIDES") return checkMoveGuides({
    selection, startGuides, fromChord, toChord, toSymbol, keyCenter,
    midiPlayMode, layoutMidiRange,
  });

  if (stageKey === "FILL_CHORD") return checkFillChord({
    selection, startVoicing, movedGuides, selected, mode,
    toChord, toSymbol, keyCenter,
  });

  return { ok: false, feedback: null };
}

function checkStartChord({ selection, fromChord, fromSymbol, keyCenter }) {
  const ok = selection.length === 4 && samePitchSet(selection, fromChord.tones);
  return {
    ok,
    feedback: ok
      ? { type: "good", title: "Great.", body: "Now identify its guide tones: the 3rd and 7th." }
      : { type: "bad", title: "Not the starting chord.", body: `Expected ${fromSymbol} in ${keyCenter}: ${fromChord.tones.join(" · ")}.` },
  };
}

function checkIdentifyGuides({ selection, startVoicing, fromChord, fromSymbol, keyCenter }) {
  // Each currently-selected cell must come from the starting voicing — match
  // by id first, then by MIDI (the user may have re-pressed a registered MIDI
  // note that maps to a different cell id).
  const selectedInsideVoicing = selection.every((cell) =>
    startVoicing.some((v) => v.id === cell.id || (v.midi != null && v.midi === cell.midi))
  );
  const ok = selectedInsideVoicing && selection.length === 2 && samePitchSet(selection, fromChord.guide);
  return {
    ok,
    feedback: ok
      ? { type: "good", title: "Correct.", body: `${fromSymbol} guide tones: ${fromChord.guide.join(" and ")}.` }
      : {
          type: "bad",
          title: "Wrong guide tones.",
          body: selectedInsideVoicing
            ? `The guide tones are the 3rd and 7th: ${fromChord.guide.join(" · ")}.`
            : "Guide tones must come from the starting voicing you just built.",
        },
  };
}

function checkMoveGuides({
  selection, startGuides, fromChord, toChord, toSymbol, keyCenter,
  midiPlayMode, layoutMidiRange,
}) {
  // Stay silent while the user still holds the source guides — they haven't
  // attempted a resolution yet. EXCEPTION: when source and destination guide
  // sets are identical (e.g. I → I), holding the source guides IS the correct
  // answer; falling through lets the normal scoring path grade it.
  const guideSetsIdentical = sameNoteSet(fromChord.guide, toChord.guide);
  if (!guideSetsIdentical && samePitchSet(selection, fromChord.guide)) {
    return { ok: false, feedback: null };
  }
  const correctNotes = samePitchSet(selection, toChord.guide);

  return midiPlayMode
    ? checkMoveGuidesMidi({ selection, startGuides, correctNotes, toChord, toSymbol, keyCenter })
    : checkMoveGuidesMouse({ startGuides, movedGuides: selection, correctNotes, toChord, toSymbol, keyCenter, layoutMidiRange });
}

// MIDI play mode: per-voice strictness. Each guide tone must stay (0) or
// move by step (≤ 2 semitones), pair-matched by note name first.
function checkMoveGuidesMidi({ selection, startGuides, correctNotes, toChord, toSymbol, keyCenter }) {
  if (!correctNotes) {
    return {
      ok: false,
      feedback: { type: "bad", title: "Wrong destination guide tones.", body: `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}.` },
    };
  }

  const mapping = pairGuidesByNoteName(startGuides, selection);
  const ok = mapping !== null && mapping.maxJump <= 2;

  if (!ok) {
    const badPair = mapping?.pairs.find((p) => Math.abs((p.from.midi ?? 0) - (p.to.midi ?? 0)) > 2);
    if (badPair) {
      const octave = (m) => (m != null ? Math.floor(m / 12) - 1 : "");
      const fromMidi = badPair.from.midi ?? 60;
      const toMidi = badPair.to.midi ?? 0;
      const fromLabel = `${badPair.from.note}${octave(fromMidi)}`;
      const toLabel = `${badPair.to.note}${octave(toMidi)}`;
      const interval = Math.abs(fromMidi - toMidi);
      const direction = toMidi > fromMidi ? "up" : "down";
      const correctTarget = suggestGuideTarget(fromMidi, toChord.guide);
      const correctLabel = correctTarget
        ? `${correctTarget.note}${octave(correctTarget.midi)}`
        : toChord.guide.join(" or ");
      const isCommonTone = correctTarget && correctTarget.midi === fromMidi;
      const suggestion = isCommonTone ? `stay on ${fromLabel}` : `try ${correctLabel}`;
      return {
        ok: false,
        feedback: { type: "bad", title: `${fromLabel} jumped ${interval} semitone${interval !== 1 ? "s" : ""} ${direction} to ${toLabel} — ${suggestion}.` },
      };
    }
    return {
      ok: false,
      feedback: { type: "bad", title: "Guide tone moved too far.", body: "Each guide tone must stay or move by step (half or whole)." },
    };
  }

  const stayed = mapping.pairs.filter((p) => p.from.midi === p.to.midi).length;
  const stayText = stayed > 0 ? ` ${stayed} stayed put.` : "";
  const rating = mapping.total <= 1 ? "optimal" : mapping.total <= 3 ? "good" : "could be improved";
  return {
    ok: true,
    feedback: {
      type: rating === "optimal" ? "good" : "okay",
      title: rating === "optimal" ? "Perfect." : rating === "good" ? "Good movement." : "Correct — could be tighter.",
      body: `Guide tones resolved correctly.${stayText} Total: ${mapping.total} semitone${mapping.total !== 1 ? "s" : ""}.`,
    },
  };
}

// Mouse mode: tolerance against the theoretical optimum. bestMapping permutes
// freely; the exercise grades total motion against the best-possible voicing
// for the destination guide pitch set within the layout's MIDI range.
function checkMoveGuidesMouse({ startGuides, movedGuides, correctNotes, toChord, toSymbol, keyCenter, layoutMidiRange }) {
  const mapping = startGuides.length === 2 && movedGuides.length === 2 ? bestMapping(startGuides, movedGuides) : null;
  const guideCandidates = generateGuideCandidates(startGuides, toChord.guide, layoutMidiRange);

  let optimal = null;
  for (const candidate of guideCandidates) {
    const solved = bestMapping(startGuides, candidate);
    if (!optimal || solved.score < optimal.score) optimal = solved;
  }

  const extra = mapping && optimal ? mapping.total - optimal.total : null;
  const ok = correctNotes && extra !== null && extra <= 2.5;
  const stayed = mapping?.pairs.filter((pair) => pair.from.id === pair.to.id).length ?? 0;
  const stayText = stayed > 0 ? ` ${stayed} voice${stayed === 1 ? "" : "s"} stayed put.` : "";

  if (ok) {
    return {
      ok: true,
      feedback: {
        type: extra <= 0.25 ? "good" : "okay",
        title: extra <= 0.25 ? "Nice." : "Correct — could be tighter.",
        body: `Movement ${mapping.total.toFixed(1)}. Best possible ${optimal.total.toFixed(1)}.${stayText}`,
      },
    };
  }
  return {
    ok: false,
    feedback: {
      type: "bad",
      title: correctNotes ? "Correct — too much motion." : "Wrong destination guide tones.",
      body: correctNotes
        ? `Movement ${mapping?.total.toFixed(1)}. Best possible ${optimal?.total.toFixed(1)}. A guide tone can stay if it is already in the next guide-tone set.`
        : `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}. One voice may stay if already correct.`,
    },
  };
}

function checkFillChord({ selection, startVoicing, movedGuides, selected, mode, toChord, toSymbol, keyCenter }) {
  const combined = mode === "play" ? selection : [...movedGuides, ...selected];
  const pitchOk = combined.length === 4 && samePitchSet(combined, toChord.tones);

  if (!pitchOk) {
    return {
      ok: false,
      feedback: {
        type: "bad",
        title: "Chord not complete.",
        body: mode === "play"
          ? `Expected ${toSymbol} in ${keyCenter}: ${toChord.tones.join(" · ")}.`
          : `Expected ${toSymbol} in ${keyCenter}: ${toChord.tones.join(" · ")}. The orange guide tones are already included; add the other two tones.`,
      },
    };
  }

  const score = evaluateVoiceLeading(startVoicing, combined);
  const grade = (score.classification === "Optimal" || score.classification === "Good") ? "good" : "okay";

  return {
    ok: true,
    feedback: null,
    pendingDestination: combined,
    transitionSummary: score.feedback ?? "Smooth.",
    transitionGrade: grade,
  };
}
