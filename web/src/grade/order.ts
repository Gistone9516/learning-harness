// Display order of judge options (CP-2, Q-13).
//
// Generated items tend to put the answer first, so options are never shown in stored order. The
// order is derived from the card id rather than drawn at random: a reload, a resumed set and the
// translated view all show the same order, and nothing new has to be stored. Grading never sees
// this order; it compares option text.

/** FNV-1a over the id's UTF-16 units: a stable 32-bit seed. */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: a small seeded generator in [0, 1). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** order[shown position] = stored index. Same id and count, same order. */
export function optionOrder(id: string, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const r = rng(seedOf(id));
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
