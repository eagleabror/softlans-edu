import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    if (path === "/billing/charges/generate")
      return { month: "2026-10", created: 2, skipped: 3 };
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
  fireEvent.change(screen.getByLabelText("Hisob oyi"), { target: { value: "2026-10" } });
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
    await screen.findByText("2026-10: Yaratildi: 2 · O‘tkazib yuborildi: 3 · Xatolar: 0"),
  ).toBeInTheDocument();
});
it.each(["failure", "unverified"])("keeps %s generation visible without reporting success counts", async (kind) => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/billing/charges/generate") {
      if (kind === "failure") throw new Error("Hisob yaratishda xato");
      return { status: "accepted" };
    }
    return original(path, options);
  });
  render(<MemoryRouter><Billing owner={false} /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Oylik hisob yaratish" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Tasdiqlash va yaratish" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(kind === "failure" ? "Hisob yaratishda xato" : "Yakun natijasi tasdiqlanmadi");
  expect(screen.queryByText(/Yaratildi:/)).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Tasdiqlash va yaratish" })).toBeEnabled();
});
it("opens immutable billing calculation in a readable dialog", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups")) return { groups: [], total: 0 };
    if (path.startsWith("/billing/summary"))
      return {
        month: "2026-11",
        billedAmount: 161538,
        receivedAmount: 0,
        outstandingAmount: 161538,
        paymentCount: 0,
      };
    return {
      charges: [
        {
          ...charge,
          finalAmount: 161538,
          prorationAmount: 138462,
          calculation: {
            month: "2026-11",
            monthlyFee: 300000,
            totalLessons: 13,
            eligibleLessons: 7,
            approximateLessonPrice: 300000 / 13,
            calculatedAmount: 161538,
            policy: "first_partial_month",
            dueDate: "2026-11-16T04:00:00Z",
          },
        },
      ],
      total: 1,
      pageSize: 20,
    };
  });
  render(
    <MemoryRouter>
      <Billing owner />
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Darslar bo‘yicha hisob" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Darslar bo‘yicha hisob" });
  expect(within(dialog).getByText("Jami darslar")).toBeInTheDocument();
  expect(within(dialog).getByText("13")).toBeInTheDocument();
  expect(within(dialog).getByText("7")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Yopish" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
