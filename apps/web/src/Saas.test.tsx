import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { SubscriptionBanner, TenantSubscription } from "./Saas";

const plan = { id: "plan-1", name: "Starter", code: "starter", monthlyPriceUZS: 149000, studentLimit: 100, groupLimit: 10, features: ["Asosiy imkoniyatlar"], isActive: true };
const summary = {
  subscription: { id: "subscription", tenantId: "tenant", planId: plan.id, planName: "Starter", status: "active", agreedPriceUZS: 149000, studentLimit: 100, groupLimit: 10, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", remainingDays: 5, trialStart: null, trialEnd: null, pendingPlanId: null },
  usage: { students: 100, groups: 3 }, legacy: false,
  instructions: { text: "Sinov bank yo‘riqnomasi", updatedAt: "2026-10-01T00:00:00.000Z" },
};
const response = (value: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => value } as Response);
function defaults(url: string) {
  if (url === "/api/saas") return response(summary);
  if (url.includes("/plans")) return response({ plans: [plan] });
  if (url.includes("/reminders")) return response({ reminders: [{ id: "reminder", message: "Obunangiz tugashiga 7 kun qoldi.", periodEnd: summary.subscription.periodEnd }] });
  if (url.includes("/payment-requests")) return response({ requests: [], total: 0, page: 1, pageSize: 20 });
  return response({ status: "active", readOnly: false, periodEnd: summary.subscription.periodEnd });
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());
const view = () => render(<MemoryRouter><TenantSubscription /></MemoryRouter>);

it("shows actual agreed price, limits, Tashkent dates, and reminder messages", async () => {
  vi.stubGlobal("fetch", vi.fn(defaults)); view();
  expect(await screen.findByText("100 / 100")).toBeVisible();
  expect(screen.getByText("3 / 10")).toBeVisible();
  expect(screen.getByText("5 kun")).toBeVisible();
  expect(screen.getByText(/Tarif limitiga yetilgan/)).toBeVisible();
  expect(await screen.findByText(/Obunangiz tugashiga 7 kun qoldi/)).toBeVisible();
});

it("does not invent bank details or offer payment without approved instructions", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/saas" ? response({ ...summary, instructions: null }) : defaults(url)));
  view();
  expect(await screen.findByRole("button", { name: "Starter tarifini tanlash" })).toBeDisabled();
  expect(screen.getByText(/Tasdiqlangan to‘lov yo‘riqnomasi hali kiritilmagan/)).toBeVisible();
});

it("keeps payment payload and idempotency key unchanged after uncertain failure; never sends client price", async () => {
  let attempts = 0;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("network")) : response({ request: { id: "new", status: "pending" } }, 201);
    }
    return defaults(url);
  });
  vi.stubGlobal("fetch", fetcher); view();
  await userEvent.click(await screen.findByRole("button", { name: "Starter tarifini tanlash" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Sinov bank yo‘riqnomasi");
  await userEvent.type(screen.getByLabelText("To‘lov sanasi va vaqti (Toshkent)"), "2026-10-31T10:00");
  await userEvent.type(screen.getByLabelText("To‘lov usuli"), "Bank o‘tkazmasi");
  await userEvent.type(screen.getByLabelText("Tranzaksiya izohi"), "TX-12345");
  await userEvent.click(screen.getByRole("button", { name: "To‘lov qilganim haqida yuborish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Serverga ulanib bo‘lmadi");
  expect(screen.getByLabelText("To‘lov usuli")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "So‘rovni qayta yuborish" }));
  expect(await screen.findByText(/To‘lov so‘rovi yuborildi/)).toBeVisible();
  const mutations = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(mutations).toHaveLength(2);
  expect(mutations[0]![1]!.body).toBe(mutations[1]![1]!.body);
  const payload = JSON.parse(String(mutations[0]![1]!.body));
  expect(payload.paidAt).toBe("2026-10-31T05:00:00.000Z");
  expect(payload).not.toHaveProperty("amountUZS");
  expect(payload.idempotencyKey).toMatch(/^[a-f\d-]{36}$/);
});

it("offers renewal only to the owner and explains read-only access", async () => {
  vi.stubGlobal("fetch", vi.fn(() => response({ status: "expired", readOnly: true, periodEnd: "2026-10-01T00:00:00Z" })));
  const { rerender } = render(<MemoryRouter><SubscriptionBanner owner /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: "Obunani yangilash" })).toHaveAttribute("href", "/settings/subscription");
  rerender(<MemoryRouter><SubscriptionBanner owner={false} /></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Obunani yangilash" })).not.toBeInTheDocument();
  expect(screen.getByText(/markaz egasiga murojaat/)).toBeVisible();
});

it.each(["admin", "teacher"])("denies %s SaaS management without requesting owner billing data", async role => {
  const fetcher = vi.fn((url: string) => url.endsWith("/auth/me") ? response({ user: { id: "u", name: "User", email: "user@example.test", role }, tenant: { id: "t", name: "Center" } }) : defaults(url));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/settings/subscription"]}><App /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Obunani faqat markaz egasi boshqaradi." })).toBeVisible();
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/saas/entitlement")).toBe(true));
  expect(fetcher.mock.calls.some(([url]) => url === "/api/saas" || url.includes("/payment-requests"))).toBe(false);
  expect(screen.queryByRole("link", { name: /Sozlamalar · Obuna va tariflar/ })).not.toBeInTheDocument();
});
