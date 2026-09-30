import { CartPlanSchema, type CartPlan } from "./plan.js";

/**
 * Public link token: base64url(JSON plan) + "." + base64url(HMAC-SHA256(secret, "rcg1." + payload)).
 * The plan is not secret (it only lists public product ids and quantities); the MAC makes it tamper-proof.
 */

const DOMAIN = "rcg1.";
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, key);
  }
  return key;
}

export function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) throw new Error("LINK_SIGNING_SECRET must be set to at least 32 characters");
}

export async function signPlan(plan: CartPlan, secret: string): Promise<string> {
  assertSecret(secret);
  const payload = b64urlEncode(enc.encode(JSON.stringify(CartPlanSchema.parse(plan))));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(DOMAIN + payload)));
  return `${payload}.${b64urlEncode(sig)}`;
}

export type VerifyResult = { ok: true; plan: CartPlan } | { ok: false; reason: "malformed" | "bad-signature" | "invalid-plan" };

export async function verifyPlan(token: string, secret: string): Promise<VerifyResult> {
  assertSecret(secret);
  if (token.length > 4096) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, sigText] = parts as [string, string];
  const sig = b64urlDecode(sigText);
  const body = b64urlDecode(payload);
  if (!sig || !body || sig.length !== 32) return { ok: false, reason: "malformed" };
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(DOMAIN + payload));
  if (!valid) return { ok: false, reason: "bad-signature" };
  try {
    const parsed = CartPlanSchema.safeParse(JSON.parse(dec.decode(body)));
    return parsed.success ? { ok: true, plan: parsed.data } : { ok: false, reason: "invalid-plan" };
  } catch {
    return { ok: false, reason: "invalid-plan" };
  }
}
