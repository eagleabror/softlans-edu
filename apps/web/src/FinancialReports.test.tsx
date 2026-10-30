import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { FinancialReports, reportDates } from "./FinancialReports";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: () => <div>Grafik</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));
const data = {
  period: {
    start: "2025-02-01",
    end: "2025-02-28",
    firstMonth: "2025-02",
    lastMonth: "2025-02",
    timezone: "Asia/Tashkent",
  },
  summary: {
    payments: 400,
    paymentCount: 1,
    billed: 1000,
    collected: 400,
    outstanding: 600,
    overdue: 600,
    debtors: 1,
    rate: 40,
  },
  monthly: [
    { month: "2025-02", billed: 1000, collected: 400, payments: 400, count: 1 },
  ],
  methods: [{ method: "cash", amount: 400, count: 1 }],
  aging: [{ bucket: "1-7", amount: 600 }],
  groups: [
    {
      id: "a",
      name: "Matematika",
      students: 2,
      billed: 1000,
      collected: 400,
      outstanding: 600,
      rate: 40,
    },
  ],
  totalGroups: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/groups")
      ? { groups: [{ id: "a", name: "Matematika" }], total: 1 }
      : (data as any),
  );
});
it("renders real metrics, bases, chart tables and filter/sort requests", async () => {
  const u = userEvent.setup();
  render(<FinancialReports />);
  expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  await screen.findByRole("heading", { name: "Moliyaviy hisobotlar" });
  expect((await screen.findAllByText("40%")).length).toBe(2);
  expect(
    screen.getByText("Qabul qilingan to‘lovlar", { selector: "p" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/To‘lovlar — to‘lov sanasi/)).toBeInTheDocument();
  expect(screen.getAllByText("Jadval ko‘rinishi")).toHaveLength(4);
  await u.selectOptions(screen.getByLabelText("Davr"), "last");
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([p]) =>
          p.includes(`start=${reportDates(1, true).start}`),
        ),
    ).toBe(true),
  );
  await u.click(screen.getByRole("button", { name: /Yig‘im \(%\)/ }));
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.some(([p]) => p.includes("sort=rate")),
    ).toBe(true),
  );
});
it("shows retryable errors and recovers without displaying false zero metrics", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Hisobot yuklanmadi"));
  const u = userEvent.setup();
  render(<FinancialReports />);
  await screen.findByRole("alert");
  expect(
    screen.queryByText("Qabul qilingan to‘lovlar"),
  ).not.toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("Guruhlar bo‘yicha natijalar");
});
it("uses Tashkent midnight and calendar month presets", () => {
  expect(reportDates(1, false, new Date("2025-02-28T19:00:00Z"))).toEqual({
    start: "2025-03-01",
    end: "2025-03-01",
  });
  expect(reportDates(1, true, new Date("2024-03-01T00:00:00Z"))).toEqual({
    start: "2024-02-01",
    end: "2024-02-29",
  });
});
