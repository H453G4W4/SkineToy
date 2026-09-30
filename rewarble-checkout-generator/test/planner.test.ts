import { describe, expect, it } from "vitest";
import { planAuto, planManual } from "../src/core/planner.js";
import { fixtureProducts, USD_EXAMPLE } from "./fixtures.js";

const usd = fixtureProducts("USD", USD_EXAMPLE);
const summary = (r: ReturnType<typeof planAuto>) =>
  r.kind === "exact" ? r.items.map((i) => `${i.product.faceValue / 100}x${i.quantity}`).join("+") : r.kind;

describe("planAuto", () => {
  it.each([
    [30, "30x1"],
    [170, "150x1+20x1"],
    [200, "100x2"], // 2 cards either way; fewer distinct denominations wins over 150+50
    [75, "60x1+15x1"], // tie on cards+distinct -> largest-first
    [500, "150x3+50x1"],
    [5, "5x1"],
    [125, "100x1+25x1"],
    [300, "150x2"],
  ])("%i USD -> %s", (amount, expected) => {
    const r = planAuto(usd, "USD", amount * 100);
    expect(summary(r)).toBe(expected);
    if (r.kind === "exact") expect(r.items.reduce((s, i) => s + i.product.faceValue * i.quantity, 0)).toBe(amount * 100);
  });

  it("75 USD -> 50+25 when the merchant has no 60 card", () => {
    expect(summary(planAuto(fixtureProducts("USD", [5, 10, 20, 25, 50, 100]), "USD", 7500))).toBe("50x1+25x1");
  });

  it("is deterministic regardless of catalog order", () => {
    const shuffled = [...usd].reverse();
    for (const a of [30, 75, 170, 200, 345]) expect(summary(planAuto(shuffled, "USD", a * 100))).toBe(summary(planAuto(usd, "USD", a * 100)));
  });

  it("never fakes unsupported amounts: 37 USD -> nearest 35 / 40", () => {
    expect(planAuto(usd, "USD", 3700)).toEqual({ kind: "inexact", lower: 3500, upper: 4000 });
    expect(planAuto(usd, "USD", 3750)).toEqual({ kind: "inexact", lower: 3500, upper: 4000 });
  });

  it("amount below smallest card has no lower bound", () => {
    expect(planAuto(usd, "USD", 300)).toEqual({ kind: "inexact", lower: null, upper: 500 });
  });

  it("ignores unavailable products and other currencies", () => {
    const products = [...fixtureProducts("USD", [50], { available: false }), ...fixtureProducts("USD", [10]), ...fixtureProducts("EUR", [50])];
    expect(summary(planAuto(products, "USD", 5000))).toBe("10x5");
    expect(planAuto(products, "GBP", 5000)).toEqual({ kind: "no-products" });
  });

  it("respects merchant maxQuantity", () => {
    const products = fixtureProducts("USD", [10, 5], { maxQuantity: 2 });
    expect(summary(planAuto(products, "USD", 2500))).toBe("10x2+5x1");
    expect(planAuto(products, "USD", 3500).kind).toBe("inexact");
  });

  it("rejects absurdly large amounts", () => {
    expect(planAuto(usd, "USD", 100_000_000).kind).toBe("too-large");
  });
});

describe("planManual", () => {
  it("preserves 10 x2 exactly (not 20 x1)", () => {
    const r = planManual(usd, "USD", [{ faceValue: 1000, quantity: 2 }]);
    expect(r).toMatchObject({ kind: "ok", total: 2000 });
    if (r.kind === "ok") expect(r.items.map((i) => [i.product.faceValue, i.quantity])).toEqual([[1000, 2]]);
  });
  it("rejects denominations the merchant does not sell", () => {
    expect(planManual(usd, "USD", [{ faceValue: 700, quantity: 1 }])).toEqual({ kind: "unknown-denomination", faceValue: 700 });
  });
});
