/**
 * Fresh-visitor A/B proof for a merchant checkout initializer.
 *
 *   npx tsx scripts/prove-ab.ts --merchant skine --amount 170 --currency USD [--catalog data/skine.catalog.json]
 *   npx tsx scripts/prove-ab.ts --merchant skine --amount 20 --currency USD --manual 10x2
 *
 * Runs the REAL app in-process (the initializer is temporarily treated as proven, in memory only), generates one
 * public link, then opens that SAME link in two independent fresh browser contexts. PASS requires, in each context:
 *   - no merchant cookies before opening the link
 *   - the merchant cart/checkout shows every planned product with its exact quantity
 * and the two contexts must end with different merchant sessions (compared via one-way fingerprints only).
 * Writes evidence/ab-<merchant>-<ts>.json; if both pass, copy its `abProof` block into the catalog.
 */
import { serve } from "@hono/node-server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { createApp } from "../src/app.js";
import { CatalogSchema } from "../src/core/catalog.js";
import { DeclarativeConnector } from "../src/merchants/declarative.js";
import { cookieFingerprint, detectChallenge, freshContext, launch } from "./lib/browser.js";

const { values: a } = parseArgs({
  options: {
    merchant: { type: "string", default: "skine" }, amount: { type: "string" }, currency: { type: "string" },
    catalog: { type: "string" }, manual: { type: "string" },
    "line-selector": { type: "string" }, // optional CSS selector for one cart line (merchant-specific, from discovery)
  },
});
if (!a.amount || !a.currency) throw new Error("--amount and --currency are required");

const catalogPath = a.catalog ?? `data/${a.merchant}.catalog.json`;
const catalog = CatalogSchema.parse(JSON.parse(readFileSync(catalogPath, "utf8")));
if (!catalog.checkoutInitializer) throw new Error(`${catalogPath} has no checkoutInitializer to prove`);
const pending = { ...catalog, checkoutInitializer: { ...catalog.checkoutInitializer, abProof: { contextA: "PASS", contextB: "PASS", provenAt: "PENDING", evidence: "in-memory proof run" } as const } };
const connector = new DeclarativeConnector(catalog.merchant, catalog.merchant, pending);

const secret = crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
const port = 8790 + Math.floor(Math.random() * 100);
const app = createApp({ secret, publicBaseUrl: `http://127.0.0.1:${port}`, merchants: [connector] });
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });

const composition = a.manual?.split(",").map((s) => { const [fv, q] = s.split("x"); return { faceValue: fv!, quantity: Number(q) }; });
const gen = (await (await fetch(`http://127.0.0.1:${port}/api/generate`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: a.amount, currency: a.currency, composition }),
})).json()) as any;
console.log("generated:", gen.status, JSON.stringify(gen.composition));
if (gen.status !== "READY") { server.close(); throw new Error(`generator returned ${gen.status}: ${gen.message ?? ""}`); }

const expected = gen.composition as { faceValue: string; quantity: number; productName: string }[];
const merchantHost = new URL(catalog.products[0]!.url).hostname;
const browser = await launch();
mkdirSync("evidence/raw", { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");

async function visit(label: "A" | "B") {
  const ctx = await freshContext(browser);
  const cookiesBefore = (await ctx.cookies()).length;
  const page = await ctx.newPage();
  await page.goto(gen.url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.hostname.endsWith(merchantHost.replace(/^www\./, "")), { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const challenge = await detectChallenge(page);
  await page.screenshot({ path: `evidence/raw/ab-${a.merchant}-${ts}-${label}.png`, fullPage: true });
  const lines = a["line-selector"]
    ? await page.locator(a["line-selector"]).evaluateAll((els) => els.map((e) => ({
        text: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
        qty: (e.querySelector("input[type=number], input[name*=qty i], input[name*=quantity i]") as HTMLInputElement | null)?.value ?? null,
      })))
    : null;
  const body = (await page.textContent("body").catch(() => "")) ?? "";
  const checks = expected.map((item) => {
    const line = lines?.find((l) => l.text.includes(item.productName));
    const quantityOk = line ? (line.qty ?? /(?:qty|quantity|×|x)\s*:?\s*(\d+)/i.exec(line.text)?.[1]) === String(item.quantity) : null;
    return { item: `${item.faceValue} ${gen.currency} x${item.quantity}`, productPresent: body.includes(item.productName), quantityOk };
  });
  const pass = !challenge && cookiesBefore === 0 && checks.every((c) => c.productPresent && c.quantityOk !== false) && (lines ? checks.every((c) => c.quantityOk) : false);
  const result = { label, finalUrlHost: new URL(page.url()).host, finalPath: new URL(page.url()).pathname, cookiesBefore, challenge, checks,
    quantityVerified: !!lines, fingerprint: await cookieFingerprint(ctx, merchantHost), pass };
  await ctx.close();
  return result;
}

const A = await visit("A");
const B = await visit("B");
const independent = A.fingerprint !== B.fingerprint;
const passBoth = A.pass && B.pass && independent;
const report = {
  merchant: a.merchant, provenAt: new Date().toISOString(), request: { amount: a.amount, currency: a.currency, manual: a.manual ?? null },
  composition: expected, contextA: A, contextB: B, independentSessions: independent,
  note: A.quantityVerified ? undefined : "Pass --line-selector (from discovery evidence) so quantities are verified per cart line; without it the run cannot PASS.",
  abProof: passBoth ? { contextA: "PASS", contextB: "PASS", provenAt: new Date().toISOString(), evidence: `evidence/ab-${a.merchant}-${ts}.json` } : null,
};
writeFileSync(`evidence/ab-${a.merchant}-${ts}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ contextA: A.pass ? "PASS" : "FAIL", contextB: B.pass ? "PASS" : "FAIL", independent }, null, 2));
await browser.close();
server.close();
process.exitCode = passBoth ? 0 : 1;
