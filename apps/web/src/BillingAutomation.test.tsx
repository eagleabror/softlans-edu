import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { BillingAutomation } from "./BillingAutomation";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const view = {
  schedulerEnabled: false, timezone: "Asia/Tashkent", page: 1, pageSize: 20, total: 0, runs: [],
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api).mockResolvedValue(view); });
it("shows disabled and empty history; keyboard preview only requests a read-only quote", async () => {
  const user = userEvent.setup();
  render(<BillingAutomation month="2026-11" version={0} />);
  expect(await screen.findByText("Avtomatik hisoblash o‘chirilgan")).toBeInTheDocument();
  expect(screen.getByText("Tanlangan oy uchun avtomatik urinishlar yo‘q.")).toBeInTheDocument();
  vi.mocked(api).mockResolvedValueOnce({ month: "2026-11", dryRun: true, created: 0, wouldCreate: 2, skipped: 3, amount: 300000 });
  await user.tab();
  expect(screen.getByRole("button", { name: "Holatni yangilash" })).toHaveFocus();
  await user.tab(); // disabled pagination is skipped
  expect(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("status")).toHaveTextContent("Yaratilishi mumkin: 2");
  expect(screen.getByRole("status")).toHaveTextContent("Hisoblar yozilmadi");
  expect(api).toHaveBeenLastCalledWith("/billing/charges/preview", { method: "POST", body: '{"month":"2026-11"}' });
});
it("retains preview access during history failures and retries status without creating bills", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Aloqa xatosi"));
  render(<BillingAutomation month="2026-11" version={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Qo‘lda hisob yaratishdan foydalanishingiz mumkin");
  expect(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Holatni yangilash" }));
  expect(await screen.findByText("Avtomatik hisoblash o‘chirilgan")).toBeInTheDocument();
  expect(vi.mocked(api).mock.calls.every(([path]) => path.startsWith("/billing/automation?"))).toBe(true);
});
it("renders committed, failed and interrupted attempts with bounded history pagination", async () => {
  const base = { id: "a", month: "2026-11", status: "completed", created: 2, skipped: 0, amount: 300000,
    startedAt: "2026-11-01T19:05:00Z", finishedAt: "2026-11-01T19:05:01Z", errorCode: null };
  vi.mocked(api).mockResolvedValueOnce({ ...view, schedulerEnabled: true, total: 21, runs: [base,
    { ...base, id: "b", status: "failed", created: 0, amount: 0, errorCode: "BILLING_OWNER_REQUIRED" },
    { ...base, id: "c", status: "running", created: 0, amount: 0, finishedAt: null },
  ] });
  render(<BillingAutomation month="2026-11" version={0} />);
  expect(await screen.findByText("Yakunlangan")).toBeInTheDocument();
  expect(screen.getByText("Faol biznes egasi topilmadi.")).toBeInTheDocument();
  expect(screen.getByText("Natija hali tasdiqlanmagan")).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveAccessibleName(/2026-11/);
  await userEvent.click(screen.getByRole("button", { name: "Keyingi urinishlar sahifasi" }));
  await waitFor(() => expect(api).toHaveBeenLastCalledWith("/billing/automation?month=2026-11&page=2"));
});
it.each([{}, { month: "2026-12", dryRun: true, created: 0, wouldCreate: 1, skipped: 0, amount: 1000 },
  { month: "2026-11", dryRun: false, created: 1, wouldCreate: 1, skipped: 0, amount: 1000 }])("rejects an unverified preview %j without success", async response => {
  render(<BillingAutomation month="2026-11" version={0} />);
  await screen.findByText("Avtomatik hisoblash o‘chirilgan");
  vi.mocked(api).mockResolvedValueOnce(response);
  await userEvent.click(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("preview’i tasdiqlanmadi");
  expect(screen.queryByText(/Yaratilishi mumkin:/)).not.toBeInTheDocument();
});
it("clears preview when manual billing changes the source data", async () => {
  const { rerender } = render(<BillingAutomation month="2026-11" version={0} />);
  await screen.findByText("Avtomatik hisoblash o‘chirilgan");
  vi.mocked(api).mockResolvedValueOnce({ month: "2026-11", dryRun: true, created: 0, wouldCreate: 1, skipped: 0, amount: 1000 });
  await userEvent.click(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Yaratilishi mumkin: 1");
  rerender(<BillingAutomation month="2026-11" version={1} />);
  await screen.findByText("Avtomatik hisoblash o‘chirilgan");
  expect(screen.queryByText(/Yaratilishi mumkin:/)).not.toBeInTheDocument();
});
it("ignores an old in-flight preview after manual generation refreshes the data", async () => {
  const { rerender } = render(<BillingAutomation month="2026-11" version={0} />);
  await screen.findByText("Avtomatik hisoblash o‘chirilgan");
  let resolve!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await userEvent.click(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" }));
  expect(screen.getByRole("button", { name: "Tekshirilmoqda…" })).toBeDisabled();
  rerender(<BillingAutomation month="2026-11" version={1} />);
  await screen.findByText("Avtomatik hisoblash o‘chirilgan");
  resolve({ month: "2026-11", dryRun: true, created: 0, wouldCreate: 1, skipped: 0, amount: 1000 });
  await waitFor(() => expect(screen.getByRole("button", { name: "Oylik hisobni oldindan tekshirish" })).toBeEnabled());
  expect(screen.queryByText(/Yaratilishi mumkin:/)).not.toBeInTheDocument();
});
