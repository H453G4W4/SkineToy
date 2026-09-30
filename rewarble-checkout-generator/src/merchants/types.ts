import type { Catalog } from "../core/catalog.js";
import type { CartPlan } from "../core/plan.js";

export type Readiness =
  | { ready: true }
  | { ready: false; code: "CATALOG_NOT_DISCOVERED" | "MERCHANT_INITIALIZER_NOT_AVAILABLE"; reason: string };

/** What the visitor's browser must do to land in a NEW merchant-owned checkout of their own. */
export type CheckoutResult =
  | { kind: "redirect"; url: string }
  | { kind: "form-post"; action: string; fields: [string, string][] }
  | { kind: "unavailable"; code: string; reason: string };

export interface MerchantConnector {
  readonly id: string;
  readonly displayName: string;
  catalog(): Catalog;
  readiness(): Readiness;
  /**
   * Must never touch a shared/server-held merchant session: the result is executed by the visitor's own browser,
   * so the merchant session that results belongs to that visitor only.
   */
  initializeCheckout(plan: CartPlan, opts?: { allowUnproven?: boolean }): Promise<CheckoutResult>;
}
