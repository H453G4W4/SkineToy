import { z } from "zod";

/**
 * A merchant catalog is DATA captured by the discovery script (scripts/discover-skine.ts) and reviewed by a human.
 * Nothing in here may be guessed: every product and every initializer must carry the evidence it was derived from.
 */

export const ProductSchema = z.object({
  productId: z.string().min(1), // merchant's own identifier (variant id / sku / slug) exactly as observed
  name: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/), // Rewarble card currency, NOT checkout display currency
  faceValue: z.number().int().positive(), // minor units
  url: z.string().url(),
  available: z.boolean(),
  maxQuantity: z.number().int().positive().optional(),
  evidence: z.string().min(1), // pointer into evidence/ (file + field) showing where this record was observed
});
export type Product = z.infer<typeof ProductSchema>;

const TemplateItem = z.object({
  /** Placeholders: {productId} {quantity} {index} — values are URL-encoded when substituted. */
  name: z.string(),
  value: z.string(),
});

/** Merchant exposes a public URL that builds a cart for whoever opens it (e.g. "/cart/{items}"). */
const UrlTemplateInitializer = z.object({
  kind: z.literal("url-template"),
  urlTemplate: z.string().url(), // contains "{items}"
  itemTemplate: z.string(), // e.g. "{productId}:{quantity}"
  itemSeparator: z.string(),
});

/** Merchant's own public add-to-cart form accepts multiple line items in one top-level POST from the visitor's browser. */
const FormPostInitializer = z.object({
  kind: z.literal("form-post"),
  action: z.string().url(),
  fixedFields: z.array(TemplateItem).default([]),
  itemFields: z.array(TemplateItem).min(1),
});

export const InitializerSchema = z.discriminatedUnion("kind", [UrlTemplateInitializer, FormPostInitializer]).and(
  z.object({
    evidence: z.string().min(1),
    /** Result of scripts/prove-ab.ts. The connector refuses to issue links until both contexts passed. */
    abProof: z
      .object({ contextA: z.literal("PASS"), contextB: z.literal("PASS"), provenAt: z.string(), evidence: z.string() })
      .nullable()
      .default(null),
  }),
);
export type Initializer = z.infer<typeof InitializerSchema>;

export const CatalogSchema = z.object({
  merchant: z.string(),
  status: z.enum(["NOT_DISCOVERED", "DISCOVERED"]),
  discoveredAt: z.string().nullable(),
  blocker: z.string().nullable(),
  products: z.array(ProductSchema),
  checkoutInitializer: InitializerSchema.nullable(),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export function currenciesOf(catalog: Catalog): string[] {
  return [...new Set(catalog.products.filter((p) => p.available).map((p) => p.currency))].sort();
}
