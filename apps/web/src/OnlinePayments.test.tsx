import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OnlineCheckout, OnlineHistory } from "./OnlinePayments";
import { PaymentProviders } from "./PaymentProviders";
import { TenantSubscription } from "./Saas";

const plan = { id: "a".repeat(24), name: "Starter", code: "starter", monthlyPriceUZS: 149000, studentLimit: 100, groupLimit: 10, features: [], isActive: true };
const order = { id: "b".repeat(24), tenantId: "c".repeat(24), planName: "Starter", provider: "payme", environment: "production", amountUZS: 120000, billingPeriod: 1, status: "pending", createdAt: "2026-11-17T12:00:00Z", expiresAt: "2026-11-18T00:00:00Z", paidAt: null, refundedAt: null, refundResolvedAt: null };
const response = (value: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => value } as Response);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

it("shows server price before redirect and keeps the same payload after an uncertain failure", async () => {
  let count = 0;
  const fetcher = vi.fn(() => ++count === 1 ? Promise.reject(new Error("network")) : response({ order, checkoutUrl: "https://checkout.paycom.uz/test-link" }, 201));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><OnlineCheckout plan={plan} providers={["payme", "click"]} onClose={() => {}} /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Summani hisoblash" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Qayta urinish");
  expect(screen.getByLabelText("To‘lov tizimi")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByRole("link", { name: "Payme orqali to‘lash" })).toHaveAttribute("href", "https://checkout.paycom.uz/test-link");
  expect(screen.getByText(/120.*000 UZS/)).toBeVisible();
  const calls = (fetcher.mock.calls as unknown as [string, RequestInit][]);
  expect(calls[0]![1].body).toBe(calls[1]![1].body);
  expect(JSON.parse(String(calls[0]![1].body))).not.toHaveProperty("amountUZS");
});
it("does not treat a success URL as payment confirmation", async () => {
  const paid = vi.fn();
  vi.stubGlobal("fetch", vi.fn((url: string) => response(url.includes(`/${order.id}`) ? { order, checkoutUrl: null } : { orders: [order], page: 1, total: 1, pageSize: 20 })));
  render(<MemoryRouter initialEntries={[`/?success=true&paymentOrder=${order.id}`]}><OnlineHistory onPaid={paid} /></MemoryRouter>);
  expect(await screen.findByText(/Tasdiq kutilmoqda/)).toBeVisible(); expect(paid).not.toHaveBeenCalled();
  expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("To‘lov kutilmoqda");
});
it("offers online payments even when manual bank instructions are not configured", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/saas") return response({ subscription: null, legacy: true, usage: { students: 0, groups: 0 }, instructions: null });
    if (url.endsWith("/plans")) return response({ plans: [plan] });
    if (url.endsWith("/payment-providers")) return response({ providers: ["payme"] });
    if (url.endsWith("/reminders")) return response({ reminders: [] });
    if (url.includes("/payment-requests")) return response({ requests: [], total: 0, page: 1, pageSize: 20 });
    return response({ orders: [], total: 0, page: 1, pageSize: 20 });
  }));
  render(<MemoryRouter><TenantSubscription /></MemoryRouter>);
  const choose = await screen.findByRole("button", { name: "Starter tarifini tanlash" }); await waitFor(() => expect(choose).toBeEnabled());
  await userEvent.click(choose); expect(screen.getByRole("dialog")).toHaveTextContent("Tarif uchun to‘lash");
  expect(screen.queryByRole("button", { name: "Bank orqali to‘lov" })).not.toBeInTheDocument();
});
it("edits provider settings without retrieving or resubmitting a stored secret", async () => {
  const settings = { provider: "payme", environment: "production", merchantId: "a".repeat(24), login: "Paycom", serviceId: "", secretConfigured: true, enabled: true, revision: 3, used: true, lastCallbackAt: null, lastError: "", callbackUrl: "https://edu.test/api/integrations/payme/production" };
  const fetcher = vi.fn((_url: string, options?: RequestInit) => response(options?.method === "PATCH" ? { provider: settings } : { encryptionAvailable: true, providers: [settings], origin: "https://edu.test" }));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><PaymentProviders /></MemoryRouter>);
  expect(await screen.findByText(/Kalit kiritilgan/)).toBeVisible();
  const section = screen.getByRole("heading", { name: "Payme" }).closest("section")!;
  const form = within(section);
  expect(form.getByLabelText("Yangi maxfiy kalit (almashtirish uchun)")).toHaveValue("");
  expect(form.getByLabelText("Kassa / Merchant ID")).toHaveAttribute("readonly");
  await userEvent.type(form.getByLabelText("Joriy parolingiz"), "Synthetic-pass-123");
  await userEvent.click(form.getByLabelText("Haqiqiy to‘lovlarni yoqish"));
  await userEvent.click(form.getByRole("button", { name: "Sozlamalarni saqlash" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true));
  const mutation = fetcher.mock.calls.find(([, o]) => o?.method === "PATCH")!;
  const body = JSON.parse(String(mutation[1]!.body)); expect(body).not.toHaveProperty("secret"); expect(body.enabled).toBe(false); expect(body.revision).toBe(3);
  await waitFor(() => expect(form.getByLabelText("Joriy parolingiz")).toHaveValue(""));
});
it("disables credential entry when server encryption has not been configured", async () => {
  vi.stubGlobal("fetch", vi.fn(() => response({ encryptionAvailable: false, providers: [], origin: "https://edu.test" })));
  render(<MemoryRouter><PaymentProviders /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("shifrlash sozlanmagan");
  for (const button of screen.getAllByRole("button", { name: "Sozlamalarni saqlash" })) expect(button).toBeDisabled();
});
