# Rewarble Checkout Link Generator

Enter an **amount** and a **Rewarble Gift Card currency**. The generator picks an exact composition of real Rewarble
products sold by the merchant and returns **one shareable URL**. Anyone who opens that URL in a fresh browser should land
in **their own** merchant checkout with those cards and quantities already in the cart.

> **Current status: `CATALOG_NOT_DISCOVERED` for Skine.** The app, planner, signed links, connector framework, and the
> discovery and A/B proof tooling are complete and tested. The live Skine investigation has **not** run yet, because
> the environment this was built in could not reach `skine.com`: its egress proxy refused the connection with 403
> before any request reached Skine (see `evidence/skine-discovery-*.json`). Until discovery and the A/B proof both
> succeed, the generator returns compositions but **never a checkout URL**. It will not fake one.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | One language across the app, the research scripts and the tests |
| Web framework | [Hono](https://hono.dev) | Tiny; the same code runs on Node and on Cloudflare Workers |
| Validation | Zod | Request, plan and catalog schemas |
| Link signing | HMAC-SHA256 (Web Crypto) | Stateless and tamper-proof, with no database |
| Storage | none | The signed plan lives in the URL, and the catalog is a reviewed JSON file in the repo |
| Browser automation | Playwright (`playwright-core`) | Merchant discovery and the fresh-context A/B proof |
| Tests | Vitest | Planner, signing, API and redirect behaviour |
| Deploy target | Cloudflare Workers (`wrangler.toml`) | HTTPS by default, secrets, logs, low operational overhead |

## Architecture

```
src/
  core/
    money.ts        integer minor-unit parsing/formatting
    catalog.ts      MerchantCatalog schema (products + initializer, each with evidence pointers)
    planner.ts      exact composition planner + nearest-total finder + manual mode
    plan.ts         CartPlan (what a public link carries)
    signing.ts      HMAC sign/verify of CartPlan
    generator.ts    POST /api/generate logic
  merchants/
    types.ts        MerchantConnector / CheckoutResult interfaces
    declarative.ts  connector driven by a reviewed catalog file (url-template or form-post initializers)
    skine/          Skine connector (loads data/skine.catalog.json)
    registry.ts     merchant priority (MERCHANT_PRIORITY, default "skine")
  web/              generator UI + auto-post page
  app.ts            routes;  node.ts (local server);  worker.ts (Cloudflare)
scripts/
  discover-skine.ts bounded storefront discovery → sanitized evidence + draft catalog
  prove-ab.ts       fresh Context A / Context B proof of a generated link
  mock-merchant.ts  fake storefront used ONLY to self-test prove-ab (PASS and FAIL paths)
data/skine.catalog.json   the live catalog (currently NOT_DISCOVERED, empty — nothing guessed)
evidence/                 sanitized research evidence (no cookie values, tokens or PII)
```

### Routes

- `GET /`: the generator form
- `POST /api/generate` with `{ "amount": "170", "currency": "USD", "composition"?: [{ "faceValue": "10", "quantity": 2 }] }`
  - Possible statuses: `READY`, `EXACT_AMOUNT_UNAVAILABLE` (with `nearest`), `MERCHANT_INITIALIZER_NOT_AVAILABLE`,
    `CATALOG_NOT_DISCOVERED`, `UNSUPPORTED_CURRENCY`, `AMOUNT_TOO_LARGE`, `INVALID_REQUEST`, and `RATE_LIMITED`
    (returned as HTTP 429).
  - `url` is set only for `READY`.
- `GET /c/<payload>.<sig>`:
  1. Verify the signature.
  2. Re-check each item against the current catalog.
  3. Hand the visitor's own browser to the merchant, either by a `303` redirect or an auto-submitting top-level form.

  The server never holds or forwards a merchant session.
- `GET /api/catalog`: readiness, currencies and denominations for each merchant
- `GET /healthz`

### How checkout initialization works

A merchant connector turns a `CartPlan` into something **the visitor's browser** runs. The merchant session that
results therefore belongs to that visitor only. Two evidence-backed kinds of initializer are supported:

- `url-template`: the merchant exposes a public URL that builds a cart when opened (for example
  `/cart/{id}:{qty},{id}:{qty}`).
- `form-post`: the merchant's own public add-to-cart form accepts several line items in one top-level POST.

A connector will issue links only when its catalog is `DISCOVERED`, has an initializer, **and** has an `abProof`
produced by `scripts/prove-ab.ts`. If a merchant needs something else, such as a server-side public cart API that
returns a visitor-owned checkout URL, add a new initializer kind once there is evidence for it.

## Planner rules

The planner works in integer minor units and only uses available products, one per face value.

1. The total must equal the requested amount exactly.
2. Use the fewest cards.
3. Then use the fewest different denominations.
4. Break any remaining tie deterministically, largest denomination first.

Example with the denominations 5/10/15/20/25/30/50/60/100/150:

| Amount | Composition |
|---|---|
| 30 | 30 ×1 |
| 170 | 150 + 20 |
| 200 | 100 ×2 |
| 75 | 60 + 15 |

Without a 60 card, 75 becomes 50 + 25. If an amount cannot be made exactly (for example 37 when every card is a
multiple of 5), the generator returns `EXACT_AMOUNT_UNAVAILABLE` with the nearest totals (35 and 40), and the UI lets
the creator pick one. **Manual mode** keeps the quantities exactly as entered, so 10 ×2 never becomes 20 ×1.

Amounts are **Rewarble face value**. The merchant's checkout total may be higher because of its fees, and the UI says
so. A later "maximum payment total" mode can reuse the same planner.

## Supported merchant, currencies and denominations

| Merchant | Status |
|---|---|
| Skine (primary) | Catalog not yet discovered, so there are no currencies or denominations yet |
| K4G (backup #1) | Not investigated. It is only looked at if Skine is proven unable to work. |
| Gamecardsdirect (backup #2) | Not investigated |

A network failure in the build environment is **not** evidence about Skine, so none of the backups have been touched.

## Finishing the Skine integration

Run these steps on a machine that can reach skine.com:

```bash
npm install
npm run discover:skine            # read-only browsing: catalog, forms, framework markers, network
npm run discover:skine -- --cart  # also builds a cart through the normal UI (A, B, then A again); never pays
```

1. Review `evidence/skine-discovery-*.json` and `data/skine.catalog.draft.json`. Fill in the real `productId`s from the
   observed add-to-cart requests. If the storefront exposes a mechanism that lets a fresh visitor open a URL and get a
   cart, describe it as `checkoutInitializer`, with a pointer to the evidence. Commit the result as
   `data/skine.catalog.json` with `"status": "DISCOVERED"`.
2. Prove it with fresh, independent browsers. Take `--line-selector` from the cart page in the discovery evidence:
   ```bash
   npx tsx scripts/prove-ab.ts --merchant skine --amount 170 --currency USD --line-selector '<cart line css>'
   npx tsx scripts/prove-ab.ts --merchant skine --amount 20  --currency USD --manual 10x2 --line-selector '<…>'
   ```
3. Copy the `abProof` block from `evidence/ab-skine-*.json` into the catalog. `/api/generate` then starts returning
   links.
4. If Skine has no portable initializer, record `SKINE_PORTABLE_MULTI_CART_NOT_FOUND` and its blocker in the catalog's
   `blocker` field. Only then add a K4G catalog and connector, and set `MERCHANT_PRIORITY=k4g`.

The discovery script stops that path on 401/403/429 or a CAPTCHA/challenge. It only follows links and controls the
storefront itself shows, never clicks payment or place-order controls, and records cookie **names** only.

## Local development

```bash
npm install
npm run dev          # http://localhost:8787 (random dev secret unless LINK_SIGNING_SECRET is set)
npm test             # vitest
npm run typecheck
```

To self-test the proof harness (this says nothing about any real merchant):

```bash
npx tsx scripts/mock-merchant.ts &
npx tsx scripts/prove-ab.ts --merchant mock --catalog evidence/raw/mock.catalog.json --amount 170 --currency USD --line-selector li.line
```

## Deployment (Cloudflare Workers)

```bash
npx wrangler login
npx wrangler secret put LINK_SIGNING_SECRET     # ≥32 random chars, e.g. `openssl rand -hex 32`
# set PUBLIC_BASE_URL in wrangler.toml [vars] (or leave unset to use the request origin)
npm run deploy
```

- HTTPS comes from Workers.
- Logs come from Workers observability.
- The built-in limiter allows 30 requests per minute per IP, but only per isolate. For a global limit, add a
  Cloudflare rate-limiting rule on `/api/generate`.
- Rotating `LINK_SIGNING_SECRET` invalidates every existing link.

## Security model

- Links carry only our plan: merchant, currency, amount, public product ids and quantities. They carry no cookies,
  merchant session ids, credentials or PII.
- HMAC-SHA256 with a server-side secret of at least 32 characters, compared in constant time via `crypto.subtle.verify`.
  Changing the currency, amount, items, quantities or merchant invalidates the link.
- `/c/…` re-checks every item against the current catalog, so a withdrawn product never reaches checkout.
- The merchant session is created by the visitor's own browser; the server never proxies or stores merchant cookies.
- Payment happens only on the merchant's own checkout. There is no card form and no stored payment data.
- Responses are sent with strict CSP, `no-referrer`, `nosniff` and `DENY` framing headers; `/c/` responses are
  `no-store`.
- Research evidence is sanitized. Sensitive query and form values are redacted, and cookie values are never written;
  A/B session independence is compared through truncated SHA-256 fingerprints.
