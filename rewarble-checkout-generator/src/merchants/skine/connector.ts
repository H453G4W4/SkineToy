import { CatalogSchema } from "../../core/catalog.js";
import { DeclarativeConnector } from "../declarative.js";
import raw from "../../../data/skine.catalog.json";

export function createSkineConnector() {
  return new DeclarativeConnector("skine", "Skine", CatalogSchema.parse(raw));
}
