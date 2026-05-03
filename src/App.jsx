import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Eye } from "lucide-react";

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
    title: "Build starting chord.",
    instruction: "Select all four notes of the current chord."
  },
  {
    key: "IDENTIFY_GUIDES",
    title: "Identify guide tones.",
    instruction: "From that voicing, select the 3rd and 7th only."
  },
  {
    key: "MOVE_GUIDES",
    title: "Move guide tones.",
    instruction: "Transform each guide tone into the next chord. A voice may stay put if it is already correct."
  },
  {
    key: "FILL_CHORD",
    title: "Fill destination chord.",
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

function buildGrid(rows = 6, cols = 12, startNote = 6) {
  const grid = [];

  for (let visualRow = 0; visualRow < rows; visualRow++) {
    const rowOffset = (rows - 1 - visualRow) * 5;
    const cells = [];

    for (let col = 0; col < cols; col++) {
      const pitchClass = col + rowOffset + startNote;
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


// MIDI note sent by the bottom-left pad of the LinnStrument 200 (default: 30 = F#/Gb).
// Change if you have customised the Global Low Row Note in the LinnStrument settings.
const MIDI_BASE_NOTE = 30;

function uniqueNotesFromCells(cells) {
  return [...new Set(cells.map((c) => c.note))];
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

function generateRandomProgression() {
  const transitions = {
    "I":   [["ii",3],["IV",3],["V",4],["vi",3],["iii",1]],
    "ii":  [["V",5],["IV",2],["vii",2]],
    "iii": [["vi",4],["IV",2],["I",1]],
    "IV":  [["V",4],["ii",3],["I",2],["vii",1]],
    "V":   [["I",5],["vi",3]],
    "vi":  [["ii",4],["IV",3],["V",2]],
    "vii": [["I",5],["iii",2]]
  };
  function pick(weighted) {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of weighted) { r -= w; if (r <= 0) return v; }
    return weighted[0][0];
  }
  const len = 3 + Math.floor(Math.random() * 8);
  const result = [pick([["I",3],["vi",2],["ii",2],["IV",1]])];
  for (let i = 1; i < len; i++) {
    const opts = transitions[result[result.length - 1]];
    if (!opts) break;
    result.push(pick(opts));
  }
  return result.join(" ");
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

function generateGuideCandidates(startGuides, toGuideNotes, grid) {
  const allCells = grid.flat();
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
  const GRID = useMemo(() => buildGrid(8, 8, 6), []);

  const [keyCenter, setKeyCenter] = useState("C");
  const [customText, setCustomText] = useState("ii V I");

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
  const midiNoteOnRef = useRef(null);
  const midiNoteOffRef = useRef(null);
  const [midiHeldCells, setMidiHeldCells] = useState([]);
  const advanceRef = useRef(null);

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
    const pitchClass = ((noteNumber % 12) + 12) % 12;

    const cellsWithNote = GRID.flat().filter((c) => ((c.pitchClass % 12) + 12) % 12 === pitchClass);
    if (cellsWithNote.length === 0) return null;

    // IDENTIFY_GUIDES: prefer a cell already in startVoicing.
    if (stage.key === "IDENTIFY_GUIDES" && startVoicing.length > 0) {
      const fromVoicing = cellsWithNote.find((c) => startVoicing.some((v) => v.id === c.id));
      if (fromVoicing) return fromVoicing;
    }

    // MOVE_GUIDES: prefer the cell closest to a source guide tone.
    if (stage.key === "MOVE_GUIDES" && startGuides.length > 0) {
      return cellsWithNote
        .map((c) => ({ c, d: Math.min(...startGuides.map((sg) => distance(sg, c))) }))
        .sort((a, b) => a.d - b.d)[0].c;
    }

    // FILL_CHORD: if the pressed note is already a locked guide tone, return that exact
    // cell — selectableCellsForStage will block it, preventing it from being added to
    // `selected` and inflating the combined count above 4.
    if (stage.key === "FILL_CHORD" && movedGuides.length > 0) {
      const locked = movedGuides.find((c) => ((c.pitchClass % 12) + 12) % 12 === pitchClass);
      if (locked) return locked;
    }

    // Always anchor to the grid centre so every note independently seeks the middle
    // regardless of octave played or what was pressed previously.
    const anchor = { row: (GRID.length - 1) / 2, col: (GRID[0].length - 1) / 2 };

    return cellsWithNote
      .map((cell) => ({ cell, d: distance(anchor, cell) }))
      .sort((a, b) => a.d - b.d)[0].cell;
  }

  function refreshMidiHeldCells() {
    const ids = Object.values(midiPressedRef.current || {});
    const next = ids
      .map((id) => GRID.flat().find((c) => c.id === id))
      .filter(Boolean);
    setMidiHeldCells(next);
  }

  function onMidiNoteOn(noteNumber, velocity) {
    if (velocity <= 0) return; // note-on with velocity 0 is often "note off"

    if (midiPressedRef.current[String(noteNumber)]) return;

    const cell = resolveMidiCell(noteNumber);
    if (!cell) return;

    midiPressedRef.current[String(noteNumber)] = cell.id;
    lastMidiCellRef.current = cell;
    refreshMidiHeldCells();

    selectCell(cell, { ignoreMax: true });
  }

  function onMidiNoteOff(noteNumber) {
    const id = midiPressedRef.current[String(noteNumber)];
    if (!id) return;
    delete midiPressedRef.current[String(noteNumber)];

    refreshMidiHeldCells();

    const cell = GRID.flat().find((c) => c.id === id);
    if (cell) deselectCell(cell);
  }

  midiNoteOnRef.current = onMidiNoteOn;
  midiNoteOffRef.current = onMidiNoteOff;

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
        if (velocity === 0) midiNoteOffRef.current?.(note);
        else midiNoteOnRef.current?.(note, velocity);
      } else if (status === 0x80) {
        midiNoteOffRef.current?.(note);
      }
    };

    midiHandlerRef.current = onMessage;
    input.onmidimessage = onMessage;

    return () => {
      if (input.onmidimessage === onMessage) input.onmidimessage = null;
    };
  }, [midiStatus, selectedMidiInputId]);


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

      // In MIDI mode the user can't control which exact cell a note lands on,
      // so skip the movement-distance penalty and accept correct pitches only.
      if (midiPlayMode) {
        setFeedback(correctNotes
          ? { type: "good", title: "Guide tones moved.", body: `${toChord.guide.join(" and ")} in place.` }
          : { type: "bad", title: "Wrong destination guide tones.", body: `For ${toSymbol} in ${keyCenter}, guide tones are: ${toChord.guide.join(" · ")}.` }
        );
        return correctNotes;
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
        setTransitionSummary(`✓ ${toSymbol} complete`);
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

  function advanceStage() {
    if (stage.key === "START_CHORD") {
      setStageIndex(1);
    } else if (stage.key === "IDENTIFY_GUIDES") {
      const newMidiPressed = {};
      const newMovedGuides = [];
      
      for (const [noteNum, id] of Object.entries(midiPressedRef.current)) {
        const cell = GRID.flat().find((c) => c.id === id);
        if (cell && toChord.guide.includes(cell.note)) {
          newMidiPressed[noteNum] = id;
          newMovedGuides.push(cell);
        }
      }
      
      midiPressedRef.current = newMidiPressed;
      refreshMidiHeldCells();
      setMovedGuides(newMovedGuides);
      setStageIndex(2);
    } else if (stage.key === "MOVE_GUIDES") {
      setStageIndex(3);
      setSelected([]);
    }
    setFeedback(null);
  }

  function advance() {
    if (awaitingNextRound) { startNextRound(); return; }
    const ok = checkStage();
    if (ok) advanceStage();
  }

  advanceRef.current = advance;

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
    setStageIndex(1);
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
    const isMidiHeld = midiHeldCells.some((c) => c.id === cell.id);

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
      isMidiHeld ? "midi-held" : "",
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


  // MIDI mode: auto-submit after holding correct notes for 0.5 seconds.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!midiPlayMode || !canAdvance) return;
    const timer = setTimeout(() => advanceRef.current?.(), 500);
    return () => clearTimeout(timer);
  }, [midiPlayMode, canAdvance]);

  // MIDI mode: when stage advances, re-apply physically-held notes to the new stage's
  // selection so the user doesn't have to release and repress.
  // Exception: MOVE_GUIDES requires the user to actively press NEW destination notes —
  // re-applying the old guide tones would trigger an immediate wrong-notes error.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!midiPlayMode) return;
    if (stage.key === "MOVE_GUIDES") return;
    const heldIds = Object.values(midiPressedRef.current);
    if (heldIds.length === 0) return;
    setFeedback(null);
    setActiveSelection(() =>
      heldIds
        .map((id) => GRID.flat().find((c) => c.id === id))
        .filter(Boolean)
        .filter((c) => !movedGuides.some((mg) => mg.id === c.id))
    );
  }, [stageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse mode: auto-check when selection is complete, then advance or clear.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (midiPlayMode || awaitingNextRound || !canAdvance) return;
    const ok = checkStage();
    const timer = setTimeout(() => { if (ok) advanceStage(); else clearCurrentStage(); }, 500);
    return () => clearTimeout(timer);
  }, [canAdvance, midiPlayMode, awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start next round after holding the completed chord state.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!awaitingNextRound) return;
    const timer = setTimeout(() => startNextRound(), 500);
    return () => clearTimeout(timer);
  }, [awaitingNextRound]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="controls key-controls">
          <div className="brand"><span className="brand-icon">IF</span>IsoFlow</div>

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
            <div className="progression-field">
              <input
                list="progression-presets"
                value={customText}
                onChange={(e) => { setCustomText(e.target.value); resetAll(); }}
                placeholder="ii V I"
              />
              <datalist id="progression-presets">
                {Object.entries(PROGRESSION_OPTIONS).map(([name, chords]) => (
                  <option key={name} value={chords.join(" ")}>{name}</option>
                ))}
              </datalist>
              <button
                type="button"
                className="random-button"
                onClick={() => { const p = generateRandomProgression(); setCustomText(p); resetAll(); }}
                title="Random"
              >
                <Dices size={15} />
              </button>
            </div>
          </label>

          <label className="ctrl-midi">
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

          <label className="ctrl-hint">
            <span className="hint-label-text">Hints</span>
            <button
              className={showHints ? "hint-button active" : "hint-button"}
              onClick={() => setShowHints((value) => !value)}
              type="button"
              title="Hints"
            >
              <Eye size={16} />
              <span className="hint-text">{showHints ? "On" : "Off"}</span>
            </button>
          </label>
        </div>

        <div className={`step-row${feedback && !awaitingNextRound ? ` step-${feedback.type}` : awaitingNextRound ? " step-good" : ""}`}>
          <div className="flow-strip">
            {STAGES.map((item, index) => (
              <div key={item.key} className={index === stageIndex ? "flow-step active" : index < stageIndex ? "flow-step done" : "flow-step"} />
            ))}
          </div>
          <div className="step-line fade-in" key={feedback?.title || transitionSummary || stage.title}>
            <span className="step-text">
              {feedback && !awaitingNextRound
                ? feedback.title
                : awaitingNextRound
                  ? transitionSummary || "Transition complete"
                  : stage.title}
            </span>
          </div>
          <div className="chord-line">
            <span className="chord-unit">
              <strong>{fromSymbol}</strong>
              <span className="chord-unit-name">{getChordName(fromSymbol, fromChord.tones)}</span>
              <span className="chord-unit-notes">{fromChord.tones.join(" · ")}</span>
            </span>
            <span className="chord-sep">→</span>
            <span className="chord-unit">
              <strong>{toSymbol}</strong>
              <span className="chord-unit-name">{getChordName(toSymbol, toChord.tones)}</span>
              <span className="chord-unit-notes">{toChord.tones.join(" · ")}</span>
            </span>
          </div>
        </div>

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

      </section>
    </main>
  );
}

export default App;
