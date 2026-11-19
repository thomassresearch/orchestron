// Rows 0..n-1 describe states; the final row is Start.
export type Chain = number[][];
export type MarkovRecipe = {
  pitch: Chain;
  rhythm: Chain;
  pitchLength: number;
  rhythmLength: number;
  seed: number;
};
export type MarkovEvent = { start: number; length: number; state: number; durationState: number };
export type MarkovError = "pitchPath" | "rhythmPath" | "searchLimit" | "capacity" | "scoreRange";

export function phraseLengths(steps: number) {
  const lengths: number[] = [];
  for (let d = 1; d * d <= steps; d++) {
    if (steps % d) continue;
    lengths.push(d);
    if (steps / d !== d) lengths.push(steps / d);
  }
  return lengths.sort((a, b) => b - a);
}

export function durationStates(subdivision: number, steps: number) {
  return [...new Set([1, 2, 4, 8, subdivision, subdivision * 2])].filter((n) => n <= steps).sort((a, b) => a - b);
}

export function initialChain(size: number, kind: "pitch" | "rhythm" | "hits"): Chain {
  return Array.from({ length: size + 1 }, (_, from) => {
    const weights = Array.from({ length: size }, (_, to) => {
      if (kind === "rhythm") return 1 / (1 + to * 0.5);
      if (to === size - 1) return 0.12;
      if (kind === "hits" || from >= size - 1) return 1;
      return 1 / (1 + Math.abs(from - to));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((n) => (n * 100) / sum);
  });
}

export function redistribute(original: number[], edge: number, percent: number) {
  const others = original.reduce((sum, n, i) => sum + (i === edge ? 0 : n), 0);
  if (!others) return original.map((_, i) => (i === edge ? 100 : 0));
  return original.map((n, i) => (i === edge ? percent : ((100 - percent) * n) / others));
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Iterative weighted backtracking. Each alternative at a fork is visited at most once.
// Long scores never recurse on the JS stack. The shared budget also bounds impossible recipes.
function walk(
  chain: Chain,
  rng: () => number,
  budget: { left: number },
  allowed: (state: number, depth: number, path: number[]) => boolean,
  advance: (state: number, depth: number, path: number[]) => boolean,
): number[] | null {
  const start = chain.length - 1;
  const path: number[] = [];
  const forks: number[][] = [];
  while (true) {
    const depth = path.length;
    const row = chain[path[depth - 1] ?? start];
    const options = (forks[depth] ??= row.map((_, i) => i).filter((i) => row[i] > 0 && allowed(i, depth, path)));
    if (!options.length) {
      forks.pop();
      if (!depth) return null;
      path.pop();
      continue;
    }
    if (--budget.left < 0) throw new Error("searchLimit");
    let threshold = rng() * options.reduce((sum, i) => sum + row[i], 0);
    let j = 0;
    while (j < options.length - 1 && (threshold -= row[options[j]]) >= 0) j++;
    const [state] = options.splice(j, 1);
    path.push(state);
    if (advance(state, depth, path)) return path;
  }
}

export function generateMarkov(steps: number, durations: number[], recipe: MarkovRecipe): MarkovEvent[] {
  const { pitchLength, rhythmLength, pitch, rhythm } = recipe;
  if (pitchLength < 1 || rhythmLength < 1 || steps % pitchLength || steps % rhythmLength)
    throw new Error("rhythmPath");
  let block = pitchLength,
    divisor = rhythmLength;
  while (divisor) [block, divisor] = [divisor, block % divisor];
  const rng = random(recipe.seed),
    budget = { left: 250000 };
  const min = durations[0],
    max = durations[durations.length - 1];
  const positions = [0],
    counts = [0];
  const firstBlockCounts: number[] = [0];
  const pitchPaths = new Map<number, number[] | null>();
  let pitches: number[] | null = null;
  const rest = pitch.length - 2;
  function pitchPhrase(slots: number) {
    if (pitchPaths.has(slots)) return pitchPaths.get(slots) ?? null;
    const total = slots * (pitchLength / block);
    const path = walk(
      pitch,
      rng,
      budget,
      (state, depth, current) => {
        // A shorter rhythm repeats its pause positions too.
        if (steps > rhythmLength && depth >= slots && (state === rest) !== (current[depth % slots] === rest))
          return false;
        return depth + 1 !== total || pitch[state][current[0] ?? state] > 0;
      },
      (_, depth) => depth + 1 === total,
    );
    pitchPaths.set(slots, path);
    return path;
  }
  const rhythmPath = walk(
    rhythm,
    rng,
    budget,
    (state, depth, path) => {
      const position = positions[depth],
        remaining = block - (position % block) - durations[state];
      if (remaining < 0) return false;
      const slots = firstBlockCounts[depth],
        count = counts[depth] + 1;
      if (position >= block && (remaining < (slots - count) * min || remaining > (slots - count) * max))
        return false;
      if (position + durations[state] === rhythmLength && rhythm[state][path[0] ?? state] <= 0) return false;
      // Every pitch window must accept the same ordered sequence of events.
      if (position < block && !remaining && !pitchPhrase(count)) return false;
      return true;
    },
    (state, depth) => {
      const next = positions[depth] + durations[state];
      const count = counts[depth] + 1;
      positions[depth + 1] = next;
      counts[depth + 1] = next % block ? count : 0;
      firstBlockCounts[depth + 1] = next === block ? count : firstBlockCounts[depth];
      if (next !== rhythmLength) return false;
      pitches = pitchPhrase(firstBlockCounts[depth + 1]);
      return true;
    },
  );
  if (!rhythmPath || !pitches)
    throw new Error(pitchPaths.size && ![...pitchPaths.values()].some(Boolean) ? "pitchPath" : "rhythmPath");
  const events: MarkovEvent[] = [];
  for (let start = 0, i = 0; start < steps; i++) {
    const durationState = rhythmPath[i % rhythmPath.length],
      length = durations[durationState];
    const phrase: number[] = pitches;
    events.push({ start, length, state: phrase[i % phrase.length], durationState });
    start += length;
  }
  return events;
}
