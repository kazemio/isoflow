import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Eye, RotateCcw, Target } from "lucide-react";

const NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];


function getChordName(symbol, tones) {
  const root = tones[0];
  if (symbol === "I" || symbol === "IV") return root + "maj7";
  if (symbol === "V") return root + "7";
  if (symbol === "ii" || symbol === "iii" || symbol === "vi") return root + "m7";
  if (symbol === "vii") return root + "m7b5";
  return root;
}

const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const DEGREE_FORMULAS = {
  I: { intervals: [0, 4, 7, 11], guideDegrees: [1, 3] },
  ii: { intervals: [2, 5, 9, 0], guideDegrees: [1, 3] },
  iii: { intervals: [4, 7, 11, 2], guideDegrees: [1, 3] },
  IV: { intervals: [5, 9, 0, 4], guideDegrees: [1, 3] },
  V: { intervals: [7, 11, 2, 5], guideDegrees: [1, 3] },
  vi: { intervals: [9, 0, 4, 7], guideDegrees: [1, 3] },
  vii: { intervals: [11, 2, 5, 9], guideDegrees: [1, 3] }
};

const PROGRESSION_OPTIONS = {
  "ii–V–I": ["ii", "V", "I"],
  "vi–IV–V–I": ["vi", "IV", "V", "I"],
  "I–vi–IV–V": ["I", "vi", "IV", "V"],
  "I–IV–V–I": ["I", "IV", "V", "I"]
};

const STAGES = [
  {
    key: "START_CHORD",
    title: "1. Build starting chord",
    instruction: "Select all four notes of the current chord."
  },
  {
    key: "IDENTIFY_GUIDES",
    title: "2. Identify guide tones",
    instruction: "From that voicing, select the 3rd and 7th only."
  },
  {
    key: "MOVE_GUIDES",
    title: "3. Move guide tones",
    instruction: "Transform each guide tone into the next chord. A voice may stay put if it is already correct."
  },
  {
    key: "FILL_CHORD",
    title: "4. Fill destination chord",
    instruction: "The guide tones are already part of the chord. Add the remaining two chord tones."
  }
];

function normalizeNote(index) {
  return NOTES[((index % 12) + 12) % 12];
}

function noteIndex(note) {
  return NOTES.indexOf(note);
}

function transposeNote(note, semitones) {
  return normalizeNote(noteIndex(note) + semitones);
}

function buildChordsForKey(key) {
  const rootOffset = noteIndex(key);

  return Object.fromEntries(
    Object.entries(DEGREE_FORMULAS).map(([symbol, formula]) => {
      const tones = formula.intervals.map((interval) => normalizeNote(rootOffset + interval));
      const guide = formula.guideDegrees.map((index) => tones[index]);
      return [symbol, { tones, guide }];
    })
  );
}

function buildGrid(rows = 8, cols = 17) {
  const grid = [];

  for (let visualRow = 0; visualRow < rows; visualRow++) {
    const rowOffset = (rows - 1 - visualRow) * 5;
    const cells = [];

    for (let col = 0; col < cols; col++) {
      const pitchClass = col + rowOffset;
      cells.push({
        id: `${visualRow}-${col}`,
        row: visualRow,
        col,
        pitchClass,
        note: normalizeNote(pitchClass)
      });
    }

    grid.push(cells);
  }

  return grid;
}

const GRID = buildGrid();
const DEFAULT_MIDI_ANCHOR_NOTE = 60; // Middle C

function defaultAnchorCellId() {
  // Grid pitchClass values span roughly 0..51; 24 is a C near the center.
  const preferredPitch = 24;
  const all = GRID.flat();
  const exact = all.find((c) => c.pitchClass === preferredPitch && c.note === "C");
  if (exact) return exact.id;

  const cCells = all.filter((c) => c.note === "C");
  if (cCells.length === 0) return all[0]?.id ?? "0-0";

  return cCells
    .map((cell) => ({ cell, d: Math.abs(cell.pitchClass - preferredPitch) }))
    .sort((a, b) => a.d - b.d)[0].cell.id;
}

function parseProgression(text, chords) {
  const tokens = text
    .replaceAll("–", " ")
    .replaceAll("-", " ")
    .replaceAll("→", " ")
    .replaceAll(",", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const valid = tokens.filter((token) => chords[token]);
  return valid.length >= 2 ? valid : null;
}

function samePitchSet(cells, targetNotes) {
  if (cells.length !== targetNotes.length) return false;
  return cells.map((c) => c.note).sort().join(",") === [...targetNotes].sort().join(",");
}

function containsPitchSet(cells, targetNotes) {
  const selected = cells.map((c) => c.note);
  return targetNotes.every((note) => selected.includes(note));
}

function distance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) * 1.35;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((item, index) => {
    const rest = [...arr.slice(0, index), ...arr.slice(index + 1)];
    for (const perm of permutations(rest)) out.push([item, ...perm]);
  });
  return out;
}

function bestMapping(fromCells, toCells) {
  let best = null;

  for (const perm of permutations(toCells)) {
    const pairs = fromCells.map((from, index) => {
      const to = perm[index];
      return { from, to, distance: distance(from, to) };
    });

    const total = pairs.reduce((sum, pair) => sum + pair.distance, 0);
    const maxJump = Math.max(...pairs.map((pair) => pair.distance));
    const score = total + maxJump * 0.15;

    if (!best || score < best.score) {
      best = { pairs, total, maxJump, score };
    }
  }

  return best;
}

function generateGuideCandidates(startGuides, toGuideNotes) {
  const allCells = GRID.flat();
  const candidatesByNote = toGuideNotes.map((note) => allCells.filter((cell) => cell.note === note));
  const out = [];

  for (const a of candidatesByNote[0]) {
    for (const b of candidatesByNote[1]) {
      if (a.id !== b.id) out.push([a, b]);
    }
  }

  for (const first of startGuides) {
    for (const second of startGuides) {
      if (first.id === second.id) continue;
      const pair = [first, second];
      if (samePitchSet(pair, toGuideNotes)) out.push(pair);
    }
  }

  const seen = new Set();
  return out.filter((pair) => {
    const key = pair.map((cell) => cell.id).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function App() {
  const [keyCenter, setKeyCenter] = useState("C");
  const [progressionName, setProgressionName] = useState("ii–V–I");
  const [customText, setCustomText] = useState("ii V I");
  const [useCustom, setUseCustom] = useState(false);

  const [pairIndex, setPairIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);

  const [startVoicing, setStartVoicing] = useState([]);
  const [startGuides, setStartGuides] = useState([]);
  const [movedGuides, setMovedGuides] = useState([]);
  const [selected, setSelected] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [showHints, setShowHints] = useState(false);
  const [awaitingNextRound, setAwaitingNextRound] = useState(false);
  const [pendingDestination, setPendingDestination] = useState(null);
  const [transitionSummary, setTransitionSummary] = useState(null);

  const midiSupported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  const [midiStatus, setMidiStatus] = useState(midiSupported ? "disconnected" : "unsupported");
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState("");
  const lastMidiCellRef = useRef(null);
  const midiAccessRef = useRef(null);
  const midiHandlerRef = useRef(null);
  const midiPressedRef = useRef({});

  const chords = useMemo(() => buildChordsForKey(keyCenter), [keyCenter]);

  const progression = useMemo(() => {
    if (useCustom) return parseProgression(customText, chords) || PROGRESSION_OPTIONS["ii–V–I"];
    return PROGRESSION_OPTIONS[progressionName];
  }, [useCustom, customText, progressionName, chords]);

  const fromSymbol = progression[pairIndex % progression.length];
  const toSymbol = progression[(pairIndex + 1) % progression.length];

  const fromChord = chords[fromSymbol];
  const toChord = chords[toSymbol];
  const stage = STAGES[stageIndex];

  const expectedGuideNotes =
    stage.key === "IDENTIFY_GUIDES"
      ? fromChord.guide
      : toChord.guide;

  function resetAll(nextPreset = progressionName, custom = useCustom, nextKey = keyCenter) {
    setKeyCenter(nextKey);
    setProgressionName(nextPreset);
    setUseCustom(custom);
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
  }

  function activeSelection() {
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
    if (stage.key === "MOVE_GUIDES") return 2;
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
    const anchorPitch = GRID.flat().find((c) => c.id === defaultAnchorCellId())?.pitchClass ?? 24;

    const delta = noteNumber - DEFAULT_MIDI_ANCHOR_NOTE;
    const targetPitch = anchorPitch + delta;
    const byAbsolute = GRID.flat().find((c) => c.pitchClass === targetPitch) || null;
    if (byAbsolute) return byAbsolute;

    const pitchClass = ((noteNumber % 12) + 12) % 12;
    return pickCellForPitchClass(pitchClass);
  }

  function onMidiNoteOn(noteNumber, velocity) {
    if (velocity <= 0) return; // note-on with velocity 0 is often "note off"

    if (midiPressedRef.current[String(noteNumber)]) return;

    const cell = resolveMidiCell(noteNumber);
    if (!cell) return;

    midiPressedRef.current[String(noteNumber)] = cell.id;
    lastMidiCellRef.current = cell;
    selectCell(cell, { ignoreMax: true });
  }

  function onMidiNoteOff(noteNumber) {
    const id = midiPressedRef.current[String(noteNumber)];
    if (!id) return;
    delete midiPressedRef.current[String(noteNumber)];

    const cell = GRID.flat().find((c) => c.id === id);
    if (!cell) return;
    deselectCell(cell);
  }

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

        const refreshInputs = () => {
          const next = Array.from(access.inputs.values()).map((input) => ({
            id: input.id,
            name: input.name || "MIDI input",
            manufacturer: input.manufacturer || ""
          }));
          setMidiInputs(next);
          setMidiStatus(next.length > 0 ? "connected" : "disconnected");
          setSelectedMidiInputId((currentId) => {
            if (currentId && next.some((i) => i.id === currentId)) return currentId;
            return next[0]?.id ?? "";
          });
        };

        refreshInputs();
        access.onstatechange = refreshInputs;
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
      if (!data || data.length < 3) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const velocity = data[2];
      if (status === 0x90) {
        if (velocity === 0) onMidiNoteOff(note);
        else onMidiNoteOn(note, velocity);
      } else if (status === 0x80) {
        onMidiNoteOff(note);
      }
    };

    midiHandlerRef.current = onMessage;
    input.onmidimessage = onMessage;

    return () => {
      if (input.onmidimessage === onMessage) input.onmidimessage = null;
    };
  }, [midiStatus, selectedMidiInputId]); // eslint-disable-line react-hooks/exhaustive-deps

  function checkStage() {
    if (stage.key === "START_CHORD") {
      const ok = samePitchSet(startVoicing, fromChord.tones);
      setFeedback(ok
        ? { type: "good", title: "Starting chord identified.", body: "Now identify its guide tones: the 3rd and 7th." }
        : { type: "bad", title: "Not the starting chord.", body: `Expected ${fromSymbol} in ${keyCenter}: ${fromChord.tones.join(" · ")}` }
      );
      return ok;
    }

    if (stage.key === "IDENTIFY_GUIDES") {
      const selectedInsideVoicing = startGuides.every((cell) => startVoicing.some((voiceCell) => voiceCell.id === cell.id));
      const ok = selectedInsideVoicing && samePitchSet(startGuides, fromChord.guide);
      setFeedback(ok
        ? { type: "good", title: "Guide tones found.", body: `${fromSymbol} guide tones: ${fromChord.guide.join(" and ")}.` }
        : {
            type: "bad",
            title: "Wrong guide tones.",
            body: selectedInsideVoicing
              ? `The guide tones are the 3rd and 7th: ${fromChord.guide.join(" · ")}`
              : "Guide tones must come from the starting voicing you just built."
          }
      );
      return ok;
    }

    if (stage.key === "MOVE_GUIDES") {
      const correctNotes = samePitchSet(movedGuides, toChord.guide);
      const mapping = startGuides.length === 2 && movedGuides.length === 2 ? bestMapping(startGuides, movedGuides) : null;

      const guideCandidates = generateGuideCandidates(startGuides, toChord.guide);

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
              ? `Movement ${mapping?.total.toFixed(1)}. Best possible ${optimal?.total.toFixed(1)}. Remember: a guide tone can stay if it is already in the next guide-tone set.`
              : `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}. One voice may stay if already correct.`
          }
      );

      return ok;
    }

    if (stage.key === "FILL_CHORD") {
      const combined = [...movedGuides, ...selected];
      const ok =
        combined.length === 4 &&
        samePitchSet(combined, toChord.tones) &&
        containsPitchSet(combined, movedGuides.map((c) => c.note));

      if (ok) {
        const completedDestination = combined;
        setPendingDestination(completedDestination);
        setAwaitingNextRound(true);
        setTransitionSummary({
          title: "Correct transition",
          body: `${fromSymbol} → ${toSymbol} in ${keyCenter} complete.`,
          next: `Next round starts from ${toSymbol} with those notes already selected.`
        });
        setFeedback(null);
      } else {
        setFeedback({
          type: "bad",
          title: "Chord not complete.",
          body: `Expected ${toSymbol} in ${keyCenter}: ${toChord.tones.join(" · ")}. The orange guide tones are already included; add the other two tones.`
        });
      }

      return ok;
    }

    return false;
  }

  function advance() {
    if (awaitingNextRound) {
      startNextRound();
      return;
    }

    const ok = checkStage();
    if (!ok) return;

    if (stage.key === "START_CHORD") {
      setStageIndex(1);
      setFeedback(null);
      return;
    }

    if (stage.key === "IDENTIFY_GUIDES") {
      setStageIndex(2);
      setFeedback(null);
      return;
    }

    if (stage.key === "MOVE_GUIDES") {
      setStageIndex(3);
      setSelected([]);
      setFeedback(null);
      return;
    }
  }

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
    setStageIndex(0);
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

    // Hints now mean: outline the correct answer for the current step.
    // Stage 1: any cell whose pitch is in the source chord.
    // Stage 2: the guide tones inside the user's selected source voicing.
    // Stage 3: any destination guide-tone cell, plus source guide anchors that can stay.
    // Stage 4: remaining destination chord tones, while moved guide tones stay locked.
    const remainingDestinationTones = toChord.tones.filter((note) => !toChord.guide.includes(note));

    const hintAnswer =
      showHints &&
      (
        (stage.key === "START_CHORD" && fromChord.tones.includes(cell.note)) ||
        (stage.key === "IDENTIFY_GUIDES" &&
          startVoicing.some((c) => c.id === cell.id) &&
          fromChord.guide.includes(cell.note)) ||
        (stage.key === "MOVE_GUIDES" && toChord.guide.includes(cell.note)) ||
        (stage.key === "FILL_CHORD" &&
          !isMovedGuide &&
          remainingDestinationTones.includes(cell.note))
      );

    const isSuccessfulDestinationTone =
      awaitingNextRound &&
      pendingDestination?.some((destinationCell) => destinationCell.id === cell.id);

    return [
      "cell",
      isSelected ? "selected" : "",
      hintAnswer ? "guide-hint" : "",
      isStartVoicing && stage.key !== "START_CHORD" ? "ghost" : "",
      isStartGuide ? "source-guide" : "",
      isMovedGuide ? "moved-guide" : "",
      isFinalLockedGuide ? "locked final-guide" : "",
      isSuccessfulDestinationTone ? "success-tone" : ""
    ].filter(Boolean).join(" ");
  }

  const currentSelection = activeSelection();
  const displaySelection = stage.key === "FILL_CHORD" ? [...movedGuides, ...selected] : currentSelection;
  const selectionText = displaySelection.map((c) => c.note).join(" ") || "—";
  const canAdvance = awaitingNextRound || currentSelection.length === maxSelectionsForStage();

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="eyebrow">Isomorphic Grid</p>
            <h1>Voice Leading Trainer</h1>
          </div>

          <button className="ghost-button" onClick={() => resetAll()}>
            <RotateCcw size={16} />
            Reset
          </button>
        </div>

        <div className="controls key-controls">
          <label>
            Key
            <select
              value={keyCenter}
              onChange={(event) => resetAll(progressionName, useCustom, event.target.value)}
            >
              {MAJOR_KEYS.map((key) => (
                <option key={key} value={key}>{key} major</option>
              ))}
            </select>
          </label>

          <label>
            Preset
            <select
              value={progressionName}
              onChange={(event) => resetAll(event.target.value, false)}
            >
              {Object.keys(PROGRESSION_OPTIONS).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>

          <label>
            Custom progression
            <input
              value={customText}
              onChange={(event) => {
                setCustomText(event.target.value);
                setUseCustom(true);
                resetAll(progressionName, true, keyCenter);
              }}
              placeholder="ii V I"
            />
          </label>

          <button
            className={showHints ? "hint-button active" : "hint-button"}
            onClick={() => setShowHints((value) => !value)}
            type="button"
          >
            <Eye size={16} />
            Hints
          </button>
        </div>

        <div className="midi-card">
          <div className="midi-controls">
            <label>
              MIDI
              <select
                value={selectedMidiInputId}
                onChange={(e) => setSelectedMidiInputId(e.target.value)}
                disabled={midiStatus !== "connected" || midiInputs.length === 0}
              >
                {midiInputs.length === 0 ? (
                  <option value="">No MIDI inputs</option>
                ) : (
                  midiInputs.map((input) => (
                    <option key={input.id} value={input.id}>
                      {input.manufacturer ? `${input.manufacturer} — ` : ""}{input.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>

        <div className="flow-strip">
          {STAGES.map((item, index) => (
            <div key={item.key} className={index === stageIndex ? "flow-step active" : index < stageIndex ? "flow-step done" : "flow-step"}>
              {index + 1}
            </div>
          ))}
        </div>

        <div className={awaitingNextRound ? "stage-card success" : "stage-card"}>
          <p className="eyebrow">{keyCenter} major · {fromSymbol} → {toSymbol}</p>
          <h2>{awaitingNextRound ? "Transition complete" : stage.title}</h2>
          <div className="stage-content">
  {!awaitingNextRound && (
    <p className="instruction">{stage.instruction}</p>
  )}

  {awaitingNextRound && transitionSummary && (
    <div className="transition-summary">
      <strong>{transitionSummary.title}</strong>
      <span>{transitionSummary.body}</span>
      <em>{transitionSummary.next}</em>
    </div>
  )}
</div>
        </div>

        <div className="chord-compare-card">
          <div className="chord-block">
            <p className="eyebrow">Source</p>
            <h3>{fromSymbol}</h3>
            <div className="chord-name">{getChordName(fromSymbol, fromChord.tones)}</div>
            <div className="chord-tones">{fromChord.tones.join(" · ")}</div>
          </div>

          <div className="arrow">→</div>

          <div className="chord-block">
            <p className="eyebrow">Destination</p>
            <h3>{toSymbol}</h3>
            <div className="chord-name">{getChordName(toSymbol, toChord.tones)}</div>
            <div className="chord-tones">{toChord.tones.join(" · ")}</div>
          </div>
        </div>

        <div className="grid-wrap">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID[0].length}, 42px)` }}>
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

        <div className="action-row">
          <div className="selection-readout">
            <span>{stage.key === "FILL_CHORD" ? "Chord so far" : "Selected"}</span>
            <strong>{selectionText}</strong>
          </div>

          <button className="primary-button" disabled={!canAdvance} onClick={advance}>
            {awaitingNextRound ? (
              <>
                Next round
                <ChevronRight size={17} />
              </>
            ) : (
              <>
                <Check size={17} />
                Check / Continue
              </>
            )}
          </button>

          <button className="secondary-button" disabled={awaitingNextRound} onClick={clearCurrentStage}>
            Clear
          </button>

          <button className="secondary-button" disabled={awaitingNextRound} onClick={() => {
            setPairIndex((value) => (value + 1) % progression.length);
            setStageIndex(0);
            setStartVoicing([]);
            setStartGuides([]);
            setMovedGuides([]);
            setSelected([]);
            setFeedback(null);
            setTransitionSummary(null);
          }}>
            Skip
            <ChevronRight size={17} />
          </button>
        </div>

        {feedback && (
          <div className={`feedback ${feedback.type}`}>
            <strong>{feedback.title}</strong>
            <span>{feedback.body}</span>
          </div>
        )}

        <div className="hint">
          <Target size={15} />
          Hints are off by default. When enabled, orange outlines show the correct answer for the current step.
        </div>
      </section>
    </main>
  );
}

export default App;
