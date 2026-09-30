import { z } from "zod";
import { currenciesOf } from "./catalog.js";
import { formatFaceValue, formatMinor, isCurrencyCode, parseAmount } from "./money.js";
import type { CartPlan } from "./plan.js";
import { planAuto, planManual, type PlannedItem } from "./planner.js";
import { signPlan } from "./signing.js";
import type { MerchantConnector } from "../merchants/types.js";

export const GenerateRequestSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform(String),
  currency: z.string().trim().toUpperCase(),
  /** Optional manual composition; quantities are preserved exactly. */
  composition: z
    .array(z.object({ faceValue: z.union([z.string(), z.number()]).transform(String), quantity: z.number().int().min(1).max(100) }))
    .max(50)
    .optional(),
});
export type GenerateRequest = z.input<typeof GenerateRequestSchema>;

export type GenerateStatus =
  | "READY"
  | "MERCHANT_INITIALIZER_NOT_AVAILABLE"
  | "CATALOG_NOT_DISCOVERED"
  | "UNSUPPORTED_CURRENCY"
  | "EXACT_AMOUNT_UNAVAILABLE"
  | "AMOUNT_TOO_LARGE"
  | "INVALID_REQUEST";

export interface GenerateResponse {
  status: GenerateStatus;
  message?: string;
  requestedAmount?: string;
  currency?: string;
  merchant?: string;
  mode?: "auto" | "manual";
  composition?: { faceValue: string; quantity: number; productName: string }[];
  faceValueTotal?: string;
  nearest?: string[];
  supportedCurrencies?: string[];
  url?: string | null;
  note?: string;
}

const FEE_NOTE =
  "Amounts are Rewarble Gift Card face value. The merchant's checkout total may be higher (service/payment fees are set by the merchant).";

export interface GeneratorDeps {
  merchants: MerchantConnector[];
  secret: string;
  baseUrl: string;
  now?: () => number;
}

function composition(items: PlannedItem[], currency: string) {
  return items.map((i) => ({ faceValue: formatFaceValue(i.product.faceValue, currency), quantity: i.quantity, productName: i.product.name }));
}

export async function generate(input: unknown, deps: GeneratorDeps): Promise<GenerateResponse> {
  const parsed = GenerateRequestSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID_REQUEST", message: "Expected { amount, currency }." };
  const { currency } = parsed.data;
  if (!isCurrencyCode(currency)) return { status: "INVALID_REQUEST", message: "Currency must be a 3-letter code." };
  const requested = parseAmount(parsed.data.amount, currency);
  if (requested === null) return { status: "INVALID_REQUEST", message: "Amount must be a positive number." };

  const all = deps.merchants;
  const discovered = all.filter((m) => m.catalog().status === "DISCOVERED");
  if (discovered.length === 0) {
    const first = all[0];
    const r = first?.readiness();
    return {
      status: "CATALOG_NOT_DISCOVERED",
      message: r && !r.ready ? r.reason : "No merchant catalog available.",
      requestedAmount: formatMinor(requested, currency),
      currency,
      url: null,
    };
  }
  // Merchant priority is the configured order; first discovered merchant that sells this Rewarble currency wins.
  const merchant = discovered.find((m) => currenciesOf(m.catalog()).includes(currency));
  if (!merchant) {
    const supported = [...new Set(discovered.flatMap((m) => currenciesOf(m.catalog())))].sort();
    return { status: "UNSUPPORTED_CURRENCY", message: `No Rewarble ${currency} cards available.`, supportedCurrencies: supported, currency, url: null };
  }
  const products = merchant.catalog().products;

  let items: PlannedItem[];
  let mode: "auto" | "manual";
  if (parsed.data.composition?.length) {
    mode = "manual";
    const lines: { faceValue: number; quantity: number }[] = [];
    for (const l of parsed.data.composition) {
      const fv = parseAmount(l.faceValue, currency);
      if (fv === null) return { status: "INVALID_REQUEST", message: `Invalid face value ${l.faceValue}.` };
      lines.push({ faceValue: fv, quantity: l.quantity });
    }
    const m = planManual(products, currency, lines);
    if (m.kind === "unknown-denomination")
      return { status: "INVALID_REQUEST", message: `No ${formatFaceValue(m.faceValue, currency)} ${currency} Rewarble card is available.`, url: null };
    if (m.kind === "quantity-exceeds-limit")
      return { status: "INVALID_REQUEST", message: `Merchant allows at most ${m.maxQuantity} of ${formatFaceValue(m.faceValue, currency)} ${currency}.`, url: null };
    if (m.total !== requested)
      return {
        status: "INVALID_REQUEST",
        message: `Manual composition totals ${formatMinor(m.total, currency)} ${currency}, not the requested ${formatMinor(requested, currency)}.`,
        url: null,
      };
    items = m.items;
  } else {
    mode = "auto";
    const a = planAuto(products, currency, requested);
    if (a.kind === "too-large")
      return { status: "AMOUNT_TOO_LARGE", message: `Maximum per link is ${formatMinor(a.maxAmount, currency)} ${currency}.`, currency, url: null };
    if (a.kind === "no-products") return { status: "UNSUPPORTED_CURRENCY", currency, url: null };
    if (a.kind === "inexact") {
      const nearest = [a.lower, a.upper].filter((x): x is number => x !== null).map((x) => formatMinor(x, currency));
      return {
        status: "EXACT_AMOUNT_UNAVAILABLE",
        message: `Exact ${formatMinor(requested, currency)} ${currency} checkout unavailable with the merchant's Rewarble denominations.`,
        requestedAmount: formatMinor(requested, currency),
        currency,
        merchant: merchant.id,
        nearest,
        url: null,
      };
    }
    items = a.items;
  }

  const base: GenerateResponse = {
    status: "READY",
    requestedAmount: formatMinor(requested, currency),
    currency,
    merchant: merchant.id,
    mode,
    composition: composition(items, currency),
    faceValueTotal: formatMinor(requested, currency),
    note: FEE_NOTE,
  };

  const readiness = merchant.readiness();
  if (!readiness.ready) return { ...base, status: readiness.code, message: readiness.reason, url: null };

  const plan: CartPlan = {
    v: 1,
    merchant: merchant.id,
    currency,
    mode,
    requestedAmount: requested,
    items: items.map((i) => ({ productId: i.product.productId, faceValue: i.product.faceValue, quantity: i.quantity })),
    iat: Math.floor((deps.now?.() ?? Date.now()) / 1000),
  };
  const token = await signPlan(plan, deps.secret);
  return { ...base, url: `${deps.baseUrl.replace(/\/$/, "")}/c/${token}` };
}
