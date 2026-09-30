import type { Hono } from "hono";
import { createApp } from "./app.js";

interface Env {
  LINK_SIGNING_SECRET: string;
  PUBLIC_BASE_URL?: string;
  MERCHANT_PRIORITY?: string;
}

let cached: { key: string; app: Hono } | null = null;

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const key = `${env.PUBLIC_BASE_URL}|${env.MERCHANT_PRIORITY}`;
    if (!cached || cached.key !== key)
      cached = { key, app: createApp({ secret: env.LINK_SIGNING_SECRET, publicBaseUrl: env.PUBLIC_BASE_URL, merchantPriority: env.MERCHANT_PRIORITY }) };
    return cached.app.fetch(req, env, ctx);
  },
};
