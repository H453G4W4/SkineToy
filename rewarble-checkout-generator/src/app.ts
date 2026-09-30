import { Hono } from "hono";
import { currenciesOf } from "./core/catalog.js";
import { generate } from "./core/generator.js";
import { assertSecret, verifyPlan } from "./core/signing.js";
import { createRegistry } from "./merchants/registry.js";
import type { MerchantConnector } from "./merchants/types.js";
import { autoPostPage, errorPage, generatorPage } from "./web/pages.js";

export interface AppConfig {
  secret: string;
  publicBaseUrl?: string;
  merchantPriority?: string;
  merchants?: MerchantConnector[]; // test injection
  rateLimitPerMinute?: number;
}

/** Tiny fixed-window limiter. Per-process/per-isolate only; use a platform rate-limit rule for global limits. */
function rateLimiter(limit: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || e.reset < now) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { n: 1, reset: now + 60_000 });
      return true;
    }
    return ++e.n <= limit;
  };
}

export function createApp(config: AppConfig) {
  assertSecret(config.secret);
  const merchants = config.merchants ?? createRegistry(config.merchantPriority ?? "skine");
  const allow = rateLimiter(config.rateLimitPerMinute ?? 30);
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action *; base-uri 'none'; frame-ancestors 'none'");
  });

  app.get("/", (c) => {
    const currencies = [...new Set(merchants.flatMap((m) => currenciesOf(m.catalog())))].sort();
    const r = merchants[0]?.readiness();
    return c.html(generatorPage(currencies, r && !r.ready ? r.reason : null));
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/api/catalog", (c) =>
    c.json(
      merchants.map((m) => ({
        merchant: m.id,
        readiness: m.readiness(),
        currencies: currenciesOf(m.catalog()),
        denominations: m.catalog().products.filter((p) => p.available).map((p) => ({ currency: p.currency, faceValue: p.faceValue, name: p.name })),
      })),
    ),
  );

  app.post("/api/generate", async (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!allow(ip)) return c.json({ status: "RATE_LIMITED" }, 429);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ status: "INVALID_REQUEST", message: "Body must be JSON." }, 400);
    }
    const baseUrl = config.publicBaseUrl ?? new URL(c.req.url).origin;
    const res = await generate(body, { merchants, secret: config.secret, baseUrl });
    return c.json(res, res.status === "INVALID_REQUEST" ? 400 : 200);
  });

  app.get("/c/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = await verifyPlan(c.req.param("token"), config.secret);
    if (!v.ok) return c.html(errorPage("Invalid link", "This checkout link is invalid or has been modified.", "INVALID_LINK"), 400);
    const merchant = merchants.find((m) => m.id === v.plan.merchant);
    if (!merchant) return c.html(errorPage("Merchant unavailable", "This link's merchant is not currently enabled.", "MERCHANT_UNAVAILABLE"), 503);
    const result = await merchant.initializeCheckout(v.plan);
    switch (result.kind) {
      case "redirect":
        return c.redirect(result.url, 303);
      case "form-post":
        return c.html(autoPostPage(result.action, result.fields, merchant.displayName));
      case "unavailable":
        return c.html(errorPage("Checkout unavailable", result.reason || "The merchant checkout cannot be initialized right now.", result.code), 503);
    }
  });

  return app;
}
