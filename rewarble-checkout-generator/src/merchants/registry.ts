import { createSkineConnector } from "./skine/connector.js";
import type { MerchantConnector } from "./types.js";

/** Backup connectors (k4g, gamecardsdirect) are registered here only once Skine is proven unable to work. */
const factories: Record<string, () => MerchantConnector> = {
  skine: createSkineConnector,
};

export function createRegistry(priority: string, overrides: MerchantConnector[] = []): MerchantConnector[] {
  const byId = new Map<string, MerchantConnector>();
  for (const [id, make] of Object.entries(factories)) byId.set(id, make());
  for (const c of overrides) byId.set(c.id, c);
  return priority
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => byId.get(id))
    .filter((c): c is MerchantConnector => c !== undefined);
}
