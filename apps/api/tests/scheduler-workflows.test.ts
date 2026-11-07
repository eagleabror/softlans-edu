import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Execute the actual checked-in workflow JavaScript, with no network, credentials,
// or database. Timers are immediate; a finite response queue catches cursor loops.
async function run(name: "tuition-billing" | "payroll-monthly", replies: (Response | Error)[]) {
  const yaml = readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
  const source = yaml.split("<<'JS'\n")[1]!.split("          JS")[0]!;
  const calls: { url: string; body: object }[] = [];
  const logs: string[] = [];
  const promise = runInNewContext(`(async () => { ${source}\n })()`, {
    URL, AbortSignal,
    process: { env: {
      BILLING_SCHEDULER_URL: "https://synthetic.invalid/api/internal/billing/run",
      BILLING_SCHEDULER_SECRET: "synthetic-only",
      PAYROLL_SCHEDULER_URL: "https://synthetic.invalid/api/internal/payroll/run",
      PAYROLL_SCHEDULER_SECRET: "synthetic-only",
    } },
    console: { log: (line: string) => logs.push(line) },
    setTimeout: (fn: () => void) => fn(),
    fetch: async (url: URL, options: RequestInit) => {
      calls.push({ url: url.href, body: JSON.parse(options.body as string) });
      if (calls.length > 6) throw new Error("Synthetic request budget exhausted");
      expect(options.method).toBe("POST");
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect((options.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-only");
      const next = replies.shift();
      if (!next) throw new Error("Unexpected extra scheduler request");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { promise, calls, logs };
}
const bill = (extra = {}, status = 200) => Response.json({ month: "2026-11", created: 1, skipped: 0, nextCursor: null, ...extra }, { status });
const payroll = (extra = {}, status = 200) => Response.json({ month: "2026-10", status: "completed", created: 1, preserved: 0, exceptions: 0, nextCursor: null, ...extra }, { status });
const cursor = "a".repeat(24);

describe("billing workflow completion", () => {
  it("follows every tenant cursor and ends only on an explicit null", async () => {
    const r = await run("tuition-billing", [bill({ nextCursor: cursor }), bill()]);
    await r.promise;
    expect(r.calls.map(c => c.body)).toEqual([{}, { after: cursor }]);
    expect(r.logs).toHaveLength(2);
    expect(r.logs.join()).not.toContain("synthetic-only");
  });
  it.each([202, 204])("rejects HTTP %i as completion", async status => {
    const response = status === 204 ? new Response(null, { status }) : bill({}, status);
    const r = await run("tuition-billing", [response]);
    await expect(r.promise).rejects.toThrow();
  });
  it.each([{}, { month: "2026-11", created: 0, skipped: 0 }, { month: "bad" }, { created: -1 }, { skipped: 0.5 }, { nextCursor: "" }])("rejects incomplete or invalid acknowledgements %j", async body => {
    const response = Object.keys(body).length === 0 || !Object.hasOwn(body, "nextCursor") && Object.hasOwn(body, "skipped") && Object.hasOwn(body, "month")
      ? Response.json(body) : bill(body);
    const r = await run("tuition-billing", [response]);
    await expect(r.promise).rejects.toThrow();
  });
  it("rejects repeated cursors before submitting another batch", async () => {
    const r = await run("tuition-billing", [bill({ nextCursor: cursor }), bill({ nextCursor: cursor }), bill()]);
    await expect(r.promise).rejects.toThrow();
    expect(r.calls).toHaveLength(2);
  });
  it("fails if the Tashkent month changes between batches", async () => {
    const r = await run("tuition-billing", [bill({ nextCursor: cursor }), bill({ month: "2026-12" })]);
    await expect(r.promise).rejects.toThrow();
  });
  it("retries ambiguous transport failure and 503 at the same cursor", async () => {
    const r = await run("tuition-billing", [bill({ nextCursor: cursor }), new Error("synthetic timeout"), new Response(null, { status: 503 }), bill()]);
    await r.promise;
    expect(r.calls.map(c => c.body)).toEqual([{}, { after: cursor }, { after: cursor }, { after: cursor }]);
  });
  it("stops after three transient failures and does not retry 401", async () => {
    for (const status of [503, 401]) {
      const r = await run("tuition-billing", Array.from({ length: 3 }, () => new Response(null, { status })));
      await expect(r.promise).rejects.toThrow();
      expect(r.calls).toHaveLength(status === 503 ? 3 : 1);
    }
  });
});

describe("payroll workflow completion", () => {
  it("pins the returned month while following tenant and teacher cursors", async () => {
    const nextCursor = { tenantId: cursor, afterTeacher: "b".repeat(24) };
    const r = await run("payroll-monthly", [payroll({ status: "processing", nextCursor }), payroll()]);
    await r.promise;
    expect(r.calls.map(c => c.body)).toEqual([{}, { month: "2026-10", cursor: nextCursor }]);
    expect(r.calls.every(c => c.url.endsWith("/api/internal/payroll/run"))).toBe(true);
  });
  it.each([payroll({}, 202), Response.json({}), payroll({ status: "processing" }), payroll({ exceptions: 1, status: "exceptions" })])("rejects non-completion or exceptions", async response => {
    const r = await run("payroll-monthly", [response]);
    await expect(r.promise).rejects.toThrow();
  });
  it("retries transport failure and preserves draft-only request shape", async () => {
    const r = await run("payroll-monthly", [new Error("synthetic timeout"), payroll()]);
    await r.promise;
    expect(r.calls.map(c => c.body)).toEqual([{}, {}]);
  });
  it("treats not_due as a valid no-op rather than proof of draft creation", async () => {
    const r = await run("payroll-monthly", [payroll({ status: "not_due", created: 0 })]);
    await r.promise;
    expect(r.logs.join()).toContain("not_due");
  });
});
