/**
 * HARNESS SELF-TEST ONLY. A tiny fake storefront with cookie-based carts and a public "/cart/{id}:{qty},..." builder,
 * used to prove that scripts/prove-ab.ts correctly detects PASS/FAIL. It says nothing about any real merchant.
 *
 *   npx tsx scripts/mock-merchant.ts   (then run prove-ab with --catalog pointing at the generated fixture)
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { writeFileSync } from "node:fs";

const port = Number(process.env.MOCK_PORT ?? 8899);
const origin = `http://127.0.0.1:${port}`;
const carts = new Map<string, Map<string, number>>();
const names: Record<string, string> = { "mock-150": "Mock Rewarble 150 USD", "mock-100": "Mock Rewarble 100 USD", "mock-50": "Mock Rewarble 50 USD", "mock-20": "Mock Rewarble 20 USD", "mock-10": "Mock Rewarble 10 USD" };

const app = new Hono();
app.get("/cart/:items", (c) => {
  const sid = getCookie(c, "mock_sid") ?? crypto.randomUUID();
  setCookie(c, "mock_sid", sid, { httpOnly: true, sameSite: "Lax", path: "/" });
  const cart = new Map<string, number>();
  for (const part of c.req.param("items").split(",")) {
    const [id, q] = decodeURIComponent(part).split(":");
    if (id && names[id]) cart.set(id, process.env.MOCK_BUG === "qty" ? 1 : (cart.get(id) ?? 0) + Number(q));
  }
  carts.set(sid, cart);
  return c.redirect("/checkout", 302);
});
app.get("/checkout", (c) => {
  const cart = carts.get(getCookie(c, "mock_sid") ?? "") ?? new Map();
  const rows = [...cart].map(([id, q]) => `<li class="line">${names[id]} <input type="number" name="quantity" value="${q}"></li>`).join("");
  return c.html(`<!doctype html><title>Checkout</title><h1>Checkout</h1><ul>${rows}</ul>`);
});

writeFileSync(
  "evidence/raw/mock.catalog.json",
  JSON.stringify({
    merchant: "mock", status: "DISCOVERED", discoveredAt: "self-test", blocker: null,
    products: Object.entries(names).map(([id, name]) => ({
      productId: id, name, currency: "USD", faceValue: Number(id.split("-")[1]) * 100, url: `${origin}/p/${id}`, available: true, evidence: "mock",
    })),
    checkoutInitializer: { kind: "url-template", urlTemplate: `${origin}/cart/{items}`, itemTemplate: "{productId}:{quantity}", itemSeparator: ",", evidence: "mock", abProof: null },
  }, null, 2),
);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => console.log(`mock merchant on ${origin}`));
