// Rows 0..n-1 describe states; the final row is Start.
type Weights = number[] | Map<number, number>;
type OnsetMixture = { parts: [Map<number, number>, number][]; total: number };
type ChainRow = Weights | OnsetMixture;
export type Chain = ChainRow[];
export type Observations = (string | number)[][];

function weight(row: ChainRow, i: number) {
  if ("parts" in row) {
    const count = row.parts.reduce((sum, [group, occurrences]) => sum + (group.get(i) ?? 0) * occurrences, 0);
    return (100 * count) / row.total;
  }
  return Array.isArray(row) ? row[i] : (row.get(i) ?? 0);
}

function weights(row: ChainRow): Weights {
  if (!("parts" in row)) return row;
  const combined = new Map<number, number>();
  for (const [group, occurrences] of row.parts) {
    for (const [to, voices] of group) combined.set(to, (combined.get(to) ?? 0) + voices * occurrences);
  }
  for (const [to, count] of combined) combined.set(to, (100 * count) / row.total);
  return combined;
}

export function editableRow(row: ChainRow, size: number): number[] {
  const values = weights(row);
  return Array.isArray(values) ? values : Array.from({ length: size }, (_, i) => values.get(i) ?? 0);
}

/** Write an edited row back into its full graph, including any temporarily hidden drum Rest. */
export function replaceRow(chain: Chain, from: number, values: number[], hideRest = false): Chain {
  const result = chain.slice();
  if (!hideRest) result[from] = values;
  else {
    const rest = values.length;
    const index = from === rest ? chain.length - 1 : from;
    const original = weight(chain[index], rest);
    const retained = original < 100 ? original : 0;
    result[index] = [...values.map((n) => n * (1 - retained / 100)), retained];
  }
  return result;
}

/** Count each pair across adjacent onsets, including the loop seam. Keep large Score rows sparse. */
export function learnChain(keys: (number | string)[], observations: Observations): Chain {
  const index = new Map(keys.map((key, i) => [key, i]));
  const add = (counts: Map<number, number>, key: number, n: number) => counts.set(key, (counts.get(key) ?? 0) + n);
  function normalize(counts: Map<number, number>) {
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return new Map([...counts].map(([i, n]) => [i, (100 * n) / total]));
  }
  const frequencies = new Map<number, number>();
  const groups = observations
    .map((onset) => {
      const counts = new Map<number, number>();
      for (const key of onset) {
        const i = index.get(key);
        if (i === undefined) continue;
        add(counts, i, 1);
        add(frequencies, i, 1);
      }
      return counts;
    })
    .filter((group) => group.size);
  if (!groups.length) return initialChain(keys.length, "rhythm");

  // Reference destination onsets first. All voices leading only to the same
  // chord share its distribution, even for thousands of distinct Score lengths.
  const successors = keys.map(() => new Map<number, number>());
  groups.forEach((group, at) => {
    const next = (at + 1) % groups.length;
    for (const [from, count] of group) add(successors[from], next, count);
  });
  const groupSizes = groups.map((group) => [...group.values()].reduce((sum, n) => sum + n, 0));
  const normalizedGroups = groups.map(normalize);
  const fallback = normalize(frequencies);
  const chain = successors.map((next) => {
    if (next.size === 0) return fallback;
    if (next.size === 1) return normalizedGroups[next.keys().next().value!];
    const pairs = [...next];
    const total = pairs.reduce((sum, [at, count]) => sum + groupSizes[at] * count, 0);
    const row: OnsetMixture = { parts: pairs.map(([at, count]) => [groups[at], count]), total };
    // Expand ordinary rows once for playback. Large polyphonic Score rows
    // retain their shared onsets and expand only when displayed or sampled.
    return keys.length <= 128 || pairs.every(([at]) => groups[at].size === 1) ? weights(row) : row;
  });
  return [...chain, normalizedGroups[0]];
}
export type MarkovRecipe = {
  pitch: Chain;
  rhythm: Chain;
  pitchLength: number;
  rhythmLength: number;
  seed: number;
  restState?: number;
  maxNotes?: number;
};
export type MarkovEvent = { start: number; length: number; state: number; durationState: number };
export type MarkovError = "pitchPath" | "rhythmPath" | "searchLimit" | "capacity" | "scoreRange" | "emptyRows";

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

function gcd(a: number, b: number) {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function durationLabel(units: number, perStep: number) {
  const divisor = gcd(units, perStep);
  return perStep === divisor ? String(units / divisor) : `${units / divisor}/${perStep / divisor}`;
}

type ChainKind = "pitch" | "rhythm" | "hits";

export function initialChain(size: number, kind: ChainKind, hasRest = true): number[][] {
  function row(from: number) {
    const weights = Array.from({ length: size }, (_, to) => {
      if (kind === "rhythm") return 1 / (1 + to * 0.5);
      if (hasRest && to === size - 1) return 0.12;
      if (kind === "hits" || from >= size - 1) return 1;
      return 1 / (1 + Math.abs(from - to));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((n) => (n * 100) / sum);
  }
  // Score notes can have thousands of distinct lengths. Identical default rows
  // share storage until the user edits a row.
  return kind === "rhythm" ? Array(size + 1).fill(row(0)) : Array.from({ length: size + 1 }, (_, i) => row(i));
}

export type NamedChain = { keys: string[]; chain: Chain };

/** Carry relative weights across state selections, including the Start row. */
export function remapChain(previous: NamedChain, keys: string[], kind: ChainKind, learned?: Chain): Chain {
  if (previous.keys.length === keys.length && keys.every((key, i) => key === previous.keys[i]))
    return previous.chain;
  const defaults = learned ?? initialChain(keys.length, kind, keys[keys.length - 1] === "rest");
  const before = new Map(previous.keys.map((key, i) => [key, i]));
  const indexes = keys.map((key) => before.get(key));
  const cache = new Map<ChainRow, ChainRow>();
  return [...indexes, previous.keys.length].map((index, i) => {
    if (index === undefined) return defaults[i];
    const original = previous.chain[index];
    const cached = kind === "rhythm" && cache.get(original);
    if (cached) return cached;
    const weights = indexes.map((j, col) => (j === undefined ? weight(defaults[i], col) : weight(original, j)));
    const total = weights.reduce((a, b) => a + b, 0);
    const result = total ? weights.map((w) => (100 * w) / total) : defaults[i];
    if (kind === "rhythm") cache.set(original, result);
    return result;
  });
}

export function redistribute(original: number[], edge: number, percent: number) {
  const others = original.reduce((sum, n, i) => sum + (i === edge ? 0 : n), 0);
  if (original.length === 1) return [100];
  if (!others) return original.map((_, i) => (i === edge ? percent : (100 - percent) / (original.length - 1)));
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
  // Keep failed choices only when backtracking. A Score may offer thousands of
  // tick lengths at each event; retaining every untried choice at every depth
  // would make a perfectly valid long take consume quadratic memory.
  const failed: (Set<number> | undefined)[] = [];
  while (true) {
    const depth = path.length;
    const row = weights(chain[path[depth - 1] ?? start]);
    const options = Array.from(row.keys()).filter(
      (i) => weight(row, i) > 0 && !failed[depth]?.has(i) && allowed(i, depth, path),
    );
    if (!options.length) {
      if (!depth) return null;
      failed.length = depth;
      (failed[depth - 1] ??= new Set()).add(path.pop()!);
      continue;
    }
    if (--budget.left < 0) throw new Error("searchLimit");
    let threshold = rng() * options.reduce((sum, i) => sum + weight(row, i), 0);
    let j = 0;
    while (j < options.length - 1 && (threshold -= weight(row, options[j])) >= 0) j++;
    const state = options[j];
    path.push(state);
    if (advance(state, depth, path)) return path;
  }
}

export function generateMarkov(steps: number, durations: number[], recipe: MarkovRecipe): MarkovEvent[] {
  const { pitchLength, rhythmLength, pitch, rhythm } = recipe;
  if (pitchLength < 1 || rhythmLength < 1 || steps % pitchLength || steps % rhythmLength)
    throw new Error("rhythmPath");
  const block = gcd(pitchLength, rhythmLength);
  // A rhythm must tile each common phrase boundary exactly.
  const quantum = durations.reduce(gcd, 0);
  if (!quantum || block % quantum) throw new Error("rhythmPath");
  const rng = random(recipe.seed),
    budget = { left: 250000 };
  const min = durations[0],
    max = durations[durations.length - 1];
  const positions = [0],
    counts = [0];
  const firstBlockCounts: number[] = [0];
  const pitchPaths = new Map<number, number[] | null>();
  let pitches: number[] | null = null;
  const rest = recipe.restState ?? pitch.length - 2;
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
        return depth + 1 !== total || weight(pitch[state], current[0] ?? state) > 0;
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
      if (position + durations[state] === rhythmLength && weight(rhythm[state], path[0] ?? state) <= 0)
        return false;
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
  const phrase: number[] = pitches;
  const eventsInTake = rhythmPath.length * (steps / rhythmLength);
  const notesPerPhrase = phrase.reduce((n, state) => n + Number(state !== rest), 0);
  if (recipe.maxNotes !== undefined && notesPerPhrase * (eventsInTake / phrase.length) > recipe.maxNotes)
    throw new Error("capacity");
  // Native-tick Score phrases can repeat far more often than a grid-step phrase.
  // Bound the expanded preview even when it consists entirely of rests.
  if (eventsInTake > 250000) throw new Error("searchLimit");
  const events: MarkovEvent[] = [];
  for (let start = 0, i = 0; start < steps; i++) {
    const durationState = rhythmPath[i % rhythmPath.length],
      length = durations[durationState];
    events.push({ start, length, state: phrase[i % phrase.length], durationState });
    start += length;
  }
  return events;
}
