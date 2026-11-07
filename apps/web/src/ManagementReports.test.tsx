import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, it, expect, vi } from "vitest";
import { ManagementReports } from "./ManagementReports";
import { reportDates } from "./FinancialReports";
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
const cash = {
  opening: 1000,
  openingEntries: 0,
  tuition: 300,
  salary: -100,
  expenses: -50,
  manual: 0,
  transfers: 0,
  closing: 1150,
};
const data = {
  period: {
    start: "2025-02-01",
    end: "2025-02-28",
    asOf: "2025-03-02T00:00:00Z",
    timezone: "Asia/Tashkent",
  },
  summary: {
    billed: 1000,
    receipts: 300,
    debt: 700,
    approvedSalary: 200,
    salaryPaid: 100,
    operatingExpenses: 50,
    estimatedResult: null,
    unclassifiedExpenses: 1,
    unclassifiedMovements: 0,
  },
  monthly: [
    {
      month: "2025-02",
      billed: 1000,
      receipts: 300,
      approvedSalary: 200,
      salaryPaid: 100,
      operatingExpenses: 50,
      estimatedResult: null,
    },
  ],
  warnings: [
    {
      code: "EXPENSE_UNCLASSIFIED",
      month: "2025-02",
      message: "Xarajat tasnifi yo‘q",
    },
  ],
  expenseCategories: [
    {
      id: "c",
      name: "Eski kategoriya",
      classification: "unclassified",
      amount: 20,
    },
  ],
  groups: [{ id: "g", name: "Matematika", billed: 1000, receipts: 300 }],
  cash: {
    ...cash,
    accounts: [
      { id: "a", name: "Naqd kassa", kind: "cash", initialized: true, ...cash },
    ],
  },
  unallocated: {
    payments: { count: 1, amount: 30 },
    salaries: { count: 0, amount: 0 },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api).mockResolvedValue(data);
});
const show = () =>
  render(
    <MemoryRouter>
      <ManagementReports />
    </MemoryRouter>,
  );
it("distinguishes estimates from cash, shows incomplete results and preserves date filters", async () => {
  show();
  expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  await screen.findByText("Naqd kassa");
  expect(screen.getAllByText("Ma’lumot yetarli emas")).toHaveLength(2);
  expect(screen.getByText("Xarajat tasnifi yo‘q")).toBeInTheDocument();
  expect(
    screen.getByRole("table", { name: /Kassa va bank/ }),
  ).toHaveTextContent("O‘tkazmalar");
  expect(
    screen.getByRole("link", { name: "Kategoriya tasniflarini ko‘rish" }),
  ).toHaveAttribute("href", "/expenses/categories");
  await userEvent.click(screen.getByRole("button", { name: "O‘tgan oy" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining(`start=${reportDates(1, true).start}`),
    ),
  );
  fireEvent.change(screen.getByLabelText("Qayd chegarasi (kun oxiri)"), {
    target: { value: "2025-03-02" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("asOf=2025-03-02T18%3A59%3A59.999Z"),
    ),
  );
});
it("shows recoverable errors without false zero cards", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Manbalar yuklanmadi"));
  show();
  await screen.findByRole("alert");
  expect(
    screen.queryByText("Hisoblangan ta’lim haqi", { selector: "p" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("Naqd kassa");
});
it("pins CSV to the displayed as-of cutoff and reports export failures", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: "Eksport xatosi" } }),
  } as Response);
  show();
  await screen.findByText("Naqd kassa");
  await userEvent.click(screen.getByRole("button", { name: "CSV eksport" }));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("asOf=2025-03-02T00%3A00%3A00Z"),
    { credentials: "include" },
  );
  await screen.findByText("Eksport xatosi");
  fetchMock.mockRestore();
});
it("does not invent cash or profit when sources are empty", async () => {
  vi.mocked(api).mockResolvedValue({
    ...data,
    monthly: [],
    groups: [],
    expenseCategories: [],
    cash: { ...cash, accounts: [] },
  });
  show();
  await screen.findByText("Guruhlarga bog‘langan ma’lumotlar yo‘q.");
  expect(
    within(screen.getByRole("table", { name: /Kassa va bank/ })).getAllByRole(
      "row",
    ),
  ).toHaveLength(2);
});
