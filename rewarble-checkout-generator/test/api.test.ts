import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Initializer } from "../src/core/catalog.js";
import { PROVEN, SECRET, USD_EXAMPLE, fixtureConnector, fixtureProducts, urlInit } from "./fixtures.js";

const products = [...fixtureProducts("USD", USD_EXAMPLE), ...fixtureProducts("EUR", [10, 25, 50, 100])];
const BASE = "https://gen.test";

function appWith(init: Initializer | null, opts: { rate?: number } = {}) {
  return createApp({ secret: SECRET, publicBaseUrl: BASE, merchants: [fixtureConnector(products, init)], rateLimitPerMinute: opts.rate ?? 1000 });
}
async function gen(app: ReturnType<typeof createApp>, body: unknown) {
  const r = await app.request("/api/generate", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { http: r.status, json: (await r.json()) as any };
}

describe("POST /api/generate", () => {
  it("170 USD -> READY with signed link", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "170", currency: "USD" });
    expect(json).toMatchObject({
      status: "READY", requestedAmount: "170.00", currency: "USD", merchant: "fixture",
      composition: [{ faceValue: "150", quantity: 1 }, { faceValue: "20", quantity: 1 }],
    });
    expect(json.url).toMatch(/^https:\/\/gen\.test\/c\/[\w-]+\.[\w-]+$/);
  });

  it("returns nearest totals instead of faking 37 USD", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "37", currency: "usd" });
    expect(json).toMatchObject({ status: "EXACT_AMOUNT_UNAVAILABLE", nearest: ["35.00", "40.00"], url: null });
  });

  it("unsupported currency lists what is supported", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "50", currency: "JPY" });
    expect(json).toMatchObject({ status: "UNSUPPORTED_CURRENCY", supportedCurrencies: ["EUR", "USD"] });
  });

  it("invalid input -> 400", async () => {
    expect((await gen(appWith(urlInit), { amount: "-5", currency: "USD" })).http).toBe(400);
    expect((await gen(appWith(urlInit), { amount: "abc", currency: "USD" })).http).toBe(400);
    expect((await gen(appWith(urlInit), { currency: "USD" })).http).toBe(400);
  });

  it("does not return a URL while the initializer is unproven", async () => {
    const { json } = await gen(appWith({ ...urlInit, abProof: null }), { amount: "170", currency: "USD" });
    expect(json).toMatchObject({ status: "MERCHANT_INITIALIZER_NOT_AVAILABLE", url: null });
    expect(json.composition).toHaveLength(2);
  });

  it("does not return a URL when no initializer exists", async () => {
    const { json } = await gen(appWith(null), { amount: "30", currency: "USD" });
    expect(json).toMatchObject({ status: "MERCHANT_INITIALIZER_NOT_AVAILABLE", url: null });
  });

  it("real Skine catalog (not yet discovered) never yields a link", async () => {
    const app = createApp({ secret: SECRET, publicBaseUrl: BASE });
    const { json } = await gen(app, { amount: "170", currency: "USD" });
    expect(json).toMatchObject({ status: "CATALOG_NOT_DISCOVERED", url: null });
  });

  it("manual composition 10 x2 is preserved in the signed link and checkout", async () => {
    const app = appWith(urlInit);
    const { json } = await gen(app, { amount: "20", currency: "USD", composition: [{ faceValue: "10", quantity: 2 }] });
    expect(json).toMatchObject({ status: "READY", mode: "manual", composition: [{ faceValue: "10", quantity: 2 }] });
    const r = await app.request(new URL(json.url).pathname);
    expect(r.headers.get("location")).toBe("https://merchant.test/cart/fixture-usd-10:2");
  });

  it("manual composition must match the requested amount", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "30", currency: "USD", composition: [{ faceValue: "10", quantity: 2 }] });
    expect(json.status).toBe("INVALID_REQUEST");
  });

  it("rate limits", async () => {
    const app = appWith(urlInit, { rate: 2 });
    await gen(app, { amount: "30", currency: "USD" });
    await gen(app, { amount: "30", currency: "USD" });
    expect((await gen(app, { amount: "30", currency: "USD" })).http).toBe(429);
  });
});

describe("GET /c/:token", () => {
  it("url-template initializer redirects each visitor to a fresh merchant cart URL", async () => {
    const app = appWith(urlInit);
    const { json } = await gen(app, { amount: "170", currency: "USD" });
    const path = new URL(json.url).pathname;
    for (let i = 0; i < 2; i++) {
      const r = await app.request(path);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("https://merchant.test/cart/fixture-usd-150:1,fixture-usd-20:1");
      expect(r.headers.get("set-cookie")).toBeNull(); // we never hand out merchant session state
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("form-post initializer renders an auto-submitting form executed by the visitor's browser", async () => {
    const init: Initializer = {
      kind: "form-post", action: "https://merchant.test/cart/add", fixedFields: [{ name: "return_to", value: "/checkout" }],
      itemFields: [{ name: "items[{index}][id]", value: "{productId}" }, { name: "items[{index}][quantity]", value: "{quantity}" }],
      evidence: "test", abProof: PROVEN,
    };
    const app = appWith(init);
    const { json } = await gen(app, { amount: "75", currency: "EUR" });
    const html = await (await app.request(new URL(json.url).pathname)).text();
    expect(html).toContain('action="https://merchant.test/cart/add"');
    expect(html).toContain('name="items[0][id]" value="fixture-eur-50"');
    expect(html).toContain('name="items[1][id]" value="fixture-eur-25"');
    expect(html).toContain('name="items[1][quantity]" value="1"');
  });

  it("rejects tampered links", async () => {
    const app = appWith(urlInit);
    const { json } = await gen(app, { amount: "170", currency: "USD" });
    const path = new URL(json.url).pathname;
    const r = await app.request(path.slice(0, -3) + "AAA");
    expect(r.status).toBe(400);
  });

  it("merchant not enabled -> 503", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "170", currency: "USD" });
    const other = createApp({ secret: SECRET, publicBaseUrl: BASE, merchants: [] });
    expect((await other.request(new URL(json.url).pathname)).status).toBe(503);
  });

  it("product removed from catalog after link issue -> 503, no stale checkout", async () => {
    const { json } = await gen(appWith(urlInit), { amount: "170", currency: "USD" });
    const shrunk = createApp({ secret: SECRET, publicBaseUrl: BASE, merchants: [fixtureConnector(fixtureProducts("USD", [100, 50, 20]), urlInit)] });
    const r = await shrunk.request(new URL(json.url).pathname);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("PRODUCT_NO_LONGER_AVAILABLE");
  });
});

describe("GET /", () => {
  it("renders the generator", async () => {
    const html = await (await appWith(urlInit).request("/")).text();
    expect(html).toContain("Generate Checkout Link");
    expect(html).toContain('<option value="USD">USD</option>');
  });
});
