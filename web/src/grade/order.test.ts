// optionOrder (CP-2, Q-13): a stable permutation per card id that spreads the stored first option.
import { describe, it, expect } from "vitest";
import { optionOrder } from "./order";

describe("optionOrder", () => {
  it("is a permutation and the same for the same id", () => {
    const o = optionOrder("0-2-02-j1", 4);
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder("0-2-02-j1", 4)).toEqual(o);
    expect(optionOrder("x", 0)).toEqual([]);
    expect(optionOrder("x", 1)).toEqual([0]);
  });

  it("moves the stored first option to every position about equally", () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) counts[optionOrder(`card-${i}`, 4).indexOf(0)] += 1;
    for (const c of counts) { expect(c).toBeGreaterThan(400); expect(c).toBeLessThan(600); }
  });
});
