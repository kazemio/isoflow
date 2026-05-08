import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Github, Settings } from "lucide-react";
import { SettingsDrawer } from "./SettingsDrawer";
import { scoreVoiceLeadingTransition } from "./voiceLeadingScore";
import { resolveMidiCell as resolveMidiCellPure } from "./midiResolution";
import { createMidiPassthrough, shouldForward } from "./midiOutput";
import {
  NOTES,
  MAJOR_KEYS,
  DEGREE_FORMULAS,
  PROGRESSION_OPTIONS,
  STAGES,
  MIDI_BASE_NOTE,
  MIDI_OFFSET,
  PIANO_MIDI_START,
  PIANO_MIDI_END,
  BLACK_PCS,
  PIANO_KEYS,
  PIANO_CELLS,
  normalizeNote,
  noteIndex,
  transposeNote,
  getChordName,
  buildChordsForKey,
  buildGrid,
  buildPianoKeys,
  buildPianoCells,
  getPrevWhiteIndex,
  uniqueNotesFromCells,
  parseProgression,
  generateRandomProgression,
  samePitchSet,
  containsPitchSet,
  distance,
  permutations,
  bestMapping,
  generateGuideCandidates,
} from "./musicUtils";

const SHOW_DEBUG = false;

function App() {
  const GRID = useMemo(() => buildGrid(8, 8, 6), []);

  const [viewMode, setViewMode] = useState("grid");
  const [mode, setMode] = useState("learn"); // "learn" | "play"
  const [keyCenter, setKeyCenter] = useState("C");
  const [customText, setCustomText] = useState("ii V I");

  const [pairIndex, setPairIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);

  const [startVoicing, setStartVoicing] = useState([]);
  const [startGuides, setStartGuides] = useState([]);
  const [movedGuides, setMovedGuides] = useState([]);
  const [selected, setSelected] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [awaitingNextRound, setAwaitingNextRound] = useState(false);
  const [pendingDestination, setPendingDestination] = useState(null);
  const [transitionSummary, setTransitionSummary] = useState(null);

  const midiSupported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  const [midiStatus, setMidiStatus] = useState(midiSupported ? "disconnected" : "unsupported");
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState("");
  const [midiInChannel, setMidiInChannel] = useState(0); // 0 = All (omni), 1-16 specific
  const [midiOutputs, setMidiOutputs] = useState([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState("");
  const [midiOutChannel, setMidiOutChannel] = useState(1); // 1-16
  const [settingsOpen, setSettingsOpen] = useState(false);
  const midiOutRef = useRef(null);
  if (midiOutRef.current === null) midiOutRef.current = createMidiPassthrough();
  const [vlScore, setVlScore] = useState(null);
  const vlTimerRef = useRef(null);
  const lastMidiCellRef = useRef(null);
  const midiAccessRef = useRef(null);
  const midiHandlerRef = useRef(null);
  const midiPressedRef = useRef({});
  const midiNoteOnRef = useRef(null);
  const midiNoteOffRef = useRef(null);
  const midiNoteRegistryRef = useRef({}); // cellId → actual MIDI note pressed
  const registerAnchorRef = useRef(null); // grid cell of root note, set once per chord pair
  const [midiHeldCells, setMidiHeldCells] = useState([]);
  const advanceRef = useRef(null);
  const advanceStageRef = useRef(null);
  const toChordRef = useRef(null);

  const [useOctaveMapping, setUseOctaveMapping] = useState(false);
  const midiPlayMode = Boolean(selectedMidiInputId);

  const chords = useMemo(() => buildChordsForKey(keyCenter), [keyCenter]);

  const progression = useMemo(() => {
    return parseProgression(customText, chords) ?? parseProgression("ii V I", chords);
  }, [customText, chords]);

  const fromSymbol = progression[pairIndex % progression.length];
  const toSymbol = progression[(pairIndex + 1) % progression.length];

  const fromChord = chords[fromSymbol];
  const toChord = chords[toSymbol];
  const stage = STAGES[stageIndex];

  const expectedGuideNotes =
    stage.key === "IDENTIFY_GUIDES"
      ? fromChord.guide
      : toChord.guide;

  const displayTitle = (mode === "play" && stage.key === "FILL_CHORD")
    ? `Voice lead: ${fromSymbol} → ${toSymbol}`
    : stage.title;

  function resetAll(nextKey = keyCenter) {
    setKeyCenter(nextKey);
    setPairIndex(0);
    setStageIndex(0);
    setStartVoicing([]);
    setStartGuides([]);
    setMovedGuides([]);
    setSelected([]);
    setFeedback(null);
    setAwaitingNextRound(false);
    setPendingDestination(null);
    setTransitionSummary(null);
    midiNoteRegistryRef.current = {};
    registerAnchorRef.current = null;
  }

  function activeSelection() {
    if (midiPlayMode) return midiHeldCells;
    if (stage.key === "START_CHORD") return startVoicing;
    if (stage.key === "IDENTIFY_GUIDES") return startGuides;
    if (stage.key === "MOVE_GUIDES") return movedGuides;
    return selected;
  }

  function setActiveSelection(updater) {
    if (stage.key === "START_CHORD") setStartVoicing(updater);
    else if (stage.key === "IDENTIFY_GUIDES") setStartGuides(updater);
    else if (stage.key === "MOVE_GUIDES") setMovedGuides(updater);
    else setSelected(updater);
  }

  function maxSelectionsForStage() {
    if (stage.key === "START_CHORD") return 4;
    if (stage.key === "IDENTIFY_GUIDES") return 2;
    if (stage.key === "FILL_CHORD") return mode === "play" ? 4 : 4 - movedGuides.length;
    return 2;
  }

  function selectableCellsForStage(cell) {
    if (awaitingNextRound) return false;

    if (stage.key === "FILL_CHORD") {
      return !movedGuides.some((c) => c.id === cell.id);
    }

    return true;
  }

  function toggleCell(cell) {
    if (!selectableCellsForStage(cell)) return;

    setFeedback(null);

    setActiveSelection((current) => {
      const exists = current.some((item) => item.id === cell.id);
      if (exists) return current.filter((item) => item.id !== cell.id);
      if (current.length >= maxSelectionsForStage()) return current;
      return [...current, cell];
    });
  }

  function selectCell(cell, options = {}) {
    if (!selectableCellsForStage(cell)) return;
    setFeedback(null);

    setActiveSelection((current) => {
      const exists = current.some((item) => item.id === cell.id);
      if (exists) return current;
      if (!options.ignoreMax && current.length >= maxSelectionsForStage()) return current;
      return [...current, cell];
    });
  }

  function deselectCell(cell) {
    setFeedback(null);
    setActiveSelection((current) => current.filter((item) => item.id !== cell.id));
  }

  function withMidi(cell) {
    const midi =
      midiNoteRegistryRef.current[cell.id] ??
      cell.midi ??
      (cell.pitchClass != null ? cell.pitchClass + MIDI_OFFSET : null);
    return midi != null ? { ...cell, midi } : cell;
  }

  function pickCellForPitchClass(pitchClass) {
    const candidates = GRID.flat().filter((c) => c.pitchClass % 12 === pitchClass);
    if (candidates.length === 0) return null;

    const current = activeSelection();
    const isSelected = (cell) => current.some((item) => item.id === cell.id);

    const last = lastMidiCellRef.current;
    const scored = candidates
      .filter((cell) => selectableCellsForStage(cell))
      .map((cell) => ({
        cell,
        score:
          (isSelected(cell) ? 9999 : 0) +
          (last ? distance(last, cell) : 0)
      }))
      .sort((a, b) => a.score - b.score);

    return scored[0]?.cell ?? null;
  }

  function resolveMidiCell(noteNumber) {
    const cell = resolveMidiCellPure(noteNumber, {
      viewMode,
      pianoCells: PIANO_CELLS,
      grid: GRID,
      useOctaveMapping,
      midiOffset: MIDI_OFFSET,
      anchor: registerAnchorRef.current ?? null,
    });
    // Side-effect: seed the anchor on first proximity-mode resolution.
    if (!registerAnchorRef.current && cell && !useOctaveMapping && viewMode !== "piano") {
      registerAnchorRef.current = cell;
    }
    return cell;
  }

  function refreshMidiHeldCells() {
    const ids = Object.values(midiPressedRef.current || {});
    const allCells = [...GRID.flat(), ...PIANO_CELLS];
    const next = ids.map((id) => allCells.find((c) => c.id === id)).filter(Boolean);
    setMidiHeldCells(next);
  }

  function onMidiNoteOn(noteNumber, velocity) {
    if (velocity <= 0) return; // note-on with velocity 0 is often "note off"

    if (midiPressedRef.current[String(noteNumber)]) return;

    const cell = resolveMidiCell(noteNumber);
    if (!cell) return;

    midiPressedRef.current[String(noteNumber)] = cell.id;
    midiNoteRegistryRef.current[cell.id] = noteNumber;
    lastMidiCellRef.current = cell;
    refreshMidiHeldCells();

    selectCell(cell, { ignoreMax: true });
  }

  function onMidiNoteOff(noteNumber) {
    const id = midiPressedRef.current[String(noteNumber)];
    if (!id) return;
    delete midiPressedRef.current[String(noteNumber)];

    refreshMidiHeldCells();

    const cell = GRID.flat().find((c) => c.id === id) ?? PIANO_CELLS.find((c) => c.id === id);
    if (cell) {
      deselectCell(cell);
    }
  }

  midiNoteOnRef.current = onMidiNoteOn;
  midiNoteOffRef.current = onMidiNoteOff;

  useEffect(() => {
    const access = midiAccessRef.current;
    const prevOutId = selectedMidiOutputId;
    const prevChannel = midiOutChannel;
    return () => {
      const out = prevOutId ? access?.outputs.get(prevOutId) : null;
      midiOutRef.current.flush(out, prevChannel);
    };
  }, [selectedMidiOutputId, midiOutChannel]);

  useEffect(() => {
    if (!midiSupported) return;

    let cancelled = false;

    async function connect() {
      try {
        setMidiStatus("requesting");
        const access = await navigator.requestMIDIAccess();
        if (cancelled) return;
        midiAccessRef.current = access;
        setMidiStatus("disconnected");

        const refreshDevices = () => {
          const nextInputs = Array.from(access.inputs.values()).map((input) => ({
            id: input.id,
            name: input.name || "MIDI input",
            manufacturer: input.manufacturer || ""
          }));
          const nextOutputs = Array.from(access.outputs.values()).map((output) => ({
            id: output.id,
            name: output.name || "MIDI output",
            manufacturer: output.manufacturer || ""
          }));
          setMidiInputs(nextInputs);
          setMidiOutputs(nextOutputs);
          setMidiStatus(nextInputs.length > 0 || nextOutputs.length > 0 ? "connected" : "disconnected");
          setSelectedMidiInputId((currentId) => {
            if (currentId && nextInputs.some((i) => i.id === currentId)) return currentId;
            return nextInputs[0]?.id ?? "";
          });
          setSelectedMidiOutputId((currentId) => {
            if (currentId && nextOutputs.some((o) => o.id === currentId)) return currentId;
            return "";
          });
        };

        refreshDevices();
        access.onstatechange = refreshDevices;
      } catch (err) {
        if (cancelled) return;
        setMidiStatus("error");
        setFeedback({
          type: "bad",
          title: "MIDI unavailable.",
          body: err?.message ? String(err.message) : "Could not access MIDI devices."
        });
      }
    }

    connect();

    return () => {
      cancelled = true;
    };
  }, [midiSupported]);

  useEffect(() => {
    if (midiStatus !== "connected") return;
    const access = midiAccessRef.current;
    if (!access) return;

    const input = selectedMidiInputId ? access.inputs.get(selectedMidiInputId) : null;
    if (!input) return;

    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.length === 0) return;
      const statusByte = data[0];
      const op = statusByte & 0xf0;
      const isChannelVoice = statusByte >= 0x80 && statusByte < 0xf0;

      // Channel filter (channel-voice messages only). System messages bypass.
      if (isChannelVoice && midiInChannel !== 0) {
        const inChannel = (statusByte & 0x0f) + 1;
        if (inChannel !== midiInChannel) return;
      }

      // True passthrough: forward raw bytes (with channel rewrite) to the output,
      // unless doing so would create a feedback loop on the same device.
      if (selectedMidiOutputId && shouldForward({
        sameDevice: selectedMidiInputId === selectedMidiOutputId,
        isChannelVoice,
        inFilterChannel: midiInChannel,
        outChannel: midiOutChannel,
      })) {
        const out = midiAccessRef.current?.outputs.get(selectedMidiOutputId);
        if (out) midiOutRef.current.forward(out, data, midiOutChannel);
      }

      // UI sync: only note-on/note-off drive cell selection.
      if (data.length < 3) return;
      const note = data[1];
      const velocity = data[2];
      if (op === 0x90) {
        if (velocity === 0) midiNoteOffRef.current?.(note);
        else midiNoteOnRef.current?.(note, velocity);
      } else if (op === 0x80) {
        midiNoteOffRef.current?.(note);
      }
    };

    midiHandlerRef.current = onMessage;
    input.onmidimessage = onMessage;

    return () => {
      if (input.onmidimessage === onMessage) input.onmidimessage = null;
    };
  }, [midiStatus, selectedMidiInputId, midiInChannel, selectedMidiOutputId, midiOutChannel]);


  function checkStage() {
    if (stage.key === "START_CHORD") {
      const current = activeSelection();
      const ok = current.length === 4 && samePitchSet(current, fromChord.tones);
      setFeedback(ok
        ? { type: "good", title: "Starting chord identified.", body: "Now identify its guide tones: the 3rd and 7th." }
        : { type: "bad", title: "Not the starting chord.", body: `Expected ${fromSymbol} in ${keyCenter}: ${fromChord.tones.join(" · ")}.` }
      );
      return ok;
    }

    if (stage.key === "IDENTIFY_GUIDES") {
      const current = activeSelection();
      const selectedInsideVoicing = current.every((cell) => {
        const cellMidi = withMidi(cell).midi;
        return startVoicing.some((v) => {
          if (v.id === cell.id) return true;
          const vMidi = withMidi(v).midi;
          return vMidi != null && vMidi === cellMidi;
        });
      });
      const ok = selectedInsideVoicing && current.length === 2 && samePitchSet(current, fromChord.guide);
      setFeedback(ok
        ? { type: "good", title: "Nice.", body: `${fromSymbol} guide tones: ${fromChord.guide.join(" and ")}.` }
        : {
          type: "bad",
          title: "Wrong guide tones.",
          body: selectedInsideVoicing
            ? `The guide tones are the 3rd and 7th: ${fromChord.guide.join(" · ")}.`
            : "Guide tones must come from the starting voicing you just built."

        }
      );
      return ok;
    }

    if (stage.key === "MOVE_GUIDES") {
      const current = activeSelection();

      // If we are still holding the correct guides for the STARTING chord, stay silent.
      // We wait for the user to move towards the destination guides.
      if (samePitchSet(current, fromChord.guide)) {
        return false;
      }
      const correctNotes = samePitchSet(current, toChord.guide);

      if (midiPlayMode) {
        if (!correctNotes) {
          setFeedback({ type: "bad", title: "Wrong destination guide tones.", body: `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}.` });
          return false;
        }

        // Build note-name-aware pairs: match by same note first (common tones),
        // then pair the remaining voices. This avoids MIDI-estimation errors from
        // re-applied cells whose registry value may be stale.
        const sg = startGuides.map(withMidi);
        const mg = current.map(withMidi);
        let mapping = null;
        if (sg.length === 2 && mg.length === 2) {
          const unmatched = [...mg];
          const pairs = [];
          // First pass: same note name (common tone or correct resolution by name)
          for (const from of sg) {
            const idx = unmatched.findIndex((t) => t.note === from.note);
            if (idx >= 0) { pairs.push({ from, to: unmatched.splice(idx, 1)[0] }); }
          }
          // Second pass: remaining voices by MIDI proximity
          const leftFrom = sg.filter((f) => !pairs.find((p) => p.from.id === f.id));
          for (const from of leftFrom) {
            const fMidi = from.midi ?? 0;
            unmatched.sort((a, b) => Math.abs((a.midi ?? 0) - fMidi) - Math.abs((b.midi ?? 0) - fMidi));
            if (unmatched.length) pairs.push({ from, to: unmatched.shift() });
          }
          if (pairs.length === 2) {
            const dists = pairs.map((p) => {
              const a = p.from.midi, b = p.to.midi;
              return a != null && b != null ? Math.abs(a - b) : distance(p.from, p.to);
            });
            mapping = {
              pairs: pairs.map((p, i) => ({ ...p, distance: dists[i] })),
              total: dists.reduce((s, d) => s + d, 0),
              maxJump: Math.max(...dists),
            };
          }
        }

        // Strict: each guide tone must stay (0) or move by step (≤ 2 semitones).
        const ok = mapping !== null && mapping.maxJump <= 2;
        const stayed = mapping?.pairs.filter((p) => p.from.midi === p.to.midi).length ?? 0;
        const stayText = stayed > 0 ? ` ${stayed} stayed put.` : "";

        if (!ok) {
          const badPair = mapping?.pairs.find((p) => Math.abs((p.from.midi ?? 0) - (p.to.midi ?? 0)) > 2);
          if (badPair) {
            const octave = (m) => m != null ? Math.floor(m / 12) - 1 : "";
            const fromLabel = `${badPair.from.note}${octave(badPair.from.midi)}`;
            const toLabel = `${badPair.to.note}${octave(badPair.to.midi)}`;
            const interval = Math.abs((badPair.from.midi ?? 0) - (badPair.to.midi ?? 0));
            const direction = (badPair.to.midi ?? 0) > (badPair.from.midi ?? 0) ? "up" : "down";
            // Find the correct target: nearest destination guide tone to the source note
            const fromMidi = badPair.from.midi ?? 60;
            const sourceOctave = Math.floor(fromMidi / 12) - 1;
            const correctTarget = toChord.guide
              .flatMap((n) => [-12, 0, 12].map((offset) => {
                const pc = ((NOTES.indexOf(n) - fromMidi % 12 + 12) % 12);
                return { note: n, midi: fromMidi + pc + offset };
              }))
              .filter((t) => t.midi > 0 && t.midi < 128)
              .sort((a, b) => {
                const dA = Math.abs(a.midi - fromMidi);
                const dB = Math.abs(b.midi - fromMidi);
                if (dA !== dB) return dA - dB;
                // Tie-break: prefer same octave as source note
                const sameA = (Math.floor(a.midi / 12) - 1) === sourceOctave ? 0 : 1;
                const sameB = (Math.floor(b.midi / 12) - 1) === sourceOctave ? 0 : 1;
                return sameA - sameB;
              })[0];
            const correctLabel = correctTarget
              ? `${correctTarget.note}${octave(correctTarget.midi)}`
              : toChord.guide.join(" or ");
            const isCommonTone = correctTarget && correctTarget.midi === fromMidi;
            const suggestion = isCommonTone ? `stay on ${fromLabel}` : `try ${correctLabel}`;
            setFeedback({ type: "bad", title: `${fromLabel} jumped ${interval} semitone${interval !== 1 ? "s" : ""} ${direction} to ${toLabel} — ${suggestion}.` });
          } else {
            setFeedback({ type: "bad", title: "Guide tone moved too far.", body: "Each guide tone must stay or move by step (half or whole)." });
          }
          return false;
        }

        const rating = mapping.total <= 1 ? "optimal" : mapping.total <= 3 ? "good" : "could be improved";
        setFeedback({
          type: rating === "optimal" ? "good" : "okay",
          title: rating === "optimal" ? "Optimal movement." : rating === "good" ? "Good movement." : "Correct — could be tighter.",
          body: `Guide tones resolved correctly.${stayText} Total: ${mapping.total} semitone${mapping.total !== 1 ? "s" : ""}.`,
        });
        return ok;
      }

      const mapping = startGuides.length === 2 && movedGuides.length === 2 ? bestMapping(startGuides, movedGuides) : null;

      const guideCandidates = generateGuideCandidates(startGuides, toChord.guide, GRID);

      let optimal = null;
      for (const candidate of guideCandidates) {
        const solved = bestMapping(startGuides, candidate);
        if (!optimal || solved.score < optimal.score) optimal = solved;
      }

      const extra = mapping && optimal ? mapping.total - optimal.total : null;
      const ok = correctNotes && extra !== null && extra <= 2.5;
      const stayed = mapping?.pairs.filter((pair) => pair.from.id === pair.to.id).length ?? 0;
      const stayText = stayed > 0 ? ` ${stayed} voice${stayed === 1 ? "" : "s"} stayed put.` : "";

      setFeedback(ok
        ? {
          type: extra <= 0.25 ? "good" : "okay",
          title: extra <= 0.25 ? "Guide tones moved optimally." : "Correct guide tones, slightly more movement.",
          body: `Movement ${mapping.total.toFixed(1)}. Best possible ${optimal.total.toFixed(1)}.${stayText}`
        }
        : {
          type: "bad",
          title: correctNotes ? "Correct notes, but too much motion." : "Wrong destination guide tones.",
          body: correctNotes
            ? `Movement ${mapping?.total.toFixed(1)}. Best possible ${optimal?.total.toFixed(1)}. A guide tone can stay if it is already in the next guide-tone set.`
            : `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}. One voice may stay if already correct.`
        }
      );

      return ok;
    }

    if (stage.key === "FILL_CHORD") {
      const current = activeSelection();
      const combined = mode === "play" ? current : [...movedGuides, ...selected];
      const pitchOk =
        combined.length === 4 &&
        samePitchSet(combined, toChord.tones);

      let widerVoicing = false;
      if (pitchOk && midiPlayMode) {
        if (mode === "play") {
          // Play mode voice-leading: check whole chord move (4 voices)
          const sMidi = startVoicing.map((c) => withMidi(c));
          const tMidi = combined.map((c) => withMidi(c));
          const mapping = bestMapping(sMidi, tMidi);
          const ok = mapping !== null && mapping.maxJump <= 7;
          if (!ok) {
            setFeedback({ type: "bad", title: "Too much motion.", body: `Leap of ${mapping.maxJump} semitones is too large.` });
            return false;
          }
        }
        // Always check non-guide tone register regardless of mode
        const guideMidis = movedGuides.map((c) => withMidi(c).midi).filter((m) => m != null);
        const extraTones = selected.length > 0 ? selected : current;
        if (guideMidis.length > 0) {
          const registerOk = extraTones.every((c) => {
            const m = withMidi(c).midi;
            return m == null || guideMidis.some((gm) => Math.abs(m - gm) <= 12);
          });
          if (!registerOk) {
            widerVoicing = true;
          }
        }
      }

      const ok = pitchOk;
      if (ok) {
        const completedDestination = combined;
        setPendingDestination(completedDestination);
        setAwaitingNextRound(true);
        setTransitionSummary(widerVoicing
          ? "Wider voicing than ideal."
          : "Smooth.");
        setFeedback(null);
      } else {
        setFeedback({
          type: "bad",
          title: "Chord not complete.",
          body: mode === "play"
            ? `Expected ${toSymbol} in ${keyCenter}: ${toChord.tones.join(" · ")}.`
            : `Expected ${toSymbol} in ${keyCenter}: ${toChord.tones.join(" · ")}. The orange guide tones are already included; add the other two tones.`
        });
      }
      return ok;
    }

    return false;
  }

  function advanceStage() {
    if (stage.key === "START_CHORD") {
      if (midiPlayMode) {
        // MIDI: carry currently-held notes into the next stage.
        const currentPressed = Object.values(midiPressedRef.current);
        const allCells = [...GRID.flat(), ...PIANO_CELLS];
        const newStartGuides = currentPressed
          .map((id) => allCells.find((c) => c.id === id))
          .filter(Boolean);
        setStartVoicing(newStartGuides);
        setStartGuides(newStartGuides);
      }
      // Mouse mode: startVoicing was set by clicks — leave it intact.
      // startGuides stays [] so the user selects guide tones fresh.
      setStageIndex(mode === "play" ? 3 : 1);
    } else if (stage.key === "IDENTIFY_GUIDES") {
      if (midiPlayMode) {
        // MIDI: seed movedGuides from currently-held notes.
        const currentPressed = Object.values(midiPressedRef.current);
        const allCells = [...GRID.flat(), ...PIANO_CELLS];
        const newMovedGuides = currentPressed
          .map((id) => allCells.find((c) => c.id === id))
          .filter(Boolean);
        setMovedGuides(newMovedGuides);
      }
      // Mouse mode: movedGuides stays [] so user selects from scratch.
      setStageIndex(2);
    } else if (stage.key === "MOVE_GUIDES") {
      if (midiPlayMode) {
        const currentPressed = Object.values(midiPressedRef.current);
        const allCells = [...GRID.flat(), ...PIANO_CELLS];
        const newSelected = currentPressed
          .map((id) => allCells.find((c) => c.id === id))
          .filter((cell) => cell && !movedGuides.some((mg) => mg.id === cell.id));
        setSelected(newSelected);
      }
      setStageIndex(3);
    }
    setFeedback(null);
  }

  function advance(checkOnly = false) {
    if (awaitingNextRound) {
      if (!checkOnly) {
        if (SHOW_DEBUG && midiPlayMode && stage.key === "FILL_CHORD") {
          const sMidi = startVoicing.map((c) => withMidi(c).midi).filter(m => m != null);
          const tMidi = activeSelection().map((c) => withMidi(c).midi).filter(m => m != null);
          if (sMidi.length === 4 && tMidi.length === 4) {
            try {
              const score = scoreVoiceLeadingTransition(
                sMidi, tMidi,
                toChord.tones.map(t => NOTES.indexOf(t)),
                fromChord.tones.map(t => NOTES.indexOf(t)),
                toChord.tones.map(t => NOTES.indexOf(t))
              );
              setVlScore(score);
            } catch (e) {
              console.warn('scoreVoiceLeadingTransition failed:', e);
            }
          }
        }
        startNextRound();
      }
      return true;
    }
    const ok = checkStage();
    if (ok && !checkOnly) {
      if (stage.key === "FILL_CHORD") {
        startNextRound();
      } else {
        advanceStage();
      }
    }
    return ok;
  }

  advanceRef.current = advance;
  advanceStageRef.current = advanceStage;
  toChordRef.current = toChord;

  function startNextRound() {
    const destination = pendingDestination || [...movedGuides, ...selected];

    setPairIndex((value) => (value + 1) % progression.length);
    setStartVoicing(destination);
    setStartGuides([]);
    setMovedGuides([]);
    setSelected([]);
    setFeedback(null);
    setPendingDestination(null);
    setTransitionSummary(null);
    setAwaitingNextRound(false);

    // Play mode seamless transition:
    // If the user is still holding the notes that now form the new "source" chord,
    // jump straight to the "destination" stage (3) without flashing Stage 1 again.
    if (mode === "play" && midiPlayMode) {
      const nextPair = progression[(pairIndex + 1) % progression.length];
      const current = activeSelection();
      const isCorrectSource = current.length === 4 && samePitchSet(current, nextPair.from.tones);
      if (isCorrectSource) {
        setStageIndex(3);
      } else {
        setStageIndex(0);
      }
    } else {
      // Learn mode: if the user is still holding the destination chord notes,
      // skip START_CHORD (they already have it) and jump to IDENTIFY_GUIDES.
      const stillHolding = midiPlayMode && Object.keys(midiPressedRef.current).length > 0;
      setStageIndex(stillHolding ? 1 : 0);
    }

    // MIDI: carry over all physically held notes into the new round's Step 2 (IDENTIFY_GUIDES).
    if (midiPlayMode) {
      const currentPressed = Object.values(midiPressedRef.current);
      const allCells = [...GRID.flat(), ...PIANO_CELLS];

      const newStartGuides = currentPressed
        .map((id) => allCells.find((c) => c.id === id))
        .filter(Boolean);

      setStartGuides(newStartGuides);
    }

    // Sync the registry with current physical state.
    Object.entries(midiPressedRef.current).forEach(([note, id]) => {
      midiNoteRegistryRef.current[id] = parseInt(note);
    });

    registerAnchorRef.current = null;
  }

  function clearCurrentStage() {
    if (awaitingNextRound) return;

    if (stage.key === "FILL_CHORD") {
      setSelected([]);
    } else {
      setActiveSelection([]);
    }
    setFeedback(null);
  }

  function cellClass(cell) {
    const current = activeSelection();
    const isSelected = current.some((c) => c.id === cell.id);
    const isStartVoicing = startVoicing.some((c) => c.id === cell.id);
    const isStartGuide = startGuides.some((c) => c.id === cell.id);
    const isMovedGuide = movedGuides.some((c) => c.id === cell.id);
    const isFinalLockedGuide = stage.key === "FILL_CHORD" && isMovedGuide;
    // Read from both state (for reactivity) AND the ref (always current, catches
    // the brief window between a stage transition and the midiHeldCells state update).
    const pressedIds = Object.values(midiPressedRef.current);
    const isMidiHeld = midiHeldCells.some((c) => c.id === cell.id) ||
      pressedIds.includes(cell.id);
    const remainingDestinationTones = toChord.tones.filter((note) => !toChord.guide.includes(note));



    const isSuccessfulDestinationTone =
      awaitingNextRound &&
      pendingDestination?.some((destinationCell) => destinationCell.id === cell.id);

    return [
      "cell",
      isMidiHeld ? "midi-held" : "",
      isSelected ? "selected" : "",
      isStartVoicing && stage.key === "IDENTIFY_GUIDES" && !isSelected ? "voicing-hint" : "",
      isStartGuide && stage.key === "MOVE_GUIDES" && !isSelected && !isMovedGuide ? "voicing-hint" : "",
      isMovedGuide ? "moved-guide" : "",
      isFinalLockedGuide ? "locked final-guide" : "",
      isSuccessfulDestinationTone ? "success-tone" : ""
    ].filter(Boolean).join(" ");
  }

  function handlePianoKey(key) {
    const pianoCell = PIANO_CELLS.find((c) => c.midi === key.midi);
    if (pianoCell) toggleCell(pianoCell);
  }

  function pianoKeyClass(key) {
    const pianoCell = PIANO_CELLS.find((c) => c.midi === key.midi);
    if (!pianoCell) return key.isBlack ? "piano-key black" : "piano-key white";

    const curr = activeSelection();
    const remainingDestinationTones = toChord.tones.filter((n) => !toChord.guide.includes(n));
    const isSelected = curr.some((c) => c.id === pianoCell.id);
    const pianoPressedIds = Object.values(midiPressedRef.current);
    const isMidiHeld = midiHeldCells.some((c) => c.id === pianoCell.id) ||
      pianoPressedIds.includes(pianoCell.id);
    const isStartGuide = startGuides.some((c) => c.id === pianoCell.id);
    const isMovedGuide = movedGuides.some((c) => c.id === pianoCell.id);
    const isSuccessTone = awaitingNextRound && pendingDestination?.some((c) =>
      c.midi != null ? c.midi === key.midi : c.note === key.note
    );



    return [
      key.isBlack ? "piano-key black" : "piano-key white",
      isSelected ? "selected" : "",
      isMidiHeld ? "midi-held" : "",
      isStartGuide && stage.key !== "START_CHORD" ? "source-guide" : "",
      isMovedGuide ? "moved-guide" : "",
      isSuccessTone ? "success-tone" : "",
    ].filter(Boolean).join(" ");
  }

  const currentSelection = activeSelection();
  const displaySelection = stage.key === "FILL_CHORD" ? [...movedGuides, ...selected] : currentSelection;
  const selectionText = displaySelection.map((c) => c.note).join(" ") || "—";
  const isMovingStage = stage.key === "MOVE_GUIDES";
  const hasInputMoved = isMovingStage ? !samePitchSet(currentSelection, fromChord.guide) : true;
  const canAdvance = awaitingNextRound || (currentSelection.length === maxSelectionsForStage() && hasInputMoved);

  // MIDI mode: hold correct notes for 0.5s to register, then flash for 0.5s before advancing.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!midiPlayMode || !canAdvance) return;

    const timer = setTimeout(() => {
      const ok = advanceRef.current?.(true);
      if (ok) {
        setTimeout(() => {
          advanceRef.current?.(false);
        }, 750);
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [midiPlayMode, canAdvance, stageIndex, awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play mode: if we let go of all notes, reset to Step 1.
  useEffect(() => {
    if (mode === "play" && !awaitingNextRound) {
      if (midiHeldCells.length === 0 && stageIndex !== 0) {
        setStageIndex(0);
        setSelected([]);
        setStartVoicing([]);
        setFeedback(null);
      }
    }
  }, [mode, stageIndex, midiHeldCells, awaitingNextRound]);

  // Mouse mode: auto-check when selection is complete, then advance or clear.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (midiPlayMode || awaitingNextRound || !canAdvance) return;
    const ok = checkStage();
    const timer = setTimeout(() => { if (ok) advanceStage(); else clearCurrentStage(); }, 750);
    return () => clearTimeout(timer);
  }, [canAdvance, midiPlayMode, awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start next round after holding the completed chord state.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!awaitingNextRound) return;
    const timer = setTimeout(() => startNextRound(), 750);
    return () => clearTimeout(timer);
  }, [awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live voice-leading score during MOVE_GUIDES — updates on every note change.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (stage.key !== "MOVE_GUIDES" || startGuides.length !== 2 || movedGuides.length === 0) {
      if (stage.key !== "MOVE_GUIDES") setVlScore(null);
      return;
    }
    const enrichedFrom = startGuides.map(withMidi);
    const enrichedTo = movedGuides.map(withMidi);
    const mapping = enrichedFrom.length === enrichedTo.length
      ? bestMapping(enrichedFrom, enrichedTo)
      : null;
    if (!mapping) return;

    // Compute optimal using all valid destination candidates
    const guideNotes = toChordRef.current?.guide ?? [];
    const candidates = generateGuideCandidates(startGuides, guideNotes, GRID);
    let optimal = null;
    for (const candidate of candidates) {
      const solved = bestMapping(enrichedFrom, candidate.map(withMidi));
      if (!optimal || solved.score < optimal.score) optimal = solved;
    }

    const userDistance = mapping.total;
    const optimalDistance = optimal?.total ?? null;
    const excessDistance = optimalDistance != null ? userDistance - optimalDistance : null;

    const guideResult = mapping.maxJump <= 2 ? "correct" : "incorrect — guide tone violation";
    const rating = mapping.maxJump > 2 ? null :
      mapping.total <= 1 ? "optimal" :
        mapping.total <= 3 ? "good" : "could be improved";

    setVlScore({
      userDistance,
      optimalDistance,
      excessDistance,
      result: guideResult,
      rating,
      message: guideResult === "correct"
        ? (rating === "optimal" ? "Optimal — guide tones resolved by step or stayed." :
          rating === "good" ? "Good — guide tones correct, slight extra motion." :
            "Correct — consider tighter voice leading.")
        : `✗ Guide tone leap of ${mapping.maxJump} semitone${mapping.maxJump !== 1 ? "s" : ""} — must stay or move by step.`,
    });
  }, [stage.key, movedGuides, startGuides]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="brand"><span className="brand-icon">IF</span>IsoFlow</div>
        <a
          className="github-link"
          href="https://github.com/kazemio/isoflow/issues"
          target="_blank"
          rel="noreferrer"
          title="Feedback / contribute"
        >
          <Github size={18} />
          <span className="github-link-label">Contribute / Feedback</span>
        </a>

        <div className="controls key-controls">

          <label className="ctrl-key">
            Key
            <select
              value={keyCenter}
              onChange={(event) => resetAll(event.target.value)}
            >
              {MAJOR_KEYS.map((key) => (
                <option key={key} value={key}>{key} major</option>
              ))}
            </select>
          </label>


          <label className="ctrl-prog">
            Progression
            <input
              list="progression-presets"
              value={customText}
              onChange={(e) => { setCustomText(e.target.value); resetAll(); }}
              placeholder="ii V I"
            />
            <datalist id="progression-presets">
              {Object.entries(PROGRESSION_OPTIONS).map(([name, chords]) => (
                <option key={name} value={chords.join(" ")} />
              ))}
            </datalist>
          </label>

          <label className="ctrl-random">
            Random
            <button
              type="button"
              className="random-button"
              onClick={() => { const p = generateRandomProgression(); setCustomText(p); resetAll(); }}
              title="Random"
            >
              <Dices size={15} />
            </button>
          </label>

          <label className="ctrl-settings">
            Settings
            <button
              type="button"
              className="random-button"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={15} />
            </button>
          </label>
        </div>

        <div className="mode-row">
          <label className="ctrl-mode">
            <div className="seg-control" style={{ "--seg-x": mode === "play" ? 1 : 0 }}>
              <button
                type="button"
                className={mode === "learn" ? "seg-option active" : "seg-option"}
                onClick={() => { setMode("learn"); setStageIndex(0); }}
              >Learn</button>
              <button
                type="button"
                className={mode === "play" ? "seg-option active" : "seg-option"}
                onClick={() => { setMode("play"); setStageIndex(0); }}
              >Play</button>
            </div>
          </label>
        </div>


        <div className={`step-row mode-${mode}${feedback && !awaitingNextRound && (mode === "learn" || feedback.type === "good") ? ` step-${feedback.type}` : awaitingNextRound ? (transitionSummary?.includes("wider voicing") ? " step-okay" : " step-good") : ""}`}>
          <div className="flow-strip" style={{ visibility: mode === "learn" ? "visible" : "hidden" }}>
            {STAGES.map((item, index) => {
              const actualIndex = STAGES.indexOf(item);
              const isActive = actualIndex === stageIndex;
              const isDone = actualIndex < stageIndex;
              return <div key={item.key} className={isActive ? "flow-step active" : isDone ? "flow-step done" : "flow-step"} />;
            })}
          </div>
          <div className="step-line fade-in" key={feedback?.title || transitionSummary || stage.title} style={{ visibility: mode === "learn" ? "visible" : "hidden" }}>
            <span className="step-text">
              {feedback && !awaitingNextRound
                ? feedback.title
                : awaitingNextRound
                  ? transitionSummary || "Transition complete"
                  : displayTitle}
            </span>
          </div>
          <div className="chord-line">
            <span className="chord-unit">
              <strong>{fromSymbol}</strong>
              <span className="chord-unit-name">{getChordName(fromSymbol, fromChord.tones)}</span>
              {mode === "learn" && (
                <span className="chord-unit-notes">
                  {fromChord.tones.map((note, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ color: 'inherit', opacity: 0.5 }}> · </span>}
                      <span style={stage.key === "IDENTIFY_GUIDES" && (i === 1 || i === 3)
                        ? { color: '#f28c28', fontWeight: 800 } : {}}>
                        {note}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="chord-sep">→</span>
            <span className="chord-unit">
              <strong>{toSymbol}</strong>
              <span className="chord-unit-name">{getChordName(toSymbol, toChord.tones)}</span>
              {mode === "learn" && (
                <span className="chord-unit-notes">
                  {toChord.tones.map((note, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ color: 'inherit', opacity: 0.5 }}> · </span>}
                      <span style={stage.key === "MOVE_GUIDES" && (i === 1 || i === 3)
                        ? { color: '#f28c28', fontWeight: 800 } : {}}>
                        {note}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </div>
        </div>

        {viewMode === "piano" ? (
          <div className="piano-outer">
            <div className="piano-keyboard">
              {PIANO_KEYS.filter((k) => !k.isBlack).map((key) => (
                <button
                  key={key.midi}
                  className={pianoKeyClass(key)}
                  onClick={() => handlePianoKey(key)}
                  style={{ "--white-idx": key.whiteIndex }}
                >
                  <span className="piano-note-label">{key.note}</span>
                </button>
              ))}
              {PIANO_KEYS.filter((k) => k.isBlack).map((key) => (
                <button
                  key={key.midi}
                  className={pianoKeyClass(key)}
                  onClick={() => handlePianoKey(key)}
                  style={{ "--white-idx": getPrevWhiteIndex(key) }}
                />
              ))}
            </div>
            <p className="piano-range-label">
              {NOTES[PIANO_MIDI_START % 12]}{Math.floor(PIANO_MIDI_START / 12) - 1}
              {" – "}
              {NOTES[PIANO_MIDI_END % 12]}{Math.floor(PIANO_MIDI_END / 12) - 1}
            </p>
          </div>
        ) : (
          <div className="grid-outer">
            <div className="grid">
              {GRID.flat().map((cell) => (
                <button
                  key={cell.id}
                  className={cellClass(cell)}
                  onClick={() => toggleCell(cell)}
                  title={`${cell.note} — row ${cell.row + 1}, col ${cell.col + 1}`}
                >
                  {cell.note}
                </button>
              ))}
            </div>
          </div>
        )}

        {SHOW_DEBUG && (
          <div className="debug-midi">
            <div style={{ marginBottom: '6px', fontSize: '11px', fontWeight: '700', color: '#111' }}>
              STAGE: {stage.key} {startVoicing.length > 0 &&
                <span style={{ fontWeight: '400', opacity: 0.6, marginLeft: '8px' }}>
                  (Ref: {startVoicing.map(c => `${c.note}${withMidi(c).midi != null ? Math.floor(withMidi(c).midi / 12) - 1 : ''}`).join(" ")})
                </span>
              }
            </div>
            {midiHeldCells.length > 0
              ? [...midiHeldCells]
                .map((c) => withMidi(c))
                .sort((a, b) => (a.midi || 0) - (b.midi || 0))
                .map((c) => {
                  const octave = c.midi != null ? Math.floor(c.midi / 12) - 1 : "";
                  const midiNum = c.midi != null ? ` (${c.midi})` : "";
                  return `${c.note}${octave}${midiNum}`;
                })
                .join(" · ")
              : "—"}

            {mode === "play" && startVoicing.length === 4 && midiHeldCells.length === 4 && (
              <div style={{ marginTop: '5px', fontSize: '10px', color: '#7c7c82' }}>
                {(() => {
                  const sMidi = startVoicing.map((c) => withMidi(c));
                  const tMidi = midiHeldCells.map((c) => withMidi(c));
                  const m = bestMapping(sMidi, tMidi);
                  return m ? `Motion: Max=${m.maxJump}, Total=${m.total}` : "No Mapping Found";
                })()}
              </div>
            )}
            {vlScore && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #eee', fontSize: '10px' }}>
                <div style={{ fontWeight: '700', color: '#111', marginBottom: '4px' }}>VOICE LEADING</div>
                <div style={{ color: vlScore.result === 'correct' ? '#14532d' : '#7f1d1d', fontWeight: '700', marginBottom: '2px' }}>
                  {vlScore.result}
                </div>
                {vlScore.rating && (
                  <div style={{ color: '#555', marginBottom: '4px' }}>Rating: {vlScore.rating}</div>
                )}
                <div>User: {vlScore.userDistance} · Optimal: {vlScore.optimalDistance ?? '—'} · Excess: {vlScore.excessDistance ?? '—'}</div>
                <div style={{ marginTop: '4px', fontStyle: 'italic', color: '#444' }}>{vlScore.message}</div>
              </div>
            )}
          </div>
        )}

      </section>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
      >
        <div className="drawer-section">
          <div className="drawer-section-title">Layout</div>
          <div className="seg-control" style={{ "--seg-x": viewMode === "piano" ? 1 : 0 }}>
            <button
              type="button"
              className={viewMode === "grid" ? "seg-option active" : "seg-option"}
              onClick={() => setViewMode("grid")}
            >Grid</button>
            <button
              type="button"
              className={viewMode === "piano" ? "seg-option active" : "seg-option"}
              onClick={() => setViewMode("piano")}
            >Piano</button>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">MIDI</div>

          <div className="drawer-row">
            <label className="drawer-row-device">
              Input
              <select
                value={selectedMidiInputId}
                onChange={(e) => setSelectedMidiInputId(e.target.value)}
                disabled={!midiSupported || midiInputs.length === 0}
              >
                {!midiSupported ? (
                  <option value="">MIDI not supported</option>
                ) : midiInputs.length === 0 ? (
                  <option value="">No MIDI inputs</option>
                ) : (
                  <>
                    <option value="">— None —</option>
                    {midiInputs.map((input) => (
                      <option key={input.id} value={input.id}>
                        {input.manufacturer ? `${input.manufacturer} — ` : ""}{input.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <label className="drawer-row-channel">
              Channel
              <select
                value={midiInChannel}
                onChange={(e) => setMidiInChannel(Number(e.target.value))}
                disabled={!selectedMidiInputId}
              >
                <option value={0}>All</option>
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="drawer-row">
            <label className="drawer-row-device">
              Output
              <select
                value={selectedMidiOutputId}
                onChange={(e) => setSelectedMidiOutputId(e.target.value)}
                disabled={!midiSupported || midiOutputs.length === 0}
              >
                {!midiSupported ? (
                  <option value="">MIDI not supported</option>
                ) : midiOutputs.length === 0 ? (
                  <option value="">No MIDI outputs</option>
                ) : (
                  <>
                    <option value="">— None —</option>
                    {midiOutputs.map((output) => (
                      <option key={output.id} value={output.id}>
                        {output.manufacturer ? `${output.manufacturer} — ` : ""}{output.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <label className="drawer-row-channel">
              Channel
              <select
                value={midiOutChannel}
                onChange={(e) => setMidiOutChannel(Number(e.target.value))}
                disabled={!selectedMidiOutputId}
              >
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </SettingsDrawer>
    </main>
  );
}

export default App;
