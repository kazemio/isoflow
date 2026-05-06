# IsoFlow

An interactive web app for learning chord voicing and voice leading on an isomorphic grid. It walks you through the mechanics of smooth chord transitions — identifying guide tones, moving them by step, and filling out the destination chord — using a layout where every interval has the same shape regardless of key.

**[Live demo →](https://kazemio.github.io/isoflow)**

---

## What it does

IsoFlow teaches voice leading through a four-stage guided exercise:

| Stage | Name | What you do |
|-------|------|-------------|
| 1 | **Build starting chord** | Select the 4 notes of the source chord on the grid or piano |
| 2 | **Identify guide tones** | Pick the 3rd and 7th from the voicing you just built |
| 3 | **Move guide tones** | Resolve them to the destination chord — each must stay put or move by half/whole step |
| 4 | **Fill destination chord** | Add the two remaining chord tones to complete the voicing |

Feedback is immediate and specific: if a guide tone leaps too far, you see which note moved, by how many semitones, and a suggested target.

---

## Views

### Isomorphic grid

The grid lays out all 12 pitch classes so that every interval looks the same in every key:

- **Moving right** → up 1 semitone
- **Moving up a row** → up 5 semitones (a perfect fourth)
- Any chord shape, scale fingering, or voice-leading motion is visually identical regardless of key

Once you learn a voicing shape in C, you can play it in any key without relearning the fingering.

### Piano keyboard

Switch to a standard piano layout (C3–C6, 37 keys) using the view toggle. All the same stages and feedback apply — use whichever view feels more natural or matches your physical instrument.

---

## Features

### Modes

**Learn mode** — Steps through the four stages with guided feedback. Use it to understand the mechanics of a specific progression and key.

**Play mode** — Continuous voice leading. Play one 4-note chord, then the next, and the app evaluates your motion as a whole. Letting go of all notes resets to the start chord.

### Progressions

Type any sequence of Roman numeral degrees (`ii V I`, `I vi IV V`, etc.) or pick from the presets:

- ii–V–I
- vi–IV–V–I
- I–vi–IV–V
- I–IV–V–I
- Random (weighted Markov transitions that follow common harmonic practice)

### Key centers

All 12 major keys: C, D♭, D, E♭, E, F, G♭, G, A♭, A, B♭, B.

### MIDI

Connect any Web MIDI–compatible controller and play notes physically rather than clicking. IsoFlow was built and tested with a **LinnStrument 200** (default base note: MIDI 30) but works with any device.

When MIDI is connected:
- Holding the correct notes for **750ms** registers the answer and auto-advances
- Correct notes flash briefly before the stage advances
- **Octave mapping toggle** — off (default): proximity-based resolution locks to the register of your first note, keeping voicings clustered. On: strict octave matching for performance use.
- In play mode, held notes carry seamlessly into the next chord's start stage

---

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:5173/isoflow/`.

### All scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:ui` | Open Vitest's visual test dashboard |
| `npm run deploy` | Build and push to GitHub Pages |

---

## How voice leading works

Guide tones are the 3rd and 7th of a chord — the two notes that define its quality (major, minor, dominant) and resolve most strongly to the next chord. Classic example:

```
Dm7 → G7 → Cmaj7

Guide tones:
  F (3rd of Dm7) → F (7th of G7)   stays put
  C (7th of Dm7) → B (3rd of G7)   moves down a half step

  B (3rd of G7)  → C (3rd of Cmaj7)  moves up a half step
  F (7th of G7)  → E (7th of Cmaj7)  moves down a half step
```

Smooth voice leading means keeping this motion as small as possible: guide tones resolve by step, and the other voices move minimally. IsoFlow grades each transition by comparing your movement to the theoretically optimal one.

---

## Music theory covered

- Diatonic seventh chords in all 12 major keys (I maj7, ii m7, iii m7, IV maj7, V7, vi m7, vii m7♭5)
- Guide tone identification (3rd and 7th)
- Voice leading: step-wise guide tone resolution, common tone retention, minimal motion
- Optimal voice leading scoring via permutation-based assignment (finds the minimum total semitone movement across all voice pairings)

---

## Tech stack

| | |
|-|--|
| Framework | React 18 |
| Build | Vite 5 |
| Tests | Vitest 4, Testing Library |
| Icons | lucide-react |
| Deploy | GitHub Pages via gh-pages |

Tests cover: music theory utilities, isomorphic grid geometry, voice leading algorithms, progression parsing, all four stage predicates (mouse and MIDI modes), MIDI cell resolution, and the voice leading scorer — 162 tests across 8 test files.

---

## Project structure

```
src/
  App.jsx               — main component: UI, stage machine, MIDI handlers
  musicUtils.js         — pure music theory and grid utilities
  voiceLeadingLogic.js  — pure stage-checking predicates
  voiceLeadingScore.js  — optimal voice leading distance scoring
  midiResolution.js     — pure MIDI-to-grid-cell resolution
  styles.css
  test/
    musicTheory.test.js
    grid.test.js
    voiceLeading.test.js
    progression.test.js
    stageChecking.test.js
    voiceLeadingScore.test.js
    midiResolution.test.js
    mouseModeFlow.test.js
```

---

## Contributing

Issues and pull requests are welcome. Run `npm test` before opening a PR — all tests should be green.

---

## License

MIT
