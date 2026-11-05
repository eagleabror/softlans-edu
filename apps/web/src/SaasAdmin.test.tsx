import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SaasAnalytics, SaasPayments, SaasPlans, SaasSubscriptions } from "./SaasAdmin";

const plan = { id: "0123456789abcdef01234567", name: "Starter", code: "starter", monthlyPriceUZS: 149000, studentLimit: 100, groupLimit: 10, features: ["CRM"], isActive: true };
const payment = { id: "request-1", tenantId: "1123456789abcdef01234567", tenantName: "Kelajak", planId: plan.id, planName: plan.name, amountUZS: 149000, billingPeriod: 1, status: "pending", submittedBy: "owner", submittedAt: "2026-10-01T12:00:00.000Z", paidAt: "2026-10-01T10:00:00.000Z", paymentMethod: "Bank o‘tkazmasi", transactionNote: "Sinov raqami 123", reviewedAt: null, reviewedBy: null, reviewNote: null };
const response = (data: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data } as Response);
function defaults(url: string) {
  if (url.includes("/payment-requests")) return response({ requests: [payment], total: 1, page: 1, pageSize: 20 });
  if (url.includes("/settings")) return response({ instructions: "Bank orqali to‘lang", approved: true, updatedAt: null });
  if (url.includes("/subscriptions")) return response({ subscriptions: [], total: 0, page: 1, pageSize: 20 });
  return response({ plans: [plan] });
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

it("requires independent bank confirmation before approving a payment", async () => {
  const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "POST" ? response({}) : defaults(url));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><SaasPayments /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "Tafsilotlar" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Sinov raqami 123");
  const confirm = within(dialog).getByRole("button", { name: "To‘lovni tasdiqlash" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("Tekshiruv izohi"), "Bankdan tushum tekshirildi");
  expect(confirm).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(confirm);
  await screen.findByText("To‘lov tasdiqlandi va obuna yangilandi.");
  const approval = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(approval[0]).toBe("/api/super-admin/saas/payment-requests/request-1/approve");
  expect(JSON.parse(String(approval[1]?.body))).toEqual({ reviewNote: "Bankdan tushum tekshirildi", confirmedReceived: true });
});

it("preserves a failed review and allows rejection without claiming receipt", async () => {
  let failed = true;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") { if (failed) { failed = false; return response({ error: { message: "Qayta tekshiring" } }, 409); } return response({}); }
    return defaults(url);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><SaasPayments /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "Tafsilotlar" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByLabelText("Qaror"), "reject");
  await userEvent.type(within(dialog).getByLabelText("Tekshiruv izohi"), "Tushum topilmadi");
  await userEvent.click(within(dialog).getByRole("button", { name: "So‘rovni rad etish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Qayta tekshiring");
  expect(within(dialog).getByLabelText("Tekshiruv izohi")).toHaveValue("Tushum topilmadi");
  await userEvent.click(within(dialog).getByRole("button", { name: "So‘rovni rad etish" }));
  await screen.findByText("To‘lov so‘rovi rad etildi.");
  const calls = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(calls).toHaveLength(2);
  expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({ reviewNote: "Tushum topilmadi" });
});

it("edits server plans with integer UZS and explicit unlimited limits", async () => {
  const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "PATCH" ? response({}) : defaults(url));
  vi.stubGlobal("fetch", fetcher);
  render(<SaasPlans />);
  await userEvent.click(await screen.findByRole("button", { name: "Starter tarifini tahrirlash" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.clear(within(dialog).getByLabelText("Faol o‘quvchilar limiti"));
  await userEvent.clear(within(dialog).getByLabelText("Oylik narx (UZS)"));
  await userEvent.type(within(dialog).getByLabelText("Oylik narx (UZS)"), "159000");
  await userEvent.click(within(dialog).getByLabelText("Tarif faol"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Saqlash" }));
  await screen.findByText("Tarif saqlandi.");
  const edit = fetcher.mock.calls.find(([, options]) => options?.method === "PATCH")!;
  expect(JSON.parse(String(edit[1]?.body))).toMatchObject({ monthlyPriceUZS: 159000, studentLimit: null, groupLimit: 10, isActive: false });
});

it("requires confirmed funds for an extension and explains legacy assignment", async () => {
  const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "POST" ? response({}) : defaults(url));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={[`/?tenantId=${payment.tenantId}`]}><SaasSubscriptions /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Markaz obunasini boshqarish" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("eski erkin foydalanish holatini tugatadi");
  await userEvent.selectOptions(within(dialog).getByLabelText("Amal"), "extend");
  await userEvent.type(within(dialog).getByLabelText("Sabab"), "Bank tushumi tekshirildi");
  await userEvent.click(within(dialog).getByRole("button", { name: "Amalni tasdiqlash" }));
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Amalni tasdiqlash" }));
  await screen.findByText("Obuna yangilandi.");
  const edit = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(edit[0]).toBe(`/api/super-admin/saas/subscriptions/${payment.tenantId}`);
  expect(JSON.parse(String(edit[1]?.body))).toMatchObject({ action: "extend", billingPeriod: 1, confirmedPayment: true });
});

it("filters payment reviews on the server with date and status", async () => {
  const fetcher = vi.fn((url: string) => defaults(url));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><SaasPayments /></MemoryRouter>);
  await screen.findByRole("button", { name: "Tafsilotlar" });
  await userEvent.selectOptions(screen.getByLabelText("So‘rov holati"), "approved");
  await userEvent.type(screen.getByLabelText("Boshlanish sanasi"), "2026-10-01");
  await userEvent.click(screen.getByRole("button", { name: "Filtrlash" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("status=approved") && url.includes("from=2026-10-01"))).toBe(true));
});

it("labels MRR as recurring subscription value distinct from bank receipts", async () => {
  vi.stubGlobal("fetch", vi.fn(() => response({ activePaid: 2, trialing: 3, expired: 4, pendingPayments: 1, approvedAmountUZS: 598000, mrrUZS: 448000, byPlan: [{ planId: plan.id, planName: plan.name, count: 2 }], generatedAt: "2026-10-01T12:00:00.000Z" })));
  render(<SaasAnalytics />);
  expect(await screen.findByText(/bankka kelib tushgan haqiqiy mablag‘ emas/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Oylik takrorlanuvchi qiymat (MRR)" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Tasdiqlangan to‘lovlar summasi" })).toBeVisible();
  expect(screen.getByRole("table", { name: "Tariflar taqsimoti" })).toHaveTextContent("Starter");
});
