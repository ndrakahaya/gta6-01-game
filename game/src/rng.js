// Deterministic RNG utilities.
// The generator is mulberry32, so the city, paint colours, traffic spawns and pedestrian
// placements are byte-identical on every reload — the screenshots and the two-run dossier
// diff both depend on that reproducibility.

/** 32-bit Golden Ratio constant used as the mulberry32 increment. */
const MULBERRY_INCREMENT = 0x6d2b79f5;
/** 2^32, used to normalise a 32-bit word into [0, 1). */
const UINT32_RANGE = 4294967296;

/**
 * Create a seeded, deterministic pseudo-random generator.
 * @param {number} seed - Integer seed
 * @returns {Function} - () => number in [0, 1)
 */
export function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * Random float in [lo, hi).
 * @param {Function} rng - Generator from makeRng
 * @param {number} lo - Lower bound
 * @param {number} hi - Upper bound
 */
export function rngRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

/**
 * Random integer in [lo, hi], inclusive.
 * @param {Function} rng - Generator from makeRng
 * @param {number} lo - Lowest value (inclusive)
 * @param {number} hi - Highest value (inclusive)
 */
export function rngInt(rng, lo, hi) {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

/**
 * Pick a random element from an array.
 * @param {Function} rng - Generator from makeRng
 * @param {Array} arr - Non-empty array to pick from
 */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * True with probability p.
 * @param {Function} rng - Generator from makeRng
 * @param {number} p - Probability in [0, 1]
 */
export function chance(rng, p) {
  return rng() < p;
}