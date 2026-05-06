/**
 * Voice Leading Scoring Module for IsoFlow
 */

function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const perms = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const restPerms = getPermutations(rest);
    for (const p of restPerms) {
      perms.push([arr[i], ...p]);
    }
  }
  return perms;
}

function calculateDistance(source, target) {
  // We assume both are same length (4)
  // Since they are MIDI notes, we need to find the best assignment (minimal total movement)
  const perms = getPermutations(target);
  let minTotal = Infinity;
  let minMax = Infinity;

  for (const p of perms) {
    let total = 0;
    let max = 0;
    for (let i = 0; i < source.length; i++) {
      const diff = Math.abs(source[i] - p[i]);
      total += diff;
      max = Math.max(max, diff);
    }
    if (total < minTotal) {
      minTotal = total;
      minMax = max;
    }
  }
  return { total: minTotal, maxJump: minMax };
}

function generateCandidates(pitchClasses, rangeMin, rangeMax) {
  // Generate all possible MIDI notes for each pitch class in range
  const possibleNotes = pitchClasses.map(pc => {
    const notes = [];
    for (let m = rangeMin; m <= rangeMax; m++) {
      if (((m % 12) + 12) % 12 === pc) {
        notes.push(m);
      }
    }
    return notes;
  });

  // Cartesian product of all possible notes
  const results = [];
  function backtrack(index, current) {
    if (index === possibleNotes.length) {
      // Check for uniqueness and sort
      const sorted = [...current].sort((a, b) => a - b);
      // Ensure all notes are unique (different octaves of same PC might happen if range is large, 
      // but pitchClasses are unique, so this is just a safety check)
      const unique = new Set(sorted).size === sorted.length;
      if (unique) results.push(sorted);
      return;
    }

    for (const note of possibleNotes[index]) {
      current.push(note);
      backtrack(index + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return results;
}

function getGuideTones(midiNotes, pitchClasses) {
  // pitchClasses[1] is 3rd, pitchClasses[2] is 7th (assuming sorted root, 3, 5, 7)
  // Actually, we should pass them explicitly or identify them.
  // For now, assume pitchClasses array is [root, 3, 5, 7]
  const pc3 = pitchClasses[1];
  const pc7 = pitchClasses[2];
  
  const guideMidis = [];
  for (const m of midiNotes) {
    const pc = ((m % 12) + 12) % 12;
    if (pc === pc3 || pc === pc7) {
      guideMidis.push(m);
    }
  }
  return guideMidis;
}

export function scoreVoiceLeadingTransition(
  sourceMidiNotes,
  userDestinationMidiNotes,
  targetChordPitchClasses,
  sourceChordPitchClasses,
  destinationChordPitchClasses
) {
  // 1. Validate destination chord
  const userPcs = userDestinationMidiNotes.map(m => ((m % 12) + 12) % 12).sort((a, b) => a - b);
  const targetPcs = [...targetChordPitchClasses].sort((a, b) => a - b);
  
  const isCorrectChord = userPcs.length === targetPcs.length && 
    userPcs.every((pc, i) => pc === targetPcs[i]);

  if (!isCorrectChord) {
    return {
      userDistance: 0,
      optimalDistance: 0,
      excessDistance: 0,
      grade: "incorrect",
      commonTonesKept: 0,
      guideTonesResolved: false,
      message: "not the target chord"
    };
  }

  // 2. User distance
  const { total: userDistance } = calculateDistance(sourceMidiNotes, userDestinationMidiNotes);

  // 3. Generate optimal candidates — clamp range to 2 octaves to prevent
  //    exponential blowup when the source voicing spans a wide register.
  const MAX_RANGE = 24;
  const sourceMid = (Math.min(...sourceMidiNotes) + Math.max(...sourceMidiNotes)) / 2;
  const rangeMin = Math.round(sourceMid - MAX_RANGE / 2);
  const rangeMax = Math.round(sourceMid + MAX_RANGE / 2);
  const candidates = generateCandidates(targetChordPitchClasses, rangeMin, rangeMax);

  // 4. Find optimal distance
  let optimalDistance = Infinity;
  for (const cand of candidates) {
    const { total: d } = calculateDistance(sourceMidiNotes, cand);
    if (d < optimalDistance) {
      optimalDistance = d;
    }
  }

  // 5. Comparison
  const excessDistance = userDistance - optimalDistance;
  let grade = "wide";
  let message = "△ wider movement";

  if (excessDistance === 0) {
    grade = "minimal";
    message = "✓ minimal movement";
  } else if (excessDistance <= 2) {
    grade = "close";
    message = "✓ close voicing";
  }

  // Guide tones check (simplistic heuristic)
  // Identify source guides and target guides
  const sourceGuides = getGuideTones(sourceMidiNotes, sourceChordPitchClasses);
  const userDestGuides = getGuideTones(userDestinationMidiNotes, destinationChordPitchClasses);
  
  // Minimal resolution for guides?
  // Let's just count how many common tones (including guides) were kept
  const commonTones = userDestinationMidiNotes.filter(m => sourceMidiNotes.includes(m)).length;

  return {
    userDistance,
    optimalDistance,
    excessDistance,
    grade,
    commonTonesKept: commonTones,
    guideTonesResolved: true, // Placeholder for more complex logic
    message
  };
}
