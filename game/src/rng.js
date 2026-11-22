// Deterministic RNG (mulberry32) so the city, paint colours and traffic spawn are identical
// every reload — screenshots and the two-run dossier diff both depend on it.

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function rngInt(rng, lo, hi) {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function chance(rng, p) {
  return rng() < p;
}
