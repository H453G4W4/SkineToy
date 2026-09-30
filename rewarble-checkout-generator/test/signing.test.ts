import { describe, expect, it } from "vitest";
import type { CartPlan } from "../src/core/plan.js";
import { signPlan, verifyPlan } from "../src/core/signing.js";
import { SECRET } from "./fixtures.js";

const plan: CartPlan = {
  v: 1, merchant: "skine", currency: "USD", mode: "auto", requestedAmount: 17000, iat: 1_700_000_000,
  items: [{ productId: "fixture-usd-150", faceValue: 15000, quantity: 1 }, { productId: "fixture-usd-20", faceValue: 2000, quantity: 1 }],
};

function tamper(token: string, mutate: (p: CartPlan) => void): string {
  const [payload, sig] = token.split(".") as [string, string];
  const obj = JSON.parse(Buffer.from(payload, "base64url").toString());
  mutate(obj);
  return `${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${sig}`;
}

describe("signed links", () => {
  it("round-trips", async () => {
    const t = await signPlan(plan, SECRET);
    expect(await verifyPlan(t, SECRET)).toEqual({ ok: true, plan });
  });

  it.each([
    ["currency", (p: CartPlan) => { p.currency = "EUR"; }],
    ["amount", (p: CartPlan) => { p.requestedAmount = 100; }],
    ["items", (p: CartPlan) => { p.items[0]!.productId = "fixture-usd-100"; }],
    ["quantity", (p: CartPlan) => { p.items[1]!.quantity = 5; }],
    ["merchant", (p: CartPlan) => { p.merchant = "k4g"; }],
  ])("rejects tampered %s", async (_, mutate) => {
    const t = tamper(await signPlan(plan, SECRET), mutate);
    expect(await verifyPlan(t, SECRET)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a different secret, garbage, and truncated signatures", async () => {
    const t = await signPlan(plan, SECRET);
    expect((await verifyPlan(t, SECRET.replace("0", "1"))).ok).toBe(false);
    expect((await verifyPlan("nope", SECRET)).ok).toBe(false);
    expect((await verifyPlan(t.slice(0, -2), SECRET)).ok).toBe(false);
    expect((await verifyPlan("a.b.c", SECRET)).ok).toBe(false);
  });

  it("refuses weak secrets", async () => {
    await expect(signPlan(plan, "short")).rejects.toThrow();
  });

  it("carries no merchant session material", async () => {
    const t = await signPlan(plan, SECRET);
    const decoded = Buffer.from(t.split(".")[0]!, "base64url").toString();
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(["currency", "iat", "items", "merchant", "mode", "requestedAmount", "v"]);
  });
});
