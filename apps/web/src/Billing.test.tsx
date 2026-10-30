import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, it, expect, vi } from "vitest";
import { Billing } from "./Billing";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const charge = {
  id: "a".repeat(24),
  studentId: "b".repeat(24),
  groupId: "c".repeat(24),
  studentName: "Sinov Oquvchi",
  groupName: "Sinov guruh",
  billingMonth: "2025-02",
  originalAmount: 1000,
  discountAmount: 0,
  finalAmount: 1000,
  paidAmount: 400,
  remainingAmount: 600,
  status: "partial",
  dueDate: "2025-02-10T18:59:59Z",
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.resetAllMocks();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups"))
      return {
        groups: [{ id: charge.groupId, name: charge.groupName }],
        total: 1,
      };
    if (path.startsWith("/billing/summary"))
      return {
        month: "2025-02",
        timezone: "Asia/Tashkent",
        billedAmount: 1000,
        receivedAmount: 400,
        outstandingAmount: 600,
        paymentCount: 1,
      };
    return { charges: [charge], total: 1, pageSize: 20 };
  });
});
it("renders balances, sends student/group/status filters and hides owner corrections from admins", async () => {
  render(
    <MemoryRouter>
      <Billing owner={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Sinov Oquvchi")).toBeInTheDocument();
  expect(screen.queryByText("Hisobni tuzatish")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Holat"), "partial");
  await userEvent.selectOptions(screen.getByLabelText("Guruh"), charge.groupId);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(/charges\?.*groupId=.*status=partial/),
    ),
  );
});
it("requires payment confirmation and retains the same idempotent payload on a failed request", async () => {
  render(
    <MemoryRouter>
      <Billing owner={false} />
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "To‘lov qo‘shish" }),
  );
  const dialog = screen.getByRole("dialog");
  const amount = within(dialog).getByLabelText("Summa (UZS)");
  await userEvent.clear(amount);
  await userEvent.type(amount, "200");
  await userEvent.selectOptions(
    within(dialog).getByLabelText("To‘lov usuli"),
    "bank_transfer",
  );
  await userEvent.click(within(dialog).getByRole("checkbox"));
  const originals: string[] = [];
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/billing/payments") {
      originals.push(options!.body as string);
      throw new Error("Sinov aloqa xatosi");
    }
    return {};
  });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "To‘lovni tasdiqlash" }),
  );
  expect(
    await within(dialog).findByText(/Sinov aloqa xatosi/),
  ).toBeInTheDocument();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Qayta urinish" }),
  );
  expect(originals).toHaveLength(2);
  expect(originals[0]).toBe(originals[1]);
  expect(JSON.parse(originals[0]!)).toMatchObject({
    amount: 200,
    method: "bank_transfer",
    confirmed: true,
    idempotencyKey: expect.any(String),
  });
  expect(JSON.parse(originals[0]!).tenantId).toBeUndefined();
  expect(JSON.parse(originals[0]!).recordedBy).toBeUndefined();
});
it("confirms bulk generation and shows loading/empty states", async () => {
  render(
    <MemoryRouter>
      <Billing owner />
    </MemoryRouter>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Oylik hisob yaratish" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("checkbox")).toBeRequired();
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Tasdiqlash va yaratish" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/billing/charges/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"confirmed":true'),
      }),
    ),
  );
  expect(
    await screen.findByText("Amal muvaffaqiyatli bajarildi."),
  ).toBeInTheDocument();
});
