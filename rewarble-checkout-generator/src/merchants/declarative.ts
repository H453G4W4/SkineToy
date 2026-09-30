import type { Catalog } from "../core/catalog.js";
import type { CartPlan } from "../core/plan.js";
import type { CheckoutResult, MerchantConnector, Readiness } from "./types.js";

function fill(template: string, vars: Record<string, string | number>, encode: boolean): string {
  return template.replace(/\{(productId|quantity|index)\}/g, (_, k: string) => {
    const v = String(vars[k]);
    return encode ? encodeURIComponent(v) : v;
  });
}

/**
 * Connector driven entirely by a reviewed catalog file. A merchant only becomes usable once discovery evidence
 * has populated both its products and an initializer that passed the fresh-context A/B proof.
 */
export class DeclarativeConnector implements MerchantConnector {
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly data: Catalog,
  ) {}

  catalog(): Catalog {
    return this.data;
  }

  readiness(): Readiness {
    if (this.data.status !== "DISCOVERED" || this.data.products.length === 0)
      return { ready: false, code: "CATALOG_NOT_DISCOVERED", reason: this.data.blocker ?? "Rewarble catalog not yet discovered." };
    const init = this.data.checkoutInitializer;
    if (!init)
      return {
        ready: false,
        code: "MERCHANT_INITIALIZER_NOT_AVAILABLE",
        reason: this.data.blocker ?? "No portable cart initializer has been observed for this merchant.",
      };
    if (!init.abProof)
      return { ready: false, code: "MERCHANT_INITIALIZER_NOT_AVAILABLE", reason: "Initializer found but fresh-context A/B proof not yet passed." };
    return { ready: true };
  }

  async initializeCheckout(plan: CartPlan, opts: { allowUnproven?: boolean } = {}): Promise<CheckoutResult> {
    const init = this.data.checkoutInitializer;
    const r = this.readiness();
    if (!init || (!r.ready && !(opts.allowUnproven && this.data.status === "DISCOVERED")))
      return { kind: "unavailable", code: r.ready ? "MERCHANT_INITIALIZER_NOT_AVAILABLE" : r.code, reason: r.ready ? "" : r.reason };

    // Re-validate against the live catalog: a product that vanished or changed value must not be sent to checkout.
    for (const item of plan.items) {
      const p = this.data.products.find((x) => x.productId === item.productId);
      if (!p || !p.available || p.faceValue !== item.faceValue || p.currency !== plan.currency)
        return { kind: "unavailable", code: "PRODUCT_NO_LONGER_AVAILABLE", reason: `Product ${item.productId} is no longer available as planned.` };
    }

    if (init.kind === "url-template") {
      const items = plan.items
        .map((it, index) => fill(init.itemTemplate, { productId: it.productId, quantity: it.quantity, index }, true))
        .join(init.itemSeparator);
      return { kind: "redirect", url: init.urlTemplate.replace("{items}", items) };
    }

    const fields: [string, string][] = init.fixedFields.map((f) => [f.name, f.value]);
    plan.items.forEach((it, index) => {
      const vars = { productId: it.productId, quantity: it.quantity, index };
      for (const f of init.itemFields) fields.push([fill(f.name, vars, false), fill(f.value, vars, false)]);
    });
    return { kind: "form-post", action: init.action, fields };
  }
}
