/**
 * Bounded, evidence-first discovery of Rewarble Gift Cards and cart mechanics on skine.com.
 *
 *   npm run discover:skine            # catalog discovery only (read-only browsing)
 *   npm run discover:skine -- --cart  # also build a cart through the normal storefront UI (never pays)
 *
 * Output (sanitized — no cookie values, no tokens):
 *   evidence/skine-discovery-<ts>.json   observations + network log
 *   evidence/raw/                        screenshots (git-ignored)
 *   data/skine.catalog.draft.json        DRAFT catalog for human review; copy to data/skine.catalog.json when verified
 *
 * Rules enforced: stops the live path on 401/403/429/CAPTCHA/challenge; no URL guessing (only follows links and
 * controls the storefront itself presents); never clicks payment / place-order controls.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { cookieNames, detectChallenge, freshContext, launch, recordNetwork, sanitizeUrl, type NetEntry } from "./lib/browser.js";

const ORIGIN = process.env.SKINE_ORIGIN ?? "https://skine.com";
const WANT_CART = process.argv.includes("--cart");
const MAX_PAGES = 60;
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("evidence/raw", { recursive: true });

class Blocked extends Error {}

const network: NetEntry[] = [];
const log: string[] = [];
const note = (s: string) => { log.push(s); console.log(s); };

async function guard(page: Page) {
  const ch = await detectChallenge(page);
  if (ch) throw new Blocked(`Stopped live path: ${ch} at ${sanitizeUrl(page.url())}`);
}

async function inspectPage(page: Page) {
  return page.evaluate(() => {
    const SENS = /token|csrf|nonce|session|auth|key|secret|password|signature|hash/i;
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
      try { return [JSON.parse(s.textContent ?? "")]; } catch { return []; }
    });
    const forms = [...document.forms].map((f) => ({
      action: f.getAttribute("action"),
      resolvedAction: f.action,
      method: (f.getAttribute("method") ?? "get").toLowerCase(),
      id: f.id || null,
      fields: [...f.elements].map((el) => {
        const e = el as HTMLInputElement;
        const name = e.name || null;
        const redact = !name || SENS.test(name);
        return {
          tag: e.tagName.toLowerCase(), type: e.type, name,
          value: e.type === "password" ? "[redacted]" : redact ? (e.value ? "[redacted]" : "") : e.value.slice(0, 80),
          options: e.tagName === "SELECT" ? [...(e as unknown as HTMLSelectElement).options].map((o) => ({ value: o.value, label: text(o) })) : undefined,
        };
      }),
    }));
    const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit]")]
      .map((b) => ({ text: text(b) || (b as HTMLInputElement).value || "", name: b.getAttribute("name"), value: SENS.test(b.getAttribute("name") ?? "") ? "[redacted]" : b.getAttribute("value"), form: (b as HTMLButtonElement).form?.id ?? null }))
      .filter((b) => b.text || b.name).slice(0, 80);
    const w = window as unknown as Record<string, unknown>;
    const markers = {
      nextData: !!document.getElementById("__NEXT_DATA__"),
      nextRouter: "next" in w || !!document.querySelector('script[src*="/_next/"]'),
      remix: "__remixContext" in w || "__remixManifest" in w || "__reactRouterContext" in w,
      nuxt: "__NUXT__" in w,
      shopify: "Shopify" in w || !!document.querySelector('script[src*="cdn.shopify.com"]'),
      woocommerce: !!document.querySelector(".woocommerce, [class*='wc-block']"),
      magento: "require" in w && !!document.querySelector('script[type="text/x-magento-init"]'),
    };
    const scripts = [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 60);
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: (a as HTMLAnchorElement).href, text: text(a).slice(0, 120) }));
    const storageKeys = { local: Object.keys(localStorage), session: Object.keys(sessionStorage) };
    return { url: location.href, title: document.title, h1: text(document.querySelector("h1")), jsonLd, forms, buttons, markers, scripts, links, storageKeys,
      bodyExcerpt: text(document.body).slice(0, 3000) };
  });
}

type Snapshot = Awaited<ReturnType<typeof inspectPage>>;

function sanitizeSnapshot(s: Snapshot) {
  return { ...s, url: sanitizeUrl(s.url), links: undefined, scripts: s.scripts.map(sanitizeUrl) };
}

const CURRENCY_SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

/** Draft extraction from observed text/JSON-LD only. Humans verify before it becomes the real catalog. */
function draftProducts(snaps: Snapshot[]) {
  const out: Record<string, unknown>[] = [];
  for (const s of snaps) {
    const name = s.h1 || s.title;
    if (!/rewarble/i.test(name)) continue;
    const m = /(\d+(?:[.,]\d{1,2})?)\s*(USD|EUR|GBP|CAD|AUD|CHF|PLN|SEK|NOK|DKK|CZK|HUF|RON|TRY|BRL|MXN|JPY)\b/i.exec(name)
      ?? /(USD|EUR|GBP|CAD|AUD|CHF|PLN)\s*(\d+(?:[.,]\d{1,2})?)/i.exec(name)
      ?? /([$€£])\s*(\d+(?:[.,]\d{1,2})?)/.exec(name);
    let currency: string | undefined, value: string | undefined;
    if (m) {
      if (/^\d/.test(m[1]!)) { value = m[1]; currency = m[2]!.toUpperCase(); }
      else { currency = CURRENCY_SYMBOL[m[1]!] ?? m[1]!.toUpperCase(); value = m[2]; }
    }
    const product = s.jsonLd.flatMap((j: any) => (Array.isArray(j) ? j : j?.["@graph"] ?? [j])).find((j: any) => j?.["@type"] === "Product") as any;
    const offers = product?.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
    out.push({
      productId: product?.sku ?? product?.productID ?? null, // null => must be filled from the cart request evidence
      name,
      currency: currency ?? null,
      faceValue: value ? Math.round(Number(value.replace(",", ".")) * 100) : null,
      url: sanitizeUrl(s.url),
      available: offers.length ? offers.some((o: any) => String(o.availability ?? "").includes("InStock")) : null,
      offers: offers.map((o: any) => ({ price: o.price, priceCurrency: o.priceCurrency, availability: o.availability })),
      variantSelectors: s.forms.flatMap((f) => f.fields.filter((x) => x.options).map((x) => ({ name: x.name, options: x.options }))),
      evidence: `evidence/skine-discovery-${ts}.json#pages[url=${sanitizeUrl(s.url)}]`,
    });
  }
  return out;
}

async function buildCartViaUi(page: Page, productUrls: string[], cartLog: string[]) {
  const addLabel = /add to (cart|basket)|buy now|in den warenkorb|ajouter au panier/i;
  const forbidden = /pay|place order|complete (order|purchase)|confirm|submit order/i;
  const plan = [productUrls[0], productUrls[1], productUrls[0]].filter(Boolean) as string[]; // A, B, then A again (quantity)
  for (const url of plan) {
    const before = network.length;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await guard(page);
    const btn = page.getByRole("button", { name: addLabel }).first();
    if (!(await btn.count())) { cartLog.push(`no add-to-cart control on ${sanitizeUrl(url)}`); continue; }
    const label = (await btn.textContent())?.trim() ?? "";
    if (forbidden.test(label)) { cartLog.push(`refused to click "${label}"`); continue; }
    await btn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    cartLog.push(`clicked "${label}" on ${sanitizeUrl(url)} -> ${network.length - before} requests, now at ${sanitizeUrl(page.url())}`);
    await page.screenshot({ path: `evidence/raw/skine-cart-${ts}-${cartLog.length}.png` });
  }
  // Follow the storefront's own cart/checkout link (never typed/guessed).
  const cartLink = page.locator('a[href*="cart" i], a[href*="basket" i], a[href*="checkout" i], a[aria-label*="cart" i]').first();
  if (await cartLink.count()) {
    await cartLink.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await guard(page);
    cartLog.push(`cart/checkout page: ${sanitizeUrl(page.url())}`);
    await page.screenshot({ path: `evidence/raw/skine-cart-${ts}-final.png`, fullPage: true });
    return inspectPage(page);
  }
  return null;
}

async function main() {
  const browser = await launch();
  const ctx = await freshContext(browser);
  const page = await ctx.newPage();
  let blocked: string | null = null;
  let error: string | null = null;
  recordNetwork(page, network, (status, url) => { blocked ??= `HTTP ${status} on ${url}`; });

  const pages: Snapshot[] = [];
  const cartLog: string[] = [];
  let cartSnapshot: Snapshot | null = null;
  try {
    const res = await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    note(`home: ${res?.status()} ${sanitizeUrl(page.url())}`);
    if (blocked) throw new Blocked(blocked);
    await guard(page);
    const home = await inspectPage(page);
    pages.push(home);

    let candidates = home.links.filter((l) => /rewarble/i.test(l.href + " " + l.text));
    if (candidates.length === 0) {
      // Use the storefront's own search control, if it presents one.
      const search = page.locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i]').first();
      if (await search.count()) {
        await search.fill("Rewarble");
        await search.press("Enter");
        await page.waitForLoadState("networkidle").catch(() => {});
        await guard(page);
        const results = await inspectPage(page);
        pages.push(results);
        candidates = results.links.filter((l) => /rewarble/i.test(l.href + " " + l.text));
        note(`search results: ${sanitizeUrl(page.url())} (${candidates.length} rewarble links)`);
      }
    }
    const queue = [...new Set(candidates.map((c) => c.href.split("#")[0]!))].filter((u) => u.startsWith(ORIGIN) || new URL(u).hostname.endsWith("skine.com"));
    const seen = new Set<string>(pages.map((p) => p.url));
    while (queue.length && seen.size < MAX_PAGES) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const r = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (blocked) throw new Blocked(blocked);
      await guard(page);
      const snap = await inspectPage(page);
      pages.push(snap);
      note(`page ${r?.status()} ${sanitizeUrl(url)} — ${snap.h1 || snap.title}`);
      // Category/listing pages lead to more Rewarble product pages.
      for (const l of snap.links) if (/rewarble/i.test(l.href + " " + l.text) && !seen.has(l.href.split("#")[0]!)) queue.push(l.href.split("#")[0]!);
    }

    if (WANT_CART) {
      const productPages = pages.filter((p) => /rewarble/i.test(p.h1) && p.buttons.some((b) => /add to|buy/i.test(b.text))).map((p) => p.url);
      note(`cart phase over ${productPages.length} product pages`);
      cartSnapshot = await buildCartViaUi(page, productPages, cartLog);
      cartLog.forEach(note);
    }
  } catch (e) {
    if (e instanceof Blocked) { blocked = e.message; note(`BLOCKED: ${e.message}`); }
    else { error = (e as Error).message.split("\n")[0]!; note(`ERROR: ${error}`); }
  }

  const evidence = {
    origin: ORIGIN, capturedAt: new Date().toISOString(), blocked, error, log,
    cookies: await cookieNames(ctx), // names/flags only
    pages: pages.map(sanitizeSnapshot),
    cart: WANT_CART ? { steps: cartLog, finalPage: cartSnapshot ? sanitizeSnapshot(cartSnapshot) : null } : undefined,
    network,
  };
  writeFileSync(`evidence/skine-discovery-${ts}.json`, JSON.stringify(evidence, null, 2));
  const draft = {
    merchant: "skine", status: "DRAFT — REVIEW BEFORE USE", discoveredAt: evidence.capturedAt, blocker: blocked ?? error,
    products: draftProducts(pages), checkoutInitializer: null,
  };
  writeFileSync("data/skine.catalog.draft.json", JSON.stringify(draft, null, 2));
  note(`wrote evidence/skine-discovery-${ts}.json and data/skine.catalog.draft.json (${draft.products.length} draft products)`);
  await browser.close();
  if (blocked) process.exitCode = 2;
  else if (error) process.exitCode = 1;
}

main();
