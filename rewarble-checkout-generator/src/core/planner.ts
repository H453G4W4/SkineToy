import type { Product } from "./catalog.js";

export interface PlannedItem {
  product: Product;
  quantity: number;
}

export type PlanOutcome =
  | { kind: "exact"; items: PlannedItem[]; total: number }
  | { kind: "inexact"; lower: number | null; upper: number | null }
  | { kind: "too-large"; maxAmount: number }
  | { kind: "no-products" };

/** Upper bound on DP size, in gcd units. Keeps worst-case planning well under 100ms. */
export const MAX_UNITS = 4000;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** One product per face value (stable: lowest productId wins), available only, largest first. */
export function denominations(products: Product[], currency: string): Product[] {
  const byValue = new Map<number, Product>();
  for (const p of [...products].sort((a, b) => a.productId.localeCompare(b.productId))) {
    if (p.currency !== currency || !p.available) continue;
    if (!byValue.has(p.faceValue)) byValue.set(p.faceValue, p);
  }
  return [...byValue.values()].sort((a, b) => b.faceValue - a.faceValue);
}

interface Cell {
  cards: number;
  distinct: number;
  q: number; // quantity of this denomination chosen
}

/**
 * Automatic composition. Priority:
 *   1. exact requested total
 *   2. minimum number of cards
 *   3. minimum number of different denominations
 *   4. deterministic largest-first tie break (lexicographically most of the largest denomination)
 * If the exact amount is not representable, returns the nearest representable totals below/above.
 */
export function planAuto(products: Product[], currency: string, target: number): PlanOutcome {
  const denoms = denominations(products, currency);
  if (denoms.length === 0) return { kind: "no-products" };

  const unit = denoms.reduce((g, p) => gcd(g, p.faceValue), 0);
  const maxDenomUnits = denoms[0]!.faceValue / unit;
  const targetUnitsFloor = Math.floor(target / unit);
  const limit = targetUnitsFloor + maxDenomUnits; // enough headroom to find the nearest total above
  if (limit > MAX_UNITS) return { kind: "too-large", maxAmount: (MAX_UNITS - maxDenomUnits) * unit };

  const n = denoms.length;
  const d = denoms.map((p) => p.faceValue / unit);
  const maxQ = denoms.map((p) => p.maxQuantity ?? Infinity);

  // best[i][v]: optimal way to make v units from denominations i..n-1 (suffix DP).
  const best: (Cell | null)[][] = Array.from({ length: n + 1 }, () => new Array<Cell | null>(limit + 1).fill(null));
  best[n]![0] = { cards: 0, distinct: 0, q: 0 };
  for (let i = n - 1; i >= 0; i--) {
    const di = d[i]!;
    const row = best[i]!;
    const next = best[i + 1]!;
    for (let v = 0; v <= limit; v++) {
      let chosen: Cell | null = null;
      // Descending q: on a cost tie the earlier (larger) q is kept => largest-first tie break.
      for (let q = Math.min(Math.floor(v / di), maxQ[i]!); q >= 0; q--) {
        const rest = next[v - q * di];
        if (!rest) continue;
        const cards = rest.cards + q;
        const distinct = rest.distinct + (q > 0 ? 1 : 0);
        if (!chosen || cards < chosen.cards || (cards === chosen.cards && distinct < chosen.distinct)) {
          chosen = { cards, distinct, q };
        }
      }
      row[v] = chosen;
    }
  }

  const reachable = (v: number) => v >= 0 && v <= limit && best[0]![v] !== null;

  if (target % unit === 0 && reachable(target / unit)) {
    const items: PlannedItem[] = [];
    let v = target / unit;
    for (let i = 0; i < n; i++) {
      const cell = best[i]![v]!;
      if (cell.q > 0) items.push({ product: denoms[i]!, quantity: cell.q });
      v -= cell.q * d[i]!;
    }
    return { kind: "exact", items, total: target };
  }

  let lower: number | null = null;
  for (let v = Math.min(targetUnitsFloor, limit); v > 0; v--) {
    if (v * unit < target && reachable(v)) { lower = v * unit; break; }
  }
  let upper: number | null = null;
  for (let v = Math.ceil(target / unit); v <= limit; v++) {
    if (v * unit > target && reachable(v)) { upper = v * unit; break; }
  }
  return { kind: "inexact", lower, upper };
}

export type ManualOutcome =
  | { kind: "ok"; items: PlannedItem[]; total: number }
  | { kind: "unknown-denomination"; faceValue: number }
  | { kind: "quantity-exceeds-limit"; faceValue: number; maxQuantity: number };

/** Manual composition: quantities are preserved exactly (10 x2 stays 10 x2, never 20 x1). */
export function planManual(
  products: Product[],
  currency: string,
  lines: { faceValue: number; quantity: number }[],
): ManualOutcome {
  const denoms = denominations(products, currency);
  const merged = new Map<number, number>();
  for (const l of lines) merged.set(l.faceValue, (merged.get(l.faceValue) ?? 0) + l.quantity);
  const items: PlannedItem[] = [];
  for (const [faceValue, quantity] of [...merged].sort((a, b) => b[0] - a[0])) {
    const product = denoms.find((p) => p.faceValue === faceValue);
    if (!product) return { kind: "unknown-denomination", faceValue };
    if (product.maxQuantity !== undefined && quantity > product.maxQuantity)
      return { kind: "quantity-exceeds-limit", faceValue, maxQuantity: product.maxQuantity };
    items.push({ product, quantity });
  }
  return { kind: "ok", items, total: items.reduce((s, i) => s + i.product.faceValue * i.quantity, 0) };
}
