import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { SECRET } from "./fixtures.js";

describe("worker entry", () => {
  it("serves with env-provided secret", async () => {
    const r = await worker.fetch(new Request("https://gen.test/healthz"), { LINK_SIGNING_SECRET: SECRET }, {} as ExecutionContext);
    expect(await r.json()).toEqual({ ok: true });
  });
  it("refuses to start without a strong secret", () => {
    expect(() => worker.fetch(new Request("https://gen.test/"), { LINK_SIGNING_SECRET: "x", PUBLIC_BASE_URL: "other" }, {} as ExecutionContext)).toThrow();
  });
});
