import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Debts, DebtStats } from "./Debts";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const summary = {
  outstandingAmount: 600,
  overdueAmount: 600,
  upcomingAmount: 0,
  overdue1To7: 600,
  overdue8To30: 0,
  overdueMoreThan30: 0,
  debtorCount: 1,
  overdueDebtorCount: 1,
  asOf: "2025-02-11T00:00:00Z",
  timezone: "Asia/Tashkent",
};
const row = {
  id: "a".repeat(24),
  studentId: "b".repeat(24),
  groupId: "c".repeat(24),
  studentName: "Sinov Oquvchi",
  groupName: "Sinov guruh",
  billingMonth: "2025-02",
  originalAmount: 1000,
  paidAmount: 400,
  remainingAmount: 600,
  dueDate: "2025-02-10T18:59:59Z",
  daysOverdue: 1,
  status: "partial",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups"))
      return { groups: [{ id: row.groupId, name: row.groupName }], total: 1 };
    if (path.startsWith("/debts/summary")) return summary;
    return { charges: [row], total: 21, pageSize: 20 };
  });
});
it("shows loading, balances, Uzbek payment status and existing financial profile links", async () => {
  render(
    <MemoryRouter>
      <Debts />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Qarzdorlik yuklanmoqda",
  );
  expect(await screen.findByText(row.studentName)).toHaveAttribute(
    "href",
    `/debts/students/${row.studentId}`,
  );
  expect(screen.getByText("Moliyaviy profil")).toHaveAttribute(
    "href",
    `/students/${row.studentId}/finance`,
  );
  expect(screen.getByText("Qisman to‘langan")).toBeInTheDocument();
  expect(screen.getByText("Muddati o‘tgan qarzdorlar")).toBeInTheDocument();
});
it("sends server-side group, aging, sorting and pagination filters", async () => {
  render(
    <MemoryRouter>
      <Debts overdue />
    </MemoryRouter>,
  );
  await screen.findByText(row.studentName);
  await userEvent.selectOptions(screen.getByLabelText("Guruh"), row.groupId);
  await userEvent.selectOptions(screen.getByLabelText("Muddat holati"), "1-7");
  await userEvent.click(
    await screen.findByRole("button", { name: "Qolgan qarz ↕" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/debts\/overdue\?.*groupId=.*status=1-7.*sort=remainingAmount/,
      ),
    ),
  );
  await screen.findByText(row.studentName);
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(/\/debts\/overdue\?.*page=2/),
    ),
  );
});
it("shows empty results and recoverable errors", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups")) return { groups: [], total: 0 };
    throw new Error("Sinov xatosi");
  });
  render(
    <MemoryRouter>
      <Debts />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Sinov xatosi");
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/debts/summary")
      ? summary
      : { charges: [], groups: [], total: 0 },
  );
  await userEvent.click(screen.getByText("Qayta urinish"));
  expect(
    await screen.findByText(
      "Tanlangan filtrlar bo‘yicha qarzdorlik topilmadi.",
    ),
  ).toBeInTheDocument();
});
it("renders group summary rows", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/debts/summary")) return summary;
    if (path.startsWith("/debts/groups"))
      return {
        groups: [
          { ...summary, groupId: row.groupId, groupName: row.groupName },
        ],
        total: 1,
      };
    return { groups: [], total: 0 };
  });
  render(
    <MemoryRouter>
      <Debts groups />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("button", { name: row.groupName }),
  ).toBeInTheDocument();
});
it("separates outstanding and overdue statistics", () => {
  render(
    <DebtStats
      data={{
        ...summary,
        overdueAmount: 0,
        overdueDebtorCount: 0,
        upcomingAmount: 600,
        overdue1To7: 0,
      }}
    />,
  );
  expect(screen.getByText("Jami qolgan qarz")).toBeInTheDocument();
  expect(screen.getByText("Muddati o‘tgan qarz")).toBeInTheDocument();
});

it("shows server export errors and sends the current filters", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: { message: "Eksport 5000 hisob bilan cheklangan." },
      }),
    } as Response);
  render(
    <MemoryRouter>
      <Debts overdue />
    </MemoryRouter>,
  );
  await screen.findByText(row.studentName);
  await userEvent.click(
    screen.getByRole("button", { name: "CSV yuklab olish" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Eksport 5000 hisob bilan cheklangan.",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/debts/export?status=overdue"),
    { credentials: "include" },
  );
  fetchMock.mockRestore();
});
