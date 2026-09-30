import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

let secret = process.env.LINK_SIGNING_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === "production") throw new Error("LINK_SIGNING_SECRET is required in production");
  secret = crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  console.warn("[dev] LINK_SIGNING_SECRET not set; using an ephemeral secret (links die on restart).");
}
const port = Number(process.env.PORT ?? 8787);
const app = createApp({ secret, publicBaseUrl: process.env.PUBLIC_BASE_URL, merchantPriority: process.env.MERCHANT_PRIORITY });
serve({ fetch: app.fetch, port }, () => console.log(`listening on http://localhost:${port}`));
