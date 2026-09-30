import type { Catalog, Initializer, Product } from "../src/core/catalog.js";
import { DeclarativeConnector } from "../src/merchants/declarative.js";

/** SYNTHETIC TEST DATA ONLY — not merchant observations. Ids are prefixed "fixture-" to make that obvious. */
export function fixtureProducts(currency: string, faceValuesMajor: number[], extra: Partial<Product> = {}): Product[] {
  return faceValuesMajor.map((v) => ({
    productId: `fixture-${currency.toLowerCase()}-${v}`,
    name: `Rewarble Gift Card ${v} ${currency}`,
    currency,
    faceValue: v * 100,
    url: `https://merchant.test/p/${currency.toLowerCase()}-${v}`,
    available: true,
    evidence: "test fixture",
    ...extra,
  }));
}

export const USD_EXAMPLE = [5, 10, 15, 20, 25, 30, 50, 60, 100, 150];

export function fixtureConnector(products: Product[], initializer: Initializer | null, id = "fixture"): DeclarativeConnector {
  const catalog: Catalog = { merchant: id, status: "DISCOVERED", discoveredAt: "2026-01-01", blocker: null, products, checkoutInitializer: initializer };
  return new DeclarativeConnector(id, "Fixture Merchant", catalog);
}

export const PROVEN = { contextA: "PASS", contextB: "PASS", provenAt: "2026-01-01", evidence: "test" } as const;

export const urlInit: Initializer = {
  kind: "url-template",
  urlTemplate: "https://merchant.test/cart/{items}",
  itemTemplate: "{productId}:{quantity}",
  itemSeparator: ",",
  evidence: "test",
  abProof: PROVEN,
};

export const SECRET = "test-secret-test-secret-test-secret-0123";
