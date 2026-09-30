import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Response } from "playwright-core";

export async function launch(): Promise<Browser> {
  const candidates = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean) as string[];
  const executablePath = candidates.find((p) => existsSync(p));
  return chromium.launch({ headless: process.env.HEADFUL !== "1", ...(executablePath ? { executablePath } : { channel: "chrome" }) });
}

/** A brand-new context: no cookies, no storage — a "fresh visitor". */
export function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
}

const SENSITIVE = /token|csrf|nonce|session|sid|auth|key|secret|password|email|signature|sig|hash|jwt|code/i;

/** Redact values of sensitive query params; keep names so the mechanism stays observable. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE.test(k)) u.searchParams.set(k, "[redacted]");
    return u.toString();
  } catch {
    return raw;
  }
}

export interface NetEntry {
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  requestContentType?: string;
  postFieldNames?: string[];
  postJsonShape?: unknown;
  setCookieNames?: string[];
  location?: string;
  initiatorFrame?: string;
}

/** Shape of a JSON body with leaf values replaced by their types (sensitive keys dropped entirely). */
function shape(v: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => shape(x, depth + 1));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : shape(x, depth + 1)]));
  if (typeof v === "number" || typeof v === "boolean") return v; // quantities / ids are mechanism evidence
  if (typeof v === "string") return v.length <= 64 ? v : `string(${v.length})`;
  return v;
}

function describePost(req: Request): Pick<NetEntry, "postFieldNames" | "postJsonShape"> {
  const body = req.postData();
  if (!body) return {};
  const ct = req.headers()["content-type"] ?? "";
  if (ct.includes("json")) {
    try {
      return { postJsonShape: shape(JSON.parse(body)) };
    } catch {
      return {};
    }
  }
  if (ct.includes("x-www-form-urlencoded")) return { postFieldNames: [...new URLSearchParams(body).keys()] };
  if (ct.includes("multipart")) return { postFieldNames: [...body.matchAll(/name="([^"]+)"/g)].map((m) => m[1]!) };
  return {};
}

/** Records sanitized network metadata only. Cookie VALUES are never recorded. */
export function recordNetwork(page: Page, sink: NetEntry[], onBlocked: (status: number, url: string) => void) {
  const pending = new Map<Request, NetEntry>();
  page.on("request", (req) => {
    if (["image", "font", "media", "stylesheet"].includes(req.resourceType())) return;
    const e: NetEntry = {
      method: req.method(),
      url: sanitizeUrl(req.url()),
      resourceType: req.resourceType(),
      requestContentType: req.headers()["content-type"],
      ...(req.method() !== "GET" ? describePost(req) : {}),
      initiatorFrame: req.frame()?.url() ? sanitizeUrl(req.frame().url()) : undefined,
    };
    pending.set(req, e);
    sink.push(e);
  });
  page.on("response", async (res: Response) => {
    const e = pending.get(res.request());
    if (!e) return;
    e.status = res.status();
    const headers = await res.headersArray().catch(() => []);
    const cookies = headers.filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value.split("=")[0]!.trim());
    if (cookies.length) e.setCookieNames = cookies;
    const loc = headers.find((h) => h.name.toLowerCase() === "location")?.value;
    if (loc) e.location = sanitizeUrl(new URL(loc, res.url()).toString());
    if ([401, 403, 429].includes(e.status) && res.request().isNavigationRequest()) onBlocked(e.status, e.url);
  });
}

export async function detectChallenge(page: Page): Promise<string | null> {
  const title = (await page.title().catch(() => "")).toLowerCase();
  if (/just a moment|attention required|access denied|verify you are human|captcha/.test(title)) return `challenge page: "${title}"`;
  const hit = await page
    .locator('iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], #challenge-form, .g-recaptcha, .h-captcha, [data-sitekey]')
    .count()
    .catch(() => 0);
  return hit ? "captcha/challenge widget present" : null;
}

export async function cookieNames(ctx: BrowserContext): Promise<{ name: string; domain: string; httpOnly: boolean; sameSite: string }[]> {
  return (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, sameSite: c.sameSite }));
}

/** One-way fingerprint so two contexts' sessions can be compared for independence without ever storing values. */
export async function cookieFingerprint(ctx: BrowserContext, host: string): Promise<string> {
  const cs = (await ctx.cookies()).filter((c) => host.endsWith(c.domain.replace(/^\./, ""))).sort((a, b) => a.name.localeCompare(b.name));
  const data = new TextEncoder().encode(cs.map((c) => `${c.name}=${c.value}`).join(";"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
