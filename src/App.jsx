import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dices, Github, Settings } from "lucide-react";
import { SettingsDrawer } from "./SettingsDrawer";
import { resolveMidiCell as resolveMidiCellPure } from "./midiResolution";
import { createMidiPassthrough, shouldForward, isForwardableMessage } from "./midiOutput";
import {
  isSameMidiDevice,
  findAlternativeOutput,
  nextChannel,
  passesInputChannelFilter,
  captureLearnFromMessage,
} from "./midiRouting";
import { shouldShowVoicingHint, isCellInPendingDestination } from "./voicingUtils";
import { checkStage as runCheckStage } from "./stageMachine";
import {
  NOTES,
  MAJOR_KEYS,
  PROGRESSION_OPTIONS,
  STAGES,
  PIANO_MIDI_START,
  PIANO_MIDI_END,
  PIANO_KEYS,
  PIANO_CELLS,
  getChordName,
  buildChordsForKey,
  buildGrid,
  getPrevWhiteIndex,
  parseProgression,
  generateRandomProgression,
  samePitchSet,
  sameNoteSet,
  distance,
} from "./musicUtils";

// MIDI play mode: how long the user must hold the correct notes before the
// stage check fires. Acts as a debounce against transient mid-chord states.
const MIDI_HOLD_MS = 750;

// How long a feedback / transition state stays on screen before the UI
// advances to the next stage or round. Gives the user a beat to read the
// result before the layout changes.
const FEEDBACK_HOLD_MS = 750;

function App() {
  const GRID = useMemo(() => buildGrid(8, 8), []);

  const [viewMode, setViewMode] = useState("grid");

  // MIDI range covered by the currently-active layout — used to bound the
  // candidate-generation search so optimal-motion comparisons stay within
  // notes the user can actually reach.
  const layoutMidiRange = useMemo(() => {
    if (viewMode === "piano") return { midiMin: PIANO_MIDI_START, midiMax: PIANO_MIDI_END };
    const gridMin = GRID[GRID.length - 1][0].midi;
    const gridMax = GRID[0][GRID[0].length - 1].midi;
    return { midiMin: gridMin, midiMax: gridMax };
  }, [GRID, viewMode]);
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
  const [transitionGrade, setTransitionGrade] = useState(null); // "good" | "okay"

  const midiSupported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  const [midiStatus, setMidiStatus] = useState(midiSupported ? "disconnected" : "unsupported");
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState("");
  const [midiInChannel, setMidiInChannel] = useState(1); // 1-16
  const [midiOutputs, setMidiOutputs] = useState([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState("");
  const [midiOutChannel, setMidiOutChannel] = useState(1); // 1-16
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputLearning, setInputLearning] = useState(false);
  const inputLearningRef = useRef(false);
  const inputLearnTimerRef = useRef(null);
  const LEARN_PULSE_NOTE = 60; // C4
  const LEARN_PULSE_VELOCITY = 100;
  const LEARN_PULSE_MS = 300;
  const INPUT_LEARN_TIMEOUT_MS = 10000;
  const midiOutRef = useRef(null);
  if (midiOutRef.current === null) midiOutRef.current = createMidiPassthrough();
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

  const [useOctaveMapping, setUseOctaveMapping] = useState(false);
  const midiPlayMode = Boolean(selectedMidiInputId);

  // Selected device objects (descriptor with name/manufacturer) — used for
  // same-device detection and dropdown disabled-state logic. Web MIDI gives
  // separate IDs for the input and output sides of the same hardware, so we
  // identify "same physical device" by name+manufacturer.
  const selectedInputDevice = useMemo(
    () => midiInputs.find((i) => i.id === selectedMidiInputId) ?? null,
    [midiInputs, selectedMidiInputId]
  );
  const selectedOutputDevice = useMemo(
    () => midiOutputs.find((o) => o.id === selectedMidiOutputId) ?? null,
    [midiOutputs, selectedMidiOutputId]
  );
  const sameMidiDevice = isSameMidiDevice(selectedInputDevice, selectedOutputDevice);

  // Auto-resolve same-device configurations. When in & out land on the same
  // physical MIDI device (e.g. after Input Learn captures the device the
  // user previously had selected as output), migrate the Output to a
  // different available device so the conflict disappears. Falls back to
  // channel-bumping only if no alternative output device exists. Uses
  // useLayoutEffect so the correction lands *before* paint — no window for
  // the user to interact with a conflicting state.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useLayoutEffect(() => {
    if (!sameMidiDevice) return;

    // Prefer device migration over channel bumping. Honour the user's input
    // (the recently chosen / learned device) and reassign the output.
    const altOutput = findAlternativeOutput(midiOutputs, selectedInputDevice);
    if (altOutput && altOutput.id !== selectedMidiOutputId) {
      console.warn(`Same MIDI device on in & out — switching Output to "${altOutput.name}" to avoid feedback.`);
      setSelectedMidiOutputId(altOutput.id);
      return;
    }

    // No alternative output device available — fall back to bumping the
    // output channel so the configuration is at least channel-distinct.
    if (midiInChannel === midiOutChannel) {
      const fallback = nextChannel(midiOutChannel);
      console.warn(`Same MIDI device on in & out can't share ch ${midiOutChannel} — bumping Output to ch ${fallback}.`);
      setMidiOutChannel(fallback);
    }
  }, [sameMidiDevice, midiInChannel, midiOutChannel, selectedInputDevice, midiOutputs, selectedMidiOutputId]);

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
    setTransitionGrade(null);
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

  // Cells now always carry `.midi` from construction. This function only
  // overrides the intrinsic MIDI when the user pressed a different MIDI key
  // that was routed to this cell (proximity / octave-mapping mode).
  function withRegisteredMidi(cell) {
    const overridden = midiNoteRegistryRef.current[cell.id];
    return overridden != null ? { ...cell, midi: overridden } : cell;
  }

  function pickCellForPitchClass(pitchClass) {
    const candidates = GRID.flat().filter((c) => c.pitchClass === pitchClass);
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
        console.log("MIDI ACCESS → requesting…");
        const access = await navigator.requestMIDIAccess();
        if (cancelled) return;
        midiAccessRef.current = access;
        setMidiStatus("disconnected");
        console.log("MIDI ACCESS → granted");

        // Debounce the device-list log: when a device powers on, every one
        // of its USB ports fires `onstatechange` in rapid succession. We
        // collapse the burst into a single line by waiting 250ms after the
        // last event before logging the final state.
        let devicesLogTimer = null;
        let lastLoggedSignature = "";
        const scheduleDevicesLog = (inputs, outputs) => {
          if (devicesLogTimer) clearTimeout(devicesLogTimer);
          devicesLogTimer = setTimeout(() => {
            const sig = JSON.stringify({
              i: inputs.map((d) => d.name),
              o: outputs.map((d) => d.name),
            });
            if (sig === lastLoggedSignature) return;
            lastLoggedSignature = sig;
            console.log(
              "MIDI DEVICES →",
              `${inputs.length} in / ${outputs.length} out`,
              { inputs: inputs.map((d) => d.name), outputs: outputs.map((d) => d.name) }
            );
          }, 250);
        };

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
          scheduleDevicesLog(nextInputs, nextOutputs);
          setMidiInputs(nextInputs);
          setMidiOutputs(nextOutputs);
          setMidiStatus(nextInputs.length > 0 || nextOutputs.length > 0 ? "connected" : "disconnected");

          // Coordinate input/output defaults: pick first input, then pick the
          // first output whose name+manufacturer differs from that input so
          // we don't auto-select a same-device feedback configuration.
          let chosenInputDevice = null;
          setSelectedMidiInputId((currentId) => {
            const kept = currentId && nextInputs.find((i) => i.id === currentId);
            chosenInputDevice = kept ?? nextInputs[0] ?? null;
            return chosenInputDevice?.id ?? "";
          });
          setSelectedMidiOutputId((currentId) => {
            if (currentId && nextOutputs.some((o) => o.id === currentId)) return currentId;
            const nonConflict = findAlternativeOutput(nextOutputs, chosenInputDevice);
            return (nonConflict ?? nextOutputs[0])?.id ?? "";
          });
        };

        refreshDevices();
        access.onstatechange = refreshDevices;
      } catch (err) {
        if (cancelled) return;
        console.warn("MIDI ACCESS → denied or unavailable:", err);
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

    // While Input Learn is armed, listen on every connected input so we can
    // capture both the device and the channel from the first message. When
    // not learning, only the user-selected input gets a handler.
    const inputs = inputLearning
      ? Array.from(access.inputs.values())
      : (selectedMidiInputId ? [access.inputs.get(selectedMidiInputId)].filter(Boolean) : []);
    if (inputs.length === 0) return;

    const onMessage = (event) => {
      const input = event?.target;
      const data = event?.data;
      if (!data || data.length === 0) return;
      const statusByte = data[0];
      const op = statusByte & 0xf0;
      const isChannelVoice = statusByte >= 0x80 && statusByte < 0xf0;

      // Skip noisy clock ticks (0xF8) and active-sensing (0xFE) — they fire constantly.
      if (statusByte !== 0xf8 && statusByte !== 0xfe) {
        const data1 = data.length >= 2 ? data[1] : 0;
        const inCh = isChannelVoice ? (statusByte & 0x0f) + 1 : null;
        const label = inCh != null ? `ch ${inCh}` : "(system)";
        if (isForwardableMessage(statusByte, data1)) {
          console.log("MIDI IN →", input?.name, label, [...data]);
        } else {
          // Dropped by the whitelist (e.g. Deluge parameter dumps). Visible in
          // DevTools when the "Verbose" level is enabled — otherwise hidden.
          console.debug("MIDI IN (filtered) →", input?.name, label, [...data]);
        }
      }

      // MIDI Input Learn: capture both device and channel from the first
      // channel-voice message we see (could be from any connected input).
      if (inputLearningRef.current) {
        const captured = captureLearnFromMessage(statusByte, input?.id);
        if (captured) {
          console.log("MIDI INPUT LEARN → captured", input?.name ?? "(unknown)", "ch", captured.channel);
          if (captured.deviceId) setSelectedMidiInputId(captured.deviceId);
          setMidiInChannel(captured.channel);
          stopInputLearn(true);
          return;
        }
      }

      // Channel filter (channel-voice messages only). System messages bypass.
      if (!passesInputChannelFilter(statusByte, midiInChannel)) return;

      // Forwarding has two layers: (1) a per-message-type whitelist so we
      // don't pass synth-state dumps and other non-performance chatter to the
      // destination, and (2) the same-device loop guard. Both must pass.
      const data1 = data.length >= 2 ? data[1] : 0;
      if (
        selectedMidiOutputId &&
        isForwardableMessage(statusByte, data1) &&
        shouldForward({
          sameDevice: sameMidiDevice,
          isChannelVoice,
          inFilterChannel: midiInChannel,
          outChannel: midiOutChannel,
        })
      ) {
        const out = midiAccessRef.current?.outputs.get(selectedMidiOutputId);
        if (out) {
          // Compute the actual bytes that will leave (channel rewritten for
          // channel-voice messages) so the log reflects what hits the wire.
          const sentBytes = [...data];
          if (isChannelVoice) sentBytes[0] = (statusByte & 0xf0) | ((midiOutChannel - 1) & 0x0f);
          midiOutRef.current.forward(out, data, midiOutChannel);
          console.log("MIDI OUT →", out.name, "ch", midiOutChannel, sentBytes);
        }
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
    for (const input of inputs) {
      input.onmidimessage = onMessage;
    }

    return () => {
      for (const input of inputs) {
        if (input.onmidimessage === onMessage) input.onmidimessage = null;
      }
    };
  }, [midiStatus, selectedMidiInputId, midiInChannel, selectedMidiOutputId, midiOutChannel, sameMidiDevice, inputLearning]);

  // When the input device or channel changes mid-play, any note-off events for
  // currently-held notes will be filtered out (different channel) or routed to
  // a port we're no longer listening to. Explicitly release held notes — both
  // the UI selection state and any external synth those notes were forwarded to.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const heldNotes = Object.keys(midiPressedRef.current).map(Number);
    // Silent when nothing is held — that's the initial-mount case and any
    // input switch made when no notes are currently sounding.
    if (heldNotes.length === 0) return;
    console.log(
      "MIDI INPUT changed →",
      "device:", selectedMidiInputId || "(none)",
      "channel:", midiInChannel,
      "| releasing", heldNotes.length, "held note(s):", heldNotes
    );
    for (const note of heldNotes) {
      midiNoteOffRef.current?.(note);
    }
    if (selectedMidiOutputId) {
      const out = midiAccessRef.current?.outputs.get(selectedMidiOutputId);
      if (out) {
        const flushed = midiOutRef.current.flush(out, midiOutChannel);
        if (flushed.length > 0) {
          console.log("MIDI OUT flushed on input change →", out.name, "ch", midiOutChannel, flushed);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on input change
  }, [selectedMidiInputId, midiInChannel]);

  // ── MIDI Learn helpers ───────────────────────────────────────────────────
  // Output Learn: click once → send a brief note pulse on the configured
  // output channel so a destination synth in MIDI-learn mode can bind it.
  // Input Learn: click once → arm the input handler to capture the device
  // and channel of the next incoming channel-voice message. Auto-cancels.

  function pulseOutputLearn() {
    if (!selectedMidiOutputId) return;
    // Defensive: refuse to pulse if the state would create a feedback loop
    // through a same-device routing. The layout-effect guard above should
    // have already corrected this, but block at the action layer too.
    if (sameMidiDevice && midiInChannel !== 0 && midiInChannel === midiOutChannel) {
      console.warn("Refusing Output Learn pulse — same device + same channel as input would feedback loop.");
      return;
    }
    const out = midiAccessRef.current?.outputs.get(selectedMidiOutputId);
    if (!out) return;
    const onStatus = 0x90 | ((midiOutChannel - 1) & 0x0f);
    const offStatus = 0x80 | ((midiOutChannel - 1) & 0x0f);
    out.send([onStatus, LEARN_PULSE_NOTE, LEARN_PULSE_VELOCITY]);
    console.log("MIDI LEARN PULSE → on", out.name, "ch", midiOutChannel, [onStatus, LEARN_PULSE_NOTE, LEARN_PULSE_VELOCITY]);
    setTimeout(() => {
      out.send([offStatus, LEARN_PULSE_NOTE, 0]);
      console.log("MIDI LEARN PULSE → off", out.name, "ch", midiOutChannel, [offStatus, LEARN_PULSE_NOTE, 0]);
    }, LEARN_PULSE_MS);
  }

  function startInputLearn() {
    if (midiInputs.length === 0) return;
    inputLearningRef.current = true;
    setInputLearning(true);
    if (inputLearnTimerRef.current) clearTimeout(inputLearnTimerRef.current);
    inputLearnTimerRef.current = setTimeout(() => stopInputLearn(false), INPUT_LEARN_TIMEOUT_MS);
    console.log("MIDI INPUT LEARN → listening on all inputs for next channel-voice message…");
  }

  function stopInputLearn(captured) {
    inputLearningRef.current = false;
    setInputLearning(false);
    if (inputLearnTimerRef.current) {
      clearTimeout(inputLearnTimerRef.current);
      inputLearnTimerRef.current = null;
    }
    if (!captured) console.log("MIDI INPUT LEARN → cancelled / timed out");
  }


  function checkStage() {
    const result = runCheckStage({
      stageKey: stage.key,
      fromChord, toChord,
      fromSymbol, toSymbol,
      keyCenter,
      mode,
      midiPlayMode,
      selection: activeSelection().map(withRegisteredMidi),
      startVoicing: startVoicing.map(withRegisteredMidi),
      startGuides: startGuides.map(withRegisteredMidi),
      movedGuides: movedGuides.map(withRegisteredMidi),
      selected: selected.map(withRegisteredMidi),
      layoutMidiRange,
    });

    setFeedback(result.feedback);

    if (result.pendingDestination) {
      setPendingDestination(result.pendingDestination);
      setAwaitingNextRound(true);
      setTransitionSummary(result.transitionSummary);
      setTransitionGrade(result.transitionGrade);
    }

    return result.ok;
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
    setTransitionGrade(null);
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



    const isSuccessfulDestinationTone = isCellInPendingDestination(cell, awaitingNextRound, pendingDestination);

    return [
      "cell",
      isMidiHeld ? "midi-held" : "",
      isSelected ? "selected" : "",
      shouldShowVoicingHint(cell, stage.key, startVoicing, startGuides, movedGuides, isSelected, isMovedGuide) ? "voicing-hint" : "",
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
    const isSelected = curr.some((c) => c.id === pianoCell.id);
    const pianoPressedIds = Object.values(midiPressedRef.current);
    const isMidiHeld = midiHeldCells.some((c) => c.id === pianoCell.id) ||
      pianoPressedIds.includes(pianoCell.id);
    const isMovedGuide = movedGuides.some((c) => c.id === pianoCell.id);
    const isFinalLockedGuide = stage.key === "FILL_CHORD" && isMovedGuide;
    const isSuccessTone = isCellInPendingDestination(pianoCell, awaitingNextRound, pendingDestination);

    return [
      key.isBlack ? "piano-key black" : "piano-key white",
      isSelected ? "selected" : "",
      isMidiHeld ? "midi-held" : "",
      shouldShowVoicingHint(pianoCell, stage.key, startVoicing, startGuides, movedGuides, isSelected, isMovedGuide) ? "voicing-hint" : "",
      isMovedGuide ? "moved-guide" : "",
      isFinalLockedGuide ? "locked final-guide" : "",
      isSuccessTone ? "success-tone" : "",
    ].filter(Boolean).join(" ");
  }

  const currentSelection = activeSelection();
  const displaySelection = stage.key === "FILL_CHORD" ? [...movedGuides, ...selected] : currentSelection;
  const selectionText = displaySelection.map((c) => c.note).join(" ") || "—";
  const isMovingStage = stage.key === "MOVE_GUIDES";
  // "Has input moved" is the gate that prevents auto-advance while the user
  // is still holding the source guides mid-resolution. When the source and
  // destination guide sets are identical (e.g. I → I), the correct answer IS
  // the source guides, so this gate must not block.
  const guideSetsIdentical = isMovingStage && sameNoteSet(fromChord.guide, toChord.guide);
  const hasInputMoved = !isMovingStage || guideSetsIdentical || !samePitchSet(currentSelection, fromChord.guide);
  const canAdvance = awaitingNextRound || (currentSelection.length === maxSelectionsForStage() && hasInputMoved);

  // MIDI mode: hold the correct notes for MIDI_HOLD_MS to trigger the check,
  // then leave the success state visible for FEEDBACK_HOLD_MS before advancing.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!midiPlayMode || !canAdvance) return;

    const timer = setTimeout(() => {
      const ok = advanceRef.current?.(true);
      if (ok) {
        setTimeout(() => {
          advanceRef.current?.(false);
        }, FEEDBACK_HOLD_MS);
      }
    }, MIDI_HOLD_MS);
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
    const timer = setTimeout(() => { if (ok) advanceStage(); else clearCurrentStage(); }, FEEDBACK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [canAdvance, midiPlayMode, awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start next round after holding the completed chord state.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!awaitingNextRound) return;
    const timer = setTimeout(() => startNextRound(), FEEDBACK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <div className="prog-group">
              <input
                list="progression-presets"
                value={customText}
                onChange={(e) => { setCustomText(e.target.value); resetAll(); }}
                placeholder="ii V I"
              />
              <button
                type="button"
                className="prog-dice-btn"
                onClick={() => { const p = generateRandomProgression(); setCustomText(p); resetAll(); }}
                title="Random progression"
                aria-label="Random progression"
              >
                <Dices size={18} />
              </button>
            </div>
            <datalist id="progression-presets">
              {Object.entries(PROGRESSION_OPTIONS).map(([name, chords]) => (
                <option key={name} value={chords.join(" ")} />
              ))}
            </datalist>
          </label>

          <button
            type="button"
            className="icon-button ctrl-settings"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={18} />
          </button>
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


        <div className={`step-row mode-${mode}${feedback && !awaitingNextRound && (mode === "learn" || feedback.type === "good") ? ` step-${feedback.type}` : awaitingNextRound ? ` step-${transitionGrade ?? "good"}` : ""}`}>
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
                    {midiInputs.map((input) => {
                      const conflicts = isSameMidiDevice(input, selectedOutputDevice);
                      return (
                        <option key={input.id} value={input.id} disabled={conflicts}>
                          {input.manufacturer ? `${input.manufacturer} — ` : ""}{input.name}
                          {conflicts ? " (in use as output)" : ""}
                        </option>
                      );
                    })}
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
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`learn-button${inputLearning ? " active" : ""}`}
              disabled={midiInputs.length === 0}
              onClick={() => (inputLearning ? stopInputLearn(false) : startInputLearn())}
              title="Press a note on any connected MIDI controller — IsoFlow will set both the input device and channel from it."
            >
              {inputLearning ? "…" : "Learn"}
            </button>
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
                    {midiOutputs.map((output) => {
                      const conflicts = isSameMidiDevice(output, selectedInputDevice);
                      return (
                        <option key={output.id} value={output.id} disabled={conflicts}>
                          {output.manufacturer ? `${output.manufacturer} — ` : ""}{output.name}
                          {conflicts ? " (in use as input)" : ""}
                        </option>
                      );
                    })}
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
                {Array.from({ length: 16 }, (_, i) => i + 1)
                  .filter((ch) => !(sameMidiDevice && ch === midiInChannel))
                  .map((ch) => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="learn-button"
              disabled={!selectedMidiOutputId}
              onClick={pulseOutputLearn}
              title="Sends a brief note pulse on the configured output channel so a destination synth in MIDI-learn mode can bind it."
            >
              Learn
            </button>
          </div>
        </div>
      </SettingsDrawer>
    </main>
  );
}

export default App;
