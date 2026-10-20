import { describe, expect, it } from "vitest";
import { addDecimal, roundProduct } from "./decimal";

describe("roundProduct(10進の掛け算と四捨五入)", () => {
  it.each([
    [[0.01, 0.95, 30, 6500], 0, 1853],
    [[0.009, 1, 1500], 0, 14],
    [[620_770, 0.12], 0, 74_492],
    [[695_262, 0.15], 0, 104_289],
    [[1.25], 0, 1],
    [[1.5], 0, 2],
    [[2.5], 0, 3],
    [[0.0225], 3, 0.023],
    [[0.0224999], 3, 0.022],
    [[1e-7, 1e7], 0, 1],
    [[1.5e21, 2], 0, 3e21],
    [[99, 0.9, 100_000, 8000], 0, 71_280_000_000],
  ])("%j を小数%i桁に → %d", (factors, digits, expected) => {
    expect(roundProduct(factors, digits)).toBe(expected);
  });

  it("負の数は0から遠い方へ(-2.5 → -3)", () => {
    expect(roundProduct([-2.5])).toBe(-3);
    expect(roundProduct([-0.0225], 3)).toBe(-0.023);
  });

  it("有限でない数は計算しない", () => {
    expect(() => roundProduct([Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => roundProduct([Number.NaN])).toThrow(RangeError);
  });

  it("足し算も10進で正確", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addDecimal(0.1, 0.2)).toBe(0.3);
    expect(addDecimal(100.1, 5)).toBe(105.1);
  });
});
